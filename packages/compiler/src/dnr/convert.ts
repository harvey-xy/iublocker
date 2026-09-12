/**
 * NetworkFilter → DNR rule conversion. docs/FILTER-SYNTAX.md §2.1, §2.2, §3, §4.
 */
import type {
  DNRAction,
  DNRCondition,
  DNRHeaderInfo,
  DNRModifyHeaderInfo,
  DNRResourceType,
  DNRRule,
} from '@iublocker/shared';
import { DNR_RESOURCE_TYPES, PRIORITY, isValidHostname } from '@iublocker/shared';
import { resolveScriptlet } from '@iublocker/scriptlets';
import type { NetworkFilter } from '../parser/network-filter';
import { expandDomains } from '../psl';
import { checkRe2 } from './re2';

/** A rule before IDs are assigned. */
export type RuleDraft = Omit<DNRRule, 'id'> & { priority: number };

export type RuleCategory = 'block' | 'allow' | 'redirect' | 'modifyHeaders';

export interface ConvertedRule {
  rule: RuleDraft;
  filter: NetworkFilter;
  isRegex: boolean;
  category: RuleCategory;
}

export interface PriorityTiers {
  block: number;
  redirect: number;
  allow: number;
  important: number;
  importantRedirect: number;
  documentAllow: number;
}

export const STATIC_TIERS: PriorityTiers = {
  block: PRIORITY.BLOCK,
  redirect: PRIORITY.REDIRECT,
  allow: PRIORITY.ALLOW,
  important: PRIORITY.IMPORTANT,
  importantRedirect: PRIORITY.IMPORTANT_REDIRECT,
  documentAllow: PRIORITY.DOCUMENT_ALLOW,
};

export const USER_TIERS: PriorityTiers = {
  block: PRIORITY.USER_BLOCK,
  redirect: PRIORITY.USER_REDIRECT,
  allow: PRIORITY.USER_ALLOW,
  important: PRIORITY.USER_IMPORTANT,
  importantRedirect: PRIORITY.USER_IMPORTANT_REDIRECT,
  documentAllow: PRIORITY.USER_ALLOW,
};

export interface ConvertContext {
  tiers: PriorityTiers;
  /** `$redirect` name → file (from @iublocker/scriptlets). */
  redirectResources: Record<string, string>;
  /** Hostnames seen in the list, used to keep entity expansion small. */
  knownHostnames?: ReadonlySet<string>;
  entityLimit?: number;
  /** Canonical patterns of block filters, used to gate `$redirect-rule`. */
  blockPatterns?: ReadonlySet<string>;
}

export type ConvertResult =
  | { ok: true; converted: ConvertedRule[]; warnings: string[] }
  | { ok: false; reason: string; warnings: string[] };

/**
 * Headers Chrome refuses to let extensions modify through `declarativeNetRequest`
 * `modifyHeaders` (mirrors uBO's `$removeheader` deny-list plus the CORS control set).
 */
export const FORBIDDEN_MODIFY_HEADERS: ReadonlySet<string> = new Set([
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-expose-headers',
  'access-control-max-age',
  'access-control-request-headers',
  'access-control-request-method',
  'origin',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-user',
  'sec-websocket-accept',
  'sec-websocket-extensions',
  'sec-websocket-key',
  'sec-websocket-protocol',
  'sec-websocket-version',
  'upgrade',
  'connection',
  'host',
  'content-length',
  'transfer-encoding',
]);

const DOCUMENT_TYPES: DNRResourceType[] = ['main_frame', 'sub_frame'];

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) if (s.charCodeAt(i) > 127) return false;
  return true;
}

/**
 * Reject a `urlFilter` Chrome would refuse.
 *
 * This is a hard safety net, not a nicety: Chrome validates **every declared ruleset** —
 * enabled or not — when the extension loads, and a single malformed rule makes it refuse
 * to load the extension at all ("Rule with id N specifies an incorrect value for the
 * urlFilter key"), which takes the service worker down with it.
 *
 * Returns the reason the filter is invalid, or `null` when it is fine.
 */
