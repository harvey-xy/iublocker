/**
 * Network filter parser. docs/FILTER-SYNTAX.md §2.
 *
 * Produces the internal `NetworkFilter` AST consumed by src/dnr/convert.ts. Parsing is
 * intentionally strict: an unknown option invalidates the whole filter (uBO behaviour).
 */
import type { DNRDomainType, DNRRequestMethod, DNRResourceType } from '@iublocker/shared';

export type CosmeticOption = 'elemhide' | 'generichide' | 'specifichide';

export interface DomainSpec {
  /** Positive entries (`a.com`, `a.*`). */
  included: string[];
  /** Negated entries (`~b.com`). */
  excluded: string[];
}

export interface HeaderCondition {
  name: string;
  value?: string;
  negated: boolean;
}

export interface RemoveHeaderSpec {
  target: 'request' | 'response';
  name: string;
}

export type PatternKind = 'regex' | 'hostAnchor' | 'text' | 'hostname';

export interface NetworkFilter {
  raw: string;
  line: number;
  /** `@@` prefix. */
  isException: boolean;
  /** Pattern text with `@@` and options removed. */
  pattern: string;
  kind: PatternKind;
  /** For kind === 'regex': the expression between the slashes. */
  regex?: string;
  /** For kind === 'hostAnchor' | 'hostname': the anchored hostname (punycoded, lowercase). */
  hostname?: string;
  /** Remainder after `||hostname` for kind 'hostAnchor' (may be '' or '^'). */
  hostRest?: string;
  leftAnchored: boolean;
  rightAnchored: boolean;

  resourceTypes: DNRResourceType[];
  excludedResourceTypes: DNRResourceType[];
  /** `$document` was given explicitly. */
  hasDocument: boolean;
  /** `$all` was given. */
  isAll: boolean;

  initiator: DomainSpec;
  request: DomainSpec;
  denyAllow: string[];
  methods: DNRRequestMethod[];
  excludedMethods: DNRRequestMethod[];
  domainType?: DNRDomainType;

  matchCase: boolean;
  important: boolean;
  badfilter: boolean;

  redirect?: string;
  redirectRule: boolean;
  removeParams?: string[];
  csp?: string;
  permissions?: string;
  removeHeader?: RemoveHeaderSpec;
  header?: HeaderCondition;
  cosmeticOptions: CosmeticOption[];

  /** Canonical option strings (sorted) used for `$badfilter` matching and dedupe keys. */
  canonicalOptions: string[];
  /** Non-fatal notes produced while parsing (e.g. dropped regex domain entries). */
  warnings: string[];
}

export type NetworkParseResult = { ok: true; filter: NetworkFilter } | { ok: false; reason: string };

const TYPE_ALIASES: Record<string, DNRResourceType> = {
  script: 'script',
  image: 'image',
  img: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  object: 'object',
  'object-subrequest': 'object',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  subdocument: 'sub_frame',
  frame: 'sub_frame',
  ping: 'ping',
  beacon: 'ping',
  websocket: 'websocket',
  media: 'media',
  font: 'font',
  other: 'other',
  webtransport: 'webtransport',
  webbundle: 'webbundle',
  csp_report: 'csp_report',
  'csp-report': 'csp_report',
  document: 'main_frame',
  doc: 'main_frame',
};

const METHODS = new Set<string>([
  'connect',
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'other',
]);

/** Options MV3 cannot express; dropped with a warning (docs/FILTER-SYNTAX.md §2.2). */
const UNSUPPORTED_OPTIONS = new Set([
  'popup',
  'popunder',
  'inline-script',
  'inline-font',
  'strict1p',
  'strict3p',
  'strict-first-party',
  'strict-third-party',
  'replace',
  'urlskip',
  'urltransform',
  'ipaddress',
  'cname',
  'webrtc',
  'genericblock',
  'network',
  'extension',
  'jsonprune',
  'hls',
  // uBO conditions DNR cannot express: `$top=` needs the top-level document's domain (DNR
  // only knows the *initiator*), `$requestheader=` needs a request-header condition.
  'top',
  'requestheader',
]);

