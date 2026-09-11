import { beforeEach, describe, expect, it } from 'vitest';
import * as stats from '../src/background/stats';
import * as store from '../src/background/storage/store';
import { resetBackground } from './background-utils';

const matched = (n: number, timeStamp = Date.now()) =>
  Array.from({ length: n }, (_, i) => ({
    rule: { ruleId: i + 1, rulesetId: 'easylist' },
    tabId: 7,
    timeStamp,
  }));

describe('stats: badge throttling', () => {
  let chromeMock: ReturnType<typeof resetBackground>;
  beforeEach(() => {
    chromeMock = resetBackground();
    chromeMock._state.setMatchedRules(matched(3));
  });

  it('calls getMatchedRules at most once per second per tab', async () => {
    const now = 1_000_000;
    expect(await stats.refreshBadge(7, { now })).toBe(3);
    expect(await stats.refreshBadge(7, { now: now + 500 })).toBe(3);
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(1);

    expect(await stats.refreshBadge(7, { now: now + stats.BADGE_THROTTLE_MS })).toBe(3);
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(2);
  });

  it('force bypasses the throttle (popup open)', async () => {
    const now = 2_000_000;
    await stats.refreshBadge(7, { now });
    await stats.refreshBadge(7, { now, force: true });
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(2);
  });

  it('throttles per tab, not globally', async () => {
    const now = 3_000_000;
    await stats.refreshBadge(7, { now });
    await stats.refreshBadge(9, { now });
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(2);
  });

  it('shares one in-flight call between concurrent callers', async () => {
    const [a, b] = await Promise.all([
      stats.refreshBadge(7, { force: true }),
      stats.refreshBadge(7, { force: true }),
    ]);
    expect(a).toBe(b);
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(1);
  });

  it('scopes the query to the current document after a main-frame commit', async () => {
    stats.resetTab(7, 5_000);
    await stats.refreshBadge(7, { force: true });
    expect(chromeMock._state.calls.getMatchedRules[0]).toMatchObject({ tabId: 7, minTimeStamp: 5_000 });
  });
});

describe('stats: badge and totals', () => {
  let chromeMock: ReturnType<typeof resetBackground>;
  beforeEach(() => {
    chromeMock = resetBackground();
  });

  it('writes the badge text and the session state', async () => {
    chromeMock._state.setMatchedRules(matched(2));
    await stats.refreshBadge(7, { force: true });
    expect(chromeMock._state.badge(7)).toBe('2');
    expect((await store.session.getTab(7))?.blocked).toBe(2);
  });

  it('caps the badge at 999+', async () => {
    chromeMock._state.setMatchedRules(matched(1200));
    await stats.refreshBadge(7, { force: true });
    expect(chromeMock._state.badge(7)).toBe('999+');
  });

  it('honours showBadgeCount', async () => {
    const settings = await store.get('settings');
    await store.set({ settings: { ...settings, showBadgeCount: false } });
    chromeMock._state.setMatchedRules(matched(2));
    await stats.refreshBadge(7, { force: true });
    expect(chromeMock._state.badge(7)).toBe('');
  });

  it('adds only the increment to the daily totals', async () => {
    chromeMock._state.setMatchedRules(matched(2));
    await stats.refreshBadge(7, { force: true });
    chromeMock._state.setMatchedRules(matched(5));
    await stats.refreshBadge(7, { force: true });
    const totals = await stats.getStats();
    expect(totals.blockedTotal).toBe(5);
    expect(totals.perDay[stats.dayKey()]).toBe(5);
  });

  it('resets and forgets tabs', async () => {
    chromeMock._state.setMatchedRules(matched(2));
    await stats.refreshBadge(7, { force: true });
    expect((await stats.resetStats()).blockedTotal).toBe(0);
    expect(await stats.getTabBlocked(7)).toBe(0);
    stats.forgetTab(7);
    expect(await stats.getTabBlocked(7)).toBe(2); // falls back to the session record
  });

  it('collects blocked URLs from onRuleMatchedDebug', () => {
    stats.noteMatchedRule({
      rule: { ruleId: 1, rulesetId: 'easylist' },
      request: {
        requestId: '1',
        url: 'https://ads.example/a.js',
        tabId: 7,
        frameId: 0,
        method: 'get',
        type: 'script',
      },
    } as unknown as chrome.declarativeNetRequest.MatchedRuleInfoDebug);
    expect(stats.getBlockedUrls(7)).toEqual(['https://ads.example/a.js']);
    expect(stats.getBlockedUrls(8)).toEqual([]);
  });
});
