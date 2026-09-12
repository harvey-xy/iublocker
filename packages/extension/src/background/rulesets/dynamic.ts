/**
 * Dynamic rule bookkeeping. docs/RULESETS.md §5, docs/FILTER-SYNTAX.md §6.
 *
 * Every dynamic rule belongs to exactly one ID range (user filters / delta updates).
 * A range is always rewritten as a whole: remove every rule in the range, then add the
 * new set with freshly allocated IDs. That keeps the worker stateless across restarts.
 */
import { DNR_LIMITS, ID_RANGE, type DNRRule } from '@iublocker/shared';
import { log } from '../log';

export interface IdRange {
  start: number;
  end: number;
}

export const RANGES = {
  delta: ID_RANGE.DELTA as IdRange,
  user: ID_RANGE.USER as IdRange,
} as const;

export function rangeSize(range: IdRange): number {
  return range.end - range.start + 1;
}

export function inRange(id: number, range: IdRange): boolean {
  return id >= range.start && id <= range.end;
}

/** Rules Chrome counts against the "unsafe" dynamic budget. */
export function isUnsafeRule(rule: DNRRule): boolean {
  const type = rule.action.type;
  return type === 'redirect' || type === 'modifyHeaders';
}

export function countUnsafe(rules: readonly DNRRule[]): number {
  let n = 0;
  for (const rule of rules) if (isUnsafeRule(rule)) n++;
  return n;
}

export async function getDynamicRules(): Promise<DNRRule[]> {
  return (await chrome.declarativeNetRequest.getDynamicRules()) as unknown as DNRRule[];
}

export async function getRulesInRange(range: IdRange): Promise<DNRRule[]> {
  const rules = await getDynamicRules();
  return rules.filter((rule) => inRange(rule.id, range));
}

/**
 * Allocate `count` free IDs inside `range`, scanning the current rules once.
 * Returns the lowest free IDs; throws when the range cannot satisfy the request.
 */
export async function allocate(range: IdRange, count: number): Promise<number[]> {
  const used = new Set((await getDynamicRules()).filter((r) => inRange(r.id, range)).map((r) => r.id));
  const out: number[] = [];
  for (let id = range.start; id <= range.end && out.length < count; id++) {
    if (!used.has(id)) out.push(id);
  }
  if (out.length < count) throw new Error(`dynamic ID range ${range.start}-${range.end} exhausted (${count} requested)`);
  return out;
}

export interface RewriteResult {
  added: number;
  removed: number;
  dropped: number;
  warnings: string[];
  rules: DNRRule[];
}

export interface RewriteOptions {
  /** Hard cap on the number of rules written into this range. */
  maxRules?: number;
}

/**
 * One rewrite of a range at a time. Two overlapping rewrites both read the pre-write rule
 * set, so the second one would ask Chrome to add IDs the first one has just created and
 * `updateDynamicRules` would reject the whole call (a double "Save" of the user filters, or
 * a user save racing a delta apply).
 */
const rangeLocks = new Map<number, Promise<unknown>>();

function withRangeLock<T>(range: IdRange, run: () => Promise<T>): Promise<T> {
  const previous = rangeLocks.get(range.start) ?? Promise.resolve();
  const result = previous.then(run, run);
  rangeLocks.set(
    range.start,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

/**
 * Replace every rule of `range` with `rules` in a single `updateDynamicRules` call.
 * IDs are reassigned from the bottom of the range; rules that do not fit the range or
 * the platform budgets are dropped with a warning (the caller surfaces them).
 */
export function rewriteRange(
  range: IdRange,
  rules: readonly DNRRule[],
  options: RewriteOptions = {},
): Promise<RewriteResult> {
  return withRangeLock(range, () => doRewriteRange(range, rules, options));
}

async function doRewriteRange(
  range: IdRange,
  rules: readonly DNRRule[],
  options: RewriteOptions,
): Promise<RewriteResult> {
  const existing = await getDynamicRules();
  const removeRuleIds = existing.filter((rule) => inRange(rule.id, range)).map((rule) => rule.id);
  const survivors = existing.filter((rule) => !inRange(rule.id, range));

  const warnings: string[] = [];
  const capacityByRange = rangeSize(range);
  const capacityByTotal = Math.max(0, DNR_LIMITS.MAX_DYNAMIC_RULES - survivors.length);
  const capacity = Math.min(capacityByRange, capacityByTotal, options.maxRules ?? Number.MAX_SAFE_INTEGER);
  const unsafeBudget = Math.max(0, DNR_LIMITS.MAX_UNSAFE_DYNAMIC_RULES - countUnsafe(survivors));

  const accepted: DNRRule[] = [];
  let dropped = 0;
  let unsafeUsed = 0;
  for (const rule of rules) {
    if (accepted.length >= capacity) {
      dropped++;
      continue;
    }
    if (isUnsafeRule(rule)) {
      if (unsafeUsed >= unsafeBudget) {
        dropped++;
        continue;
      }
      unsafeUsed++;
    }
    accepted.push({ ...rule, id: range.start + accepted.length });
  }
  if (dropped > 0) {
    warnings.push(
      `dropped ${dropped} dynamic rule(s): range ${range.start}-${range.end} capacity ${capacity}, unsafe budget ${unsafeBudget}`,
    );
    log.warn(warnings[warnings.length - 1]);
  }

  if (removeRuleIds.length === 0 && accepted.length === 0) {
    return { added: 0, removed: 0, dropped, warnings, rules: accepted };
  }
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: accepted as unknown as chrome.declarativeNetRequest.Rule[],
  });
  return { added: accepted.length, removed: removeRuleIds.length, dropped, warnings, rules: accepted };
}

export async function clearRange(range: IdRange): Promise<number> {
  const result = await rewriteRange(range, []);
  return result.removed;
}

export function __resetForTests(): void {
  rangeLocks.clear();
}