/**
 * AdGuard-only options with no MV3 equivalent. They are dropped like an unknown option,
 * but with a reason that says *why* so `report.json` stays readable: AdGuard's own lists
 * ship tens of thousands of these lines and they are not list bugs.
 */
const ADGUARD_ONLY_OPTIONS = new Set([
  'stealth',
  'cookie',
  'app',
  'jsinject',
  'referrerpolicy',
  'uritransform',
  'content',
  'removeparam-regexp',
  'elemhide-unsupported',
]);

/** Allowed alone (no DNR effect). */
const NOOP_OPTIONS = new Set(['_', 'noop']);

const ALL_TYPES: DNRResourceType[] = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
];

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) if (s.charCodeAt(i) > 127) return false;
  return true;
}

/** Punycode a hostname using the platform URL parser (isomorphic, no dependency). */
export function toASCIIHostname(host: string): string {
  const lower = host.toLowerCase();
  if (isAscii(lower)) return lower;
  try {
    return new URL(`http://${lower}/`).hostname;
  } catch {
    return '';
  }
}

/** First character of an option name (`script`, `~third-party`, `_`…). */
const OPTION_NAME_START = /[A-Za-z~_]/;

/**
 * Whether `text` can be the option list that follows a `/regex/` pattern.
 *
 * Almost every option name starts with a letter, `~` or `_`; the exceptions are `$1p` and
 * `$3p`, which is why a leading digit is accepted only in exactly that shape. Accepting any
 * digit would misread `/re/$script,uritransform=//$1b.com$2/` (the `$1` back-reference
 * inside the option value looks like the start of an option list).
 */
function looksLikeOptionList(text: string): boolean {
  if (OPTION_NAME_START.test(text.charAt(0))) return true;
  const c = text.charAt(0);
  return (c === '1' || c === '3') && text.charAt(1) === 'p' && (text.length === 2 || text.charAt(2) === ',');
}

/**
 * Split `pattern$options` respecting escaped `$` and `/regex/` patterns.
 *
 * For a regex pattern the boundary is the last unescaped `/` that is followed by `$` and
 * a plausible option name — the closing slash is *not* necessarily the last character of
 * the line, because option values carry slashes of their own
 * (`/re/$script,uritransform=/a/b/`). Reading such a line as one bare regex silently
 * smuggles the option text into `regexFilter`, where it compiles fine and matches nothing.
 */
export function splitPatternOptions(text: string): { pattern: string; options: string | null } {
  if (text.startsWith('/')) {
    let bareRegex = false;
    for (let i = text.length - 1; i > 0; i -= 1) {
      if (text[i] !== '/' || text[i - 1] === '\\') continue;
      if (text[i + 1] === '$' && looksLikeOptionList(text.slice(i + 2)))
        return { pattern: text.slice(0, i + 1), options: text.slice(i + 2) };
      // Keep looking: the trailing `/` may belong to an option value, not to the regex.
      if (i === text.length - 1) bareRegex = true;
    }
    if (bareRegex) return { pattern: text, options: null };
  }
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '$' || (i > 0 && text[i - 1] === '\\')) continue;
    return { pattern: text.slice(0, i), options: text.slice(i + 1) };
  }
  return { pattern: text, options: null };
}

/** Split an option list on commas, ignoring commas inside `/regex/` values and `(...)`. */
export function splitOptionList(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  let inRegex = false;
  let afterEquals = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (inRegex) {
      if (c === '/') inRegex = false;
      continue;
    }
    if (c === '=') {
      afterEquals = true;
      continue;
    }
    if (c === '/' && afterEquals && text[i - 1] === '=') {
      inRegex = true;
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') depth = depth > 0 ? depth - 1 : 0;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
      afterEquals = false;
    }
  }
  out.push(text.slice(start));
  return out;
}

