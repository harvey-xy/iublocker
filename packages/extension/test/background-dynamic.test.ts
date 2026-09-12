import { beforeEach, describe, expect, it } from 'vitest';
import { DNR_LIMITS, ID_RANGE, type DNRRule } from '@iublocker/shared';
import * as dynamic from '../src/background/rulesets/dynamic';
import { resetBackground } from './background-utils';

const block = (id: number, host: string): DNRRule => ({
  id,
  priority: 1,
  action: { type: 'block' },
  condition: { requestDomains: [host] },
});

const redirect = (id: number): DNRRule => ({
  id,
  priority: 1,
  action: { type: 'redirect', redirect: { extensionPath: '/resources/noop.js' } },
  condition: { urlFilter: 'ads' },
});

describe('dynamic rules: ranges', () => {
  let chromeMock: ReturnType<typeof resetBackground>;
  beforeEach(() => {
    chromeMock = resetBackground();
  });

  it('classifies unsafe rules', () => {
    expect(dynamic.isUnsafeRule(block(1, 'a.com'))).toBe(false);
    expect(dynamic.isUnsafeRule(redirect(1))).toBe(true);
    expect(
      dynamic.isUnsafeRule({ id: 2, action: { type: 'modifyHeaders', responseHeaders: [] }, condition: {} }),
    ).toBe(true);
    expect(dynamic.countUnsafe([block(1, 'a.com'), redirect(2), redirect(3)])).toBe(2);
  });

  it('allocates the lowest free ids in a range', async () => {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        block(ID_RANGE.USER.start, 'a.com'),
        block(ID_RANGE.USER.start + 2, 'b.com'),
      ] as unknown as chrome.declarativeNetRequest.Rule[],
    });
    expect(await dynamic.allocate(dynamic.RANGES.user, 3)).toEqual([
      ID_RANGE.USER.start + 1,
      ID_RANGE.USER.start + 3,
      ID_RANGE.USER.start + 4,
    ]);
  });

  it('throws when a range is exhausted', async () => {
    await expect(dynamic.allocate({ start: 1, end: 2 }, 3)).rejects.toThrow(/exhausted/);
  });

  it('rewrites one range without touching the other', async () => {
    await dynamic.rewriteRange(dynamic.RANGES.delta, [block(0, 'delta.com'), block(0, 'delta2.com')]);
    await dynamic.rewriteRange(dynamic.RANGES.user, [block(0, 'user.com')]);

    const all = chromeMock._state.dynamicRules as DNRRule[];
    expect(all.map((rule) => rule.id).sort((a, b) => a - b)).toEqual([
      ID_RANGE.DELTA.start,
      ID_RANGE.DELTA.start + 1,
      ID_RANGE.USER.start,
    ]);

    // Rewriting the user range replaces only user rules.
    const result = await dynamic.rewriteRange(dynamic.RANGES.user, [
      block(0, 'user2.com'),
      block(0, 'user3.com'),
    ]);
    expect(result).toMatchObject({ added: 2, removed: 1, dropped: 0 });
    const delta = await dynamic.getRulesInRange(dynamic.RANGES.delta);
    expect(delta).toHaveLength(2);
    const user = await dynamic.getRulesInRange(dynamic.RANGES.user);
    expect(user.map((rule) => rule.condition.requestDomains?.[0])).toEqual(['user2.com', 'user3.com']);
    expect(user.map((rule) => rule.id)).toEqual([ID_RANGE.USER.start, ID_RANGE.USER.start + 1]);
  });

  it('serialises two rewrites of the same range', async () => {
    // Both calls read the pre-write rule set; without serialisation the second one asks
    // Chrome to add ids the first one has just created and the whole call is rejected.
    const seen: { removeRuleIds?: number[]; addRules?: { id: number }[] }[] = [];
    const real = chromeMock.declarativeNetRequest.updateDynamicRules;
    chromeMock.declarativeNetRequest.updateDynamicRules = (async (o: {
      removeRuleIds?: number[];
      addRules?: { id: number }[];
    }) => {
      seen.push(o);
      const existing = new Set((chromeMock._state.dynamicRules as DNRRule[]).map((r) => r.id));
      for (const rule of o.addRules ?? []) {
        if (existing.has(rule.id) && !(o.removeRuleIds ?? []).includes(rule.id)) {
          throw new Error(`Rule with id ${rule.id} does not have a unique ID`);
        }
      }
      return real(o as never);
    }) as typeof chromeMock.declarativeNetRequest.updateDynamicRules;

    await Promise.all([
      dynamic.rewriteRange(dynamic.RANGES.user, [block(0, 'first.com')]),
      dynamic.rewriteRange(dynamic.RANGES.user, [block(0, 'second.com'), block(0, 'third.com')]),
    ]);
    chromeMock.declarativeNetRequest.updateDynamicRules = real;

    expect(seen).toHaveLength(2);
    const user = await dynamic.getRulesInRange(dynamic.RANGES.user);
    expect(user.map((rule) => rule.condition.requestDomains?.[0])).toEqual(['second.com', 'third.com']);
  });

  it('clears a range', async () => {
    await dynamic.rewriteRange(dynamic.RANGES.user, [block(0, 'a.com')]);
    expect(await dynamic.clearRange(dynamic.RANGES.user)).toBe(1);
    expect(chromeMock._state.dynamicRules).toHaveLength(0);
  });

  it('drops rules beyond maxRules and warns', async () => {
    const result = await dynamic.rewriteRange(
      dynamic.RANGES.delta,
      [block(0, 'a.com'), block(0, 'b.com'), block(0, 'c.com')],
      { maxRules: 2 },
    );
    expect(result.added).toBe(2);
    expect(result.dropped).toBe(1);
    expect(result.warnings[0]).toMatch(/dropped 1 dynamic rule/);
  });

  it('guards the unsafe dynamic rule budget', async () => {
    const filler = Array.from({ length: DNR_LIMITS.MAX_UNSAFE_DYNAMIC_RULES }, (_, i) =>
      redirect(ID_RANGE.USER.start + i),
    );
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: filler as unknown as chrome.declarativeNetRequest.Rule[],
    });
    const result = await dynamic.rewriteRange(dynamic.RANGES.delta, [redirect(0), block(0, 'safe.com')]);
    expect(result.added).toBe(1);
    expect(result.dropped).toBe(1);
    const delta = await dynamic.getRulesInRange(dynamic.RANGES.delta);
    expect(delta[0]?.action.type).toBe('block');
  });
});