export function urlFilterProblem(urlFilter: string): string | null {
  if (urlFilter === '') return 'urlFilter is empty';
  if (!isAscii(urlFilter)) return 'urlFilter contains non-ASCII characters';
  if (urlFilter.startsWith('||*')) return 'urlFilter starts with "||*", which DNR rejects';
  const start = urlFilter.startsWith('||') ? 2 : urlFilter.startsWith('|') ? 1 : 0;
  const end = urlFilter.length - (urlFilter.length > start && urlFilter.endsWith('|') ? 1 : 0);
  if (urlFilter.slice(start, end).includes('|'))
    return 'urlFilter has a "|" anchor that is neither at the start nor at the end';
  return null;
}

/** `/resources/<file>` from whatever shape the resource table uses. */
export function toExtensionPath(file: string): string {
  let f = file;
  while (f.startsWith('/')) f = f.slice(1);
  if (f.startsWith('resources/')) f = f.slice('resources/'.length);
  return `/resources/${f}`;
}

/** Hostnames a `$elemhide`/`$generichide`/`$specifichide` exception applies to. */
export function cosmeticExceptionHostnames(f: NetworkFilter): string[] {
  const out: string[] = [];
  if (f.hostname !== undefined && (f.hostRest === undefined || f.hostRest === '' || f.hostRest === '^')) {
    out.push(f.hostname);
  }
  for (const d of f.initiator.included) if (!d.endsWith('.*')) out.push(d);
  return out;
}

function resolveRedirect(name: string, table: Record<string, string>): string | null {
  const direct = table[name];
  if (direct !== undefined) return direct;
  const withJs = table[`${name}.js`];
  if (withJs !== undefined) return withJs;
  const noJs = name.endsWith('.js') ? table[name.slice(0, -3)] : undefined;
  if (noJs !== undefined) return noJs;
  // Surrogates are also scriptlets; the registry knows their alias → file mapping.
  const meta = resolveScriptlet(name);
  if (meta?.redirectResource !== undefined) return meta.redirectResource;
  return null;
}

function buildResourceTypes(
  f: NetworkFilter,
  condition: DNRCondition,
  forceDocument: boolean,
  allTypesByDefault = false,
): void {
  if (forceDocument) {
    condition.resourceTypes = DOCUMENT_TYPES.slice();
    return;
  }
  if (f.resourceTypes.length > 0) {
    condition.resourceTypes = f.resourceTypes.slice();
    return;
  }
  if (f.excludedResourceTypes.length > 0) {
    const excluded = f.excludedResourceTypes.slice();
    if (!f.hasDocument && !excluded.includes('main_frame')) excluded.unshift('main_frame');
    condition.excludedResourceTypes = excluded;
    return;
  }
  // `$removeparam` applies to navigations too (uBO/AdGuard semantics). A DNR rule with no
  // `resourceTypes` never matches `main_frame`, so every type must be listed explicitly.
  if (allTypesByDefault) {
    condition.resourceTypes = DNR_RESOURCE_TYPES.slice();
    return;
  }
  // ABP default: everything except the top-level document (docs/FILTER-SYNTAX.md §3).
  condition.excludedResourceTypes = ['main_frame'];
}

/**
 * Whether `||<host>…` may be rewritten as `requestDomains: [host]`.
 *
 * `requestDomains` matches a **domain or one of its subdomains**, so it only means the same
 * thing as the `||` anchor when the anchored text really is a hostname. Lists are full of
 * `||` patterns that are host *prefixes* instead — `||adservice.google.` (every Google ad
 * ccTLD), `||ad120m.`, `||e-zpass.com-` (phishing hosts), `||142.91.159.` — and for those
 * `requestDomains` matches nothing at all, silently dropping the filter. DNR's own `||`
 * anchor has exactly the ABP meaning, so those keep their `urlFilter`.
 */