function parseDomainList(value: string, spec: DomainSpec, warnings: string[], what: string): boolean {
  const parts = value.split(/[|,]/);
  let any = false;
  for (const partRaw of parts) {
    const part = partRaw.trim();
    if (part === '') continue;
    const negated = part.charCodeAt(0) === 126; /* ~ */
    const body = negated ? part.slice(1) : part;
    if (body === '') continue;
    if (body.startsWith('/') && body.endsWith('/')) {
      warnings.push(`${what}: regex domain "${body}" dropped (DNR has no regex domains)`);
      continue;
    }
    const host = body.endsWith('.*') ? `${toASCIIHostname(body.slice(0, -2))}.*` : toASCIIHostname(body);
    if (host === '' || host === '.*') {
      warnings.push(`${what}: invalid domain "${body}"`);
      continue;
    }
    if (negated) spec.excluded.push(host);
    else spec.included.push(host);
    any = true;
  }
  return any;
}

function emptyDomainSpec(): DomainSpec {
  return { included: [], excluded: [] };
}

/** Parse one network filter line. */
export function parseNetworkFilter(
  raw: string,
  line: number,
  opts: { hostsFormat?: boolean } = {},
): NetworkParseResult {
  let text = raw.trim();
  if (text === '') return { ok: false, reason: 'empty line' };

  const isException = text.startsWith('@@');
  if (isException) text = text.slice(2);

  const { pattern: patternRaw, options } = splitPatternOptions(text);
  const warnings: string[] = [];

  const f: NetworkFilter = {
    raw,
    line,
    isException,
    pattern: patternRaw,
    kind: 'text',
    leftAnchored: false,
    rightAnchored: false,
    resourceTypes: [],
    excludedResourceTypes: [],
    hasDocument: false,
    isAll: false,
    initiator: emptyDomainSpec(),
    request: emptyDomainSpec(),
    denyAllow: [],
    methods: [],
    excludedMethods: [],
    matchCase: false,
    important: false,
    badfilter: false,
    redirectRule: false,
    cosmeticOptions: [],
    canonicalOptions: [],
    warnings,
  };

  const types = new Set<DNRResourceType>();
  const excludedTypes = new Set<DNRResourceType>();
  const canonical: string[] = [];

  if (options !== null) {
    for (const tokenRaw of splitOptionList(options)) {
      const token = tokenRaw.trim();
      if (token === '') continue;
      const negated = token.charCodeAt(0) === 126; /* ~ */
      const body = negated ? token.slice(1) : token;
      const eq = body.indexOf('=');
      const name = (eq === -1 ? body : body.slice(0, eq)).toLowerCase();
      const value = eq === -1 ? '' : body.slice(eq + 1);
      canonical.push(negated ? `~${name}${eq === -1 ? '' : `=${value}`}` : body);

      const type = TYPE_ALIASES[name];
      if (type !== undefined) {
        if (name === 'document' || name === 'doc') f.hasDocument = true;
        if (negated) excludedTypes.add(type);
        else types.add(type);
        continue;
      }

      switch (name) {
        case 'all':
          f.isAll = true;
          f.hasDocument = true;
          for (const t of ALL_TYPES) types.add(t);
          break;
        case 'third-party':
        case '3p':
          f.domainType = negated ? 'firstParty' : 'thirdParty';
          break;
        case 'first-party':
        case '1p':
          f.domainType = negated ? 'thirdParty' : 'firstParty';
          break;
        case 'domain':
        case 'from':
          if (!parseDomainList(value, f.initiator, warnings, '$domain'))
            return { ok: false, reason: '$domain has no usable entries' };
          break;
        case 'to':
          if (!parseDomainList(value, f.request, warnings, '$to'))
            return { ok: false, reason: '$to has no usable entries' };
          break;
        case 'denyallow': {
          const spec = emptyDomainSpec();
          if (!parseDomainList(value, spec, warnings, '$denyallow'))
            return { ok: false, reason: '$denyallow has no usable entries' };
          f.denyAllow.push(...spec.included);
          break;
        }
        case 'method': {
          let any = false;
          for (const mRaw of value.split('|')) {
            const m = mRaw.trim().toLowerCase();
            if (m === '') continue;
            const neg = m.charCodeAt(0) === 126;
            const mm = neg ? m.slice(1) : m;
            if (!METHODS.has(mm)) return { ok: false, reason: `unsupported $method "${mm}"` };
            if (neg) f.excludedMethods.push(mm as DNRRequestMethod);
            else f.methods.push(mm as DNRRequestMethod);
            any = true;
          }
          if (!any) return { ok: false, reason: '$method is empty' };
          break;
        }
        case 'match-case':
          f.matchCase = !negated;
          break;
        case 'important':
          f.important = true;
          break;
        case 'badfilter':
          f.badfilter = true;
          canonical.pop();
          break;
        case 'redirect':
        case 'rewrite': {
          let v = value;
          if (v.startsWith('abp-resource:')) v = v.slice('abp-resource:'.length);
          const priorityAt = v.indexOf(':');
          if (priorityAt !== -1) v = v.slice(0, priorityAt);
          // `@@…$redirect` / `@@…$redirect-rule` with no value cancels redirects for the
          // pattern; the filter is then a plain exception (uBO). Only a *block* filter
          // needs a resource name.
          if (v === '') {
            if (!isException) return { ok: false, reason: '$redirect has no value' };
            break;
          }
          f.redirect = v;
          break;
        }
        case 'redirect-rule': {
          let v = value;
          const priorityAt = v.indexOf(':');
          if (priorityAt !== -1) v = v.slice(0, priorityAt);
          if (v === '') {
            if (!isException) return { ok: false, reason: '$redirect-rule has no value' };
            break;
          }
          f.redirect = v;
          f.redirectRule = true;
          break;
        }
        case 'empty':
          f.redirect = 'empty';
          break;
        case 'mp4':
          f.redirect = 'noop-1s.mp4';
          types.add('media');
          break;
        case 'removeparam':
        case 'queryprune': {
          if (value === '') return { ok: false, reason: '$removeparam without a name is unsupported' };
          if (negated) return { ok: false, reason: '$removeparam negation is unsupported' };
          if (value.startsWith('/')) return { ok: false, reason: '$removeparam regex is unsupported' };
          const names = value
            .split('|')
            .map((p) => p.trim())
            .filter((p) => p !== '');
          if (names.length === 0) return { ok: false, reason: '$removeparam has no names' };
          if (names.some((n) => n.startsWith('~')))
            return { ok: false, reason: '$removeparam negation is unsupported' };
          f.removeParams = names;
          break;
        }
        case 'csp':
          if (value === '') {
            if (!isException) return { ok: false, reason: '$csp without a value is only valid on @@' };
            f.csp = '';
          } else {
            f.csp = value.trim();
          }
          break;
        case 'permissions':
          if (value === '') {
            if (!isException)
              return { ok: false, reason: '$permissions without a value is only valid on @@' };
            f.permissions = '';
          } else {
            f.permissions = value.trim().split('\\,').join(',');
          }
          break;
        case 'removeheader': {
          let v = value.toLowerCase().trim();
          let target: 'request' | 'response' = 'response';
          if (v.startsWith('request:')) {
            target = 'request';
            v = v.slice('request:'.length);
          }
          if (v === '') return { ok: false, reason: '$removeheader has no name' };
          f.removeHeader = { target, name: v };
          break;
        }
        case 'header': {
          if (value === '') return { ok: false, reason: '$header has no name' };
          const colon = value.indexOf(':');
          const hname = (colon === -1 ? value : value.slice(0, colon)).toLowerCase().trim();
          const hvalue = colon === -1 ? undefined : value.slice(colon + 1);
          f.header =
            hvalue === undefined ? { name: hname, negated } : { name: hname, value: hvalue, negated };
          break;
        }
        case 'elemhide':
        case 'ehide':
          f.cosmeticOptions.push('elemhide');
          break;
        case 'generichide':
        case 'ghide':
          f.cosmeticOptions.push('generichide');
          break;
        case 'specifichide':
        case 'shide':
          f.cosmeticOptions.push('specifichide');
          break;
        default:
          if (NOOP_OPTIONS.has(name)) break;
          // `domains$$selector` is AdGuard HTML filtering: the second `$` lands in the
          // option list, so the first option name still carries it.
          if (name.charCodeAt(0) === 36 /* $ */)
            return { ok: false, reason: 'AdGuard HTML filtering ("$$") is unsupported on MV3' };
          if (UNSUPPORTED_OPTIONS.has(name)) return { ok: false, reason: `unsupported option "${name}"` };
          if (ADGUARD_ONLY_OPTIONS.has(name))
            return { ok: false, reason: `AdGuard-only option "${name}" has no MV3 equivalent` };
          return { ok: false, reason: `unknown option "${name}"` };
      }
    }
  }

  f.resourceTypes = ALL_TYPES.filter((t) => types.has(t));
  f.excludedResourceTypes = ALL_TYPES.filter((t) => excludedTypes.has(t));
  f.canonicalOptions = canonical.slice().sort();

  const patternResult = parsePattern(f, opts.hostsFormat === true);
  if (!patternResult.ok) return patternResult;
  return { ok: true, filter: f };
}

