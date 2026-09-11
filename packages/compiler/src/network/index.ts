/**
 * compileNetwork — network filter lines → a finished DNR ruleset.
 * docs/FILTER-SYNTAX.md §2–§6. Isomorphic (no Node built-ins).
 */
import type { DroppedFilter } from '@iublocker/shared';
import { DNR_LIMITS, ID_RANGE } from '@iublocker/shared';
import { redirectResources as defaultRedirectResources } from '@iublocker/scriptlets';
import type { CompileNetworkResult, CompileOptions, CosmeticNetworkExceptions, RawLine } from '../types';
import type { NetworkFilter } from '../parser/network-filter';
import { badfilterKey, parseNetworkFilter } from '../parser/network-filter';
import type { ConvertContext, ConvertedRule } from '../dnr/convert';
import { STATIC_TIERS, USER_TIERS, convertFilter, cosmeticExceptionHostnames } from '../dnr/convert';
import { optimize } from '../dnr/optimize';
import { ENTITY_EXPANSION_LIMIT } from '../psl';

export interface CompileNetworkOptions extends CompileOptions {
  /** Which priority tiers to use: list rules (default) or dynamic user rules. */
  priorityScope?: 'static' | 'user';
  /** `$redirect` name → file. Defaults to the table from @iublocker/scriptlets. */
  redirectResources?: Record<string, string>;
  /** Raw `$badfilter` lines contributed by other lists in the same build. */
  extraBadfilters?: string[];
  /** Parse bare hostnames as domain rules (hosts-format lists). */
  hostsFormat?: boolean;
  /** Highest rule id that may be assigned. */
  maxRuleId?: number;
  /** Cap on hostnames produced by one `example.*` entity. */
  entityLimit?: number;
  /** Cap on domains per merged rule. */
  maxDomainsPerRule?: number;
}

function emptyExceptions(): CosmeticNetworkExceptions {
  return { elemhide: [], generichide: [], specifichide: [] };
}

function pushUnique(target: string[], values: readonly string[]): void {
  for (const v of values) if (!target.includes(v)) target.push(v);
}

/** Collect the `$badfilter` keys contributed by a set of raw lines. */
export function collectBadfilterKeys(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    if (raw.indexOf('badfilter') === -1) continue;
    const parsed = parseNetworkFilter(raw, 0);
    if (parsed.ok && parsed.filter.badfilter) out.push(badfilterKey(parsed.filter));
  }
  return out;
}

/**
 * Compile network filter lines into DNR rules.
 *
 * Two passes: parse everything first (so `$badfilter`, entity expansion and
 * `$redirect-rule` can see the whole list), then convert and optimise.
 */
export function compileNetwork(lines: RawLine[], opts: CompileNetworkOptions): CompileNetworkResult {
  const listId = opts.listId;
  const dropped: DroppedFilter[] = [];
  const warnings = new Set<string>();
  const cosmeticExceptions = emptyExceptions();

  // ---- pass 1: parse -------------------------------------------------------
  const parsed: NetworkFilter[] = [];
  const badfilters = new Set<string>(opts.extraBadfilters ?? []);
  const knownHostnames = new Set<string>();
  const blockPatterns = new Set<string>();

  for (const line of lines) {
    const result = parseNetworkFilter(line.raw, line.line, { hostsFormat: opts.hostsFormat === true });
    if (!result.ok) {
      dropped.push({ listId, line: line.line, raw: line.raw, reason: result.reason });
      continue;
    }
    const f = result.filter;
    parsed.push(f);
    if (f.badfilter) {
      badfilters.add(badfilterKey(f));
      continue;
    }
    if (f.hostname !== undefined) knownHostnames.add(f.hostname);
    for (const d of f.initiator.included) if (!d.endsWith('.*')) knownHostnames.add(d);
    for (const d of f.request.included) if (!d.endsWith('.*')) knownHostnames.add(d);
    if (!f.isException && f.redirect === undefined) blockPatterns.add(f.pattern);
  }

  // ---- pass 2: convert -----------------------------------------------------
  const ctx: ConvertContext = {
    tiers: opts.priorityScope === 'user' ? USER_TIERS : STATIC_TIERS,
    redirectResources: opts.redirectResources ?? defaultRedirectResources,
    knownHostnames,
    entityLimit: opts.entityLimit ?? ENTITY_EXPANSION_LIMIT,
    blockPatterns,
  };

  const converted: ConvertedRule[] = [];
  for (const f of parsed) {
    if (f.badfilter) continue;
    if (badfilters.size > 0 && badfilters.has(badfilterKey(f))) {
      dropped.push({ listId, line: f.line, raw: f.raw, reason: 'removed by $badfilter' });
      continue;
    }

    if (f.isException && f.cosmeticOptions.length > 0) {
      const hosts = cosmeticExceptionHostnames(f);
      if (hosts.length === 0) {
        warnings.add(`${f.raw}: cosmetic exception without a hostname is ignored`);
      } else {
        for (const option of f.cosmeticOptions) pushUnique(cosmeticExceptions[option], hosts);
      }
    }

    const result = convertFilter(f, ctx);
    for (const w of result.warnings) warnings.add(`${f.raw}: ${w}`);
    if (!result.ok) {
      dropped.push({ listId, line: f.line, raw: f.raw, reason: result.reason });
      continue;
    }
    converted.push(...result.converted);
  }

  // ---- pass 3: optimise ----------------------------------------------------
  const isUser = opts.priorityScope === 'user';
  const result = optimize(converted, {
    firstRuleId: opts.firstRuleId ?? (isUser ? ID_RANGE.USER.start : ID_RANGE.STATIC.start),
    maxRegexRules: opts.maxRegexRules ?? DNR_LIMITS.MAX_REGEX_RULES_PER_RULESET,
    maxRuleId: opts.maxRuleId ?? (isUser ? ID_RANGE.USER.end : ID_RANGE.STATIC.end),
    maxDomainsPerRule: opts.maxDomainsPerRule,
  });

  for (const d of result.dropped) {
    dropped.push({ listId, line: d.filter.line, raw: d.filter.raw, reason: d.reason });
  }

  const { duplicates, domainMerged, initiatorMerged, shadowed } = result.savings;
  if (duplicates > 0) warnings.add(`${duplicates} duplicate rules removed`);
  if (domainMerged > 0) warnings.add(`${domainMerged} rules folded into requestDomains merges`);
  if (initiatorMerged > 0) warnings.add(`${initiatorMerged} rules folded into initiatorDomains merges`);
  if (shadowed > 0) warnings.add(`${shadowed} rules dropped as shadowed`);

  return {
    rules: result.rules,
    dropped,
    warnings: [...warnings],
    cosmeticExceptions,
    counts: result.counts,
  };
}