function isDomainAnchor(host: string): boolean {
  return host.includes('.') && isValidHostname(host);
}

function applyPattern(
  f: NetworkFilter,
  condition: DNRCondition,
): { ok: true } | { ok: false; reason: string } {
  if (f.kind === 'regex') {
    const source = f.regex ?? '';
    const check = checkRe2(source);
    if (!check.ok) return { ok: false, reason: check.reason };
    condition.regexFilter = source;
    if (f.matchCase) condition.isUrlFilterCaseSensitive = true;
    return { ok: true };
  }

  const hasRequestDomains = f.request.included.length > 0;

  if (f.kind === 'hostname' && f.hostname !== undefined && !hasRequestDomains) {
    if (isDomainAnchor(f.hostname)) {
      condition.requestDomains = [f.hostname];
      return { ok: true };
    }
    // A hosts-file entry means `||host^`; as a bare `urlFilter` it would be a substring.
    const urlFilter = `||${f.hostname}^`;
    const problem = urlFilterProblem(urlFilter);
    if (problem !== null) return { ok: false, reason: problem };
    condition.urlFilter = urlFilter;
    return { ok: true };
  }

  if (
    f.kind === 'hostAnchor' &&
    f.hostname !== undefined &&
    !hasRequestDomains &&
    !f.rightAnchored &&
    (f.hostRest === '' || f.hostRest === '^') &&
    isDomainAnchor(f.hostname)
  ) {
    // Preferred form: cheaper to evaluate and merges well (docs/FILTER-SYNTAX.md §5.3).
    condition.requestDomains = [f.hostname];
    return { ok: true };
  }

  let urlFilter = f.pattern;
  if (f.rightAnchored) urlFilter += '|';
  if (urlFilter === '') return { ok: true };
  const problem = urlFilterProblem(urlFilter);
  if (problem !== null) return { ok: false, reason: problem };
  condition.urlFilter = urlFilter;
  if (f.matchCase) condition.isUrlFilterCaseSensitive = true;
  return { ok: true };
}

function applyDomains(f: NetworkFilter, condition: DNRCondition, ctx: ConvertContext): void {
  const opts = { known: ctx.knownHostnames, limit: ctx.entityLimit };
  if (f.initiator.included.length > 0) condition.initiatorDomains = expandDomains(f.initiator.included, opts);
  if (f.initiator.excluded.length > 0)
    condition.excludedInitiatorDomains = expandDomains(f.initiator.excluded, opts);
  if (f.request.included.length > 0) {
    const existing = condition.requestDomains ?? [];
    condition.requestDomains = expandDomains([...existing, ...f.request.included], opts);
  }
  const excludedRequest = [...f.request.excluded, ...f.denyAllow];
  if (excludedRequest.length > 0) condition.excludedRequestDomains = expandDomains(excludedRequest, opts);
  if (f.methods.length > 0) condition.requestMethods = [...new Set(f.methods)].sort();
  if (f.excludedMethods.length > 0) condition.excludedRequestMethods = [...new Set(f.excludedMethods)].sort();
  if (f.domainType !== undefined) condition.domainType = f.domainType;
  if (f.header !== undefined) {
    const info: DNRHeaderInfo =
      f.header.value === undefined
        ? { header: f.header.name }
        : { header: f.header.name, values: [f.header.value] };
    if (f.header.negated) condition.excludedResponseHeaders = [info];
    else condition.responseHeaders = [info];
  }
}