function parsePattern(f: NetworkFilter, hostsFormat: boolean): { ok: true } | { ok: false; reason: string } {
  let p = f.pattern;

  if (p === '') {
    // Option-only filter (e.g. `$removeparam=utm_source`) — matches every URL.
    f.kind = 'text';
    return { ok: true };
  }

  if (p.length > 2 && p.startsWith('/') && p.endsWith('/')) {
    f.kind = 'regex';
    f.regex = p.slice(1, -1);
    return { ok: true };
  }

  if (p.endsWith('|') && !p.endsWith('\\|')) {
    f.rightAnchored = true;
    p = p.slice(0, -1);
  }

  if (p.startsWith('||')) {
    const rest = p.slice(2);
    const end = findHostEnd(rest);
    const host = toASCIIHostname(rest.slice(0, end));
    if (host === '' || host.includes('*')) {
      // `||*.example.com^` style. DNR rejects a `urlFilter` beginning with `||*` outright
      // — and one invalid rule makes Chrome refuse to load the whole extension — so drop
      // the domain anchor and match the remainder as a substring, which is what the filter
      // means anyway ("any host ending in .example.com").
      let text = rest;
      while (text.startsWith('*')) text = text.slice(1);
      if (text === '') return { ok: false, reason: 'pattern "||*" matches everything' };
      f.kind = 'text';
      f.pattern = text;
      return { ok: true };
    }
    f.kind = 'hostAnchor';
    f.hostname = host;
    f.hostRest = rest.slice(end);
    f.pattern = `||${host}${f.hostRest}`;
    return { ok: true };
  }

  if (p.startsWith('|')) {
    f.leftAnchored = true;
    f.pattern = p;
    f.kind = 'text';
    return { ok: true };
  }

  if (hostsFormat && isPlainHostPattern(p)) {
    f.kind = 'hostname';
    f.hostname = toASCIIHostname(p);
    f.pattern = p;
    if (f.hostname === '') return { ok: false, reason: 'invalid hostname' };
    return { ok: true };
  }

  f.pattern = p;
  f.kind = 'text';
  return { ok: true };
}

/** Index of the first character after the hostname in a `||host…` pattern. */
function findHostEnd(rest: string): number {
  for (let i = 0; i < rest.length; i += 1) {
    const c = rest[i] as string;
    if (c === '/' || c === '^' || c === '*' || c === '?' || c === ':' || c === '|' || c === '=') return i;
  }
  return rest.length;
}

function isPlainHostPattern(p: string): boolean {
  if (p.indexOf('.') === -1) return false;
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i] as string;
    const ok =
      (c >= 'a' && c <= 'z') ||
      (c >= 'A' && c <= 'Z') ||
      (c >= '0' && c <= '9') ||
      c === '.' ||
      c === '-' ||
      c === '_' ||
      c.charCodeAt(0) > 127;
    if (!ok) return false;
  }
  return true;
}

/**
 * Key used by `$badfilter` to find the filter it cancels: everything but the
 * `$badfilter` option itself.
 */
export function badfilterKey(f: NetworkFilter): string {
  return `${f.isException ? '@@' : ''}${f.pattern}$${f.canonicalOptions.join(',')}`;
}