/** Convert one parsed filter into zero or more DNR rule drafts. */
export function convertFilter(f: NetworkFilter, ctx: ConvertContext): ConvertResult {
  const warnings: string[] = [...f.warnings];

  if (f.badfilter) return { ok: true, converted: [], warnings };

  const isCosmeticOnly =
    f.cosmeticOptions.length > 0 && !f.hasDocument && f.redirect === undefined && f.csp === undefined;
  if (isCosmeticOnly) return { ok: true, converted: [], warnings };

  if (f.redirectRule) {
    const patterns = ctx.blockPatterns;
    if (patterns === undefined || !patterns.has(f.pattern)) {
      return { ok: false, reason: '$redirect-rule without a matching block filter', warnings };
    }
  }

  const condition: DNRCondition = {};
  let action: DNRAction;
  let priority: number;
  let category: RuleCategory;
  let forceDocumentTypes = false;

  if (f.isException) {
    if (f.hasDocument || f.isAll) {
      action = { type: 'allowAllRequests' };
      priority = f.important ? ctx.tiers.important : ctx.tiers.documentAllow;
      forceDocumentTypes = true;
    } else {
      action = { type: 'allow' };
      priority = f.important ? ctx.tiers.important : ctx.tiers.allow;
    }
    category = 'allow';
  } else if (f.redirect !== undefined) {
    const file = resolveRedirect(f.redirect, ctx.redirectResources);
    if (file === null) return { ok: false, reason: `unknown $redirect resource "${f.redirect}"`, warnings };
    action = { type: 'redirect', redirect: { extensionPath: toExtensionPath(file) } };
    priority = f.important ? ctx.tiers.importantRedirect : ctx.tiers.redirect;
    category = 'redirect';
  } else if (f.removeParams !== undefined) {
    action = {
      type: 'redirect',
      redirect: { transform: { queryTransform: { removeParams: [...new Set(f.removeParams)].sort() } } },
    };
    priority = f.important ? ctx.tiers.important : ctx.tiers.block;
    category = 'redirect';
  } else if (f.csp !== undefined && f.csp !== '') {
    const header: DNRModifyHeaderInfo = {
      header: 'Content-Security-Policy',
      operation: 'append',
      value: f.csp,
    };
    action = { type: 'modifyHeaders', responseHeaders: [header] };
    priority = f.important ? ctx.tiers.important : ctx.tiers.block;
    category = 'modifyHeaders';
    forceDocumentTypes = f.resourceTypes.length === 0;
  } else if (f.permissions !== undefined && f.permissions !== '') {
    const header: DNRModifyHeaderInfo = {
      header: 'Permissions-Policy',
      operation: 'append',
      value: f.permissions,
    };
    action = { type: 'modifyHeaders', responseHeaders: [header] };
    priority = f.important ? ctx.tiers.important : ctx.tiers.block;
    category = 'modifyHeaders';
    forceDocumentTypes = f.resourceTypes.length === 0;
  } else if (f.removeHeader !== undefined) {
    const name = f.removeHeader.name;
    if (FORBIDDEN_MODIFY_HEADERS.has(name)) {
      return { ok: false, reason: `Chrome forbids modifying the "${name}" header`, warnings };
    }
    const info: DNRModifyHeaderInfo = { header: name, operation: 'remove' };
    action =
      f.removeHeader.target === 'request'
        ? { type: 'modifyHeaders', requestHeaders: [info] }
        : { type: 'modifyHeaders', responseHeaders: [info] };
    priority = f.important ? ctx.tiers.important : ctx.tiers.block;
    category = 'modifyHeaders';
  } else {
    action = { type: 'block' };
    priority = f.important ? ctx.tiers.important : ctx.tiers.block;
    category = 'block';
  }

  const patternResult = applyPattern(f, condition);
  if (!patternResult.ok) return { ok: false, reason: patternResult.reason, warnings };
  applyDomains(f, condition, ctx);
  buildResourceTypes(f, condition, forceDocumentTypes, f.removeParams !== undefined);

  if (condition.requestDomains !== undefined && condition.requestDomains.length === 0)
    return { ok: false, reason: 'no request domains left after expansion', warnings };
  if (condition.initiatorDomains !== undefined && condition.initiatorDomains.length === 0)
    return { ok: false, reason: 'no initiator domains left after expansion', warnings };

  const isRegex = condition.regexFilter !== undefined;
  return {
    ok: true,
    converted: [{ rule: { priority, action, condition }, filter: f, isRegex, category }],
    warnings,
  };
}
