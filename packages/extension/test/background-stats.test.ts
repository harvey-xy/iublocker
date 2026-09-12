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

const debugMatch = (ruleId: number, url: string, tabId = 7) =>
  ({
    rule: { ruleId, rulesetId: 'easylist' },
    request: { requestId: String(ruleId), url, tabId, frameId: 0, method: 'get', type: 'script' },
  }) as unknown as chrome.declarativeNetRequest.MatchedRuleInfoDebug;

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

    // …and, on top of that, background refreshes are spaced so the quota survives.
    expect(await stats.refreshBadge(7, { now: now + stats.BADGE_THROTTLE_MS })).toBe(3);
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(1);
    expect(await stats.refreshBadge(7, { now: now + stats.BACKGROUND_REFRESH_SPACING_MS })).toBe(3);
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(2);
  });

  it('force bypasses the throttle (popup open)', async () => {
    const now = 2_000_000;
    await stats.refreshBadge(7, { now });
    await stats.refreshBadge(7, { now, force: true });
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(2);
  });

  it('spaces background refreshes globally, but lets a forced one through', async () => {
    // The quota is a single bucket for the whole extension, so two tabs finishing at the
    // same moment must not cost two calls.
    const now = 3_000_000;
    await stats.refreshBadge(7, { now });
    await stats.refreshBadge(9, { now });
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(1);
    await stats.refreshBadge(9, { now, force: true });
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

  it('coalesces the two forced refreshes a popup open produces', async () => {
    const now = 4_000_000;
    await stats.refreshBadge(7, { force: true, now }); // tab:getState
    await stats.refreshBadge(7, { force: true, now: now + 5 }); // stats:get
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(1);
    await stats.refreshBadge(7, { force: true, now: now + stats.FORCED_COALESCE_MS });
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(2);
  });

  it('drops the previous document count from the badge on a main-frame commit', async () => {
    const now = 5_000_000;
    await stats.refreshBadge(7, { force: true, now });
    expect(chromeMock._state.badge(7)).toBe('3');
    stats.resetTab(7, now + 1);
    // The next refresh can be seconds away (quota): the old number must not linger.
    expect(chromeMock._state.badge(7)).toBe('');
  });

  it('scopes the query to the current document after a main-frame commit', async () => {
    stats.resetTab(7, 5_000);
    await stats.refreshBadge(7, { force: true });
    expect(chromeMock._state.calls.getMatchedRules[0]).toMatchObject({ tabId: 7, minTimeStamp: 5_000 });
  });
});

describe('stats: getMatchedRules quota', () => {
  let chromeMock: ReturnType<typeof resetBackground>;
  beforeEach(() => {
    chromeMock = resetBackground();
    chromeMock._state.setMatchedRules(matched(2));
  });

  it('never spends more calls than Chrome allows per interval', async () => {
    const start = 10_000_000;
    for (let i = 0; i < stats.MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL * 2; i++) {
      // A different tab every time: per-tab throttles must not be what limits this.
      await stats.refreshBadge(100 + i, { force: true, now: start + i * stats.FORCED_COALESCE_MS });
    }
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(
      stats.MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL,
    );
    expect(stats.quotaRemaining(start + 1_000)).toBe(0);
  });

  it('keeps a reserve of calls for refreshes the user is waiting for', async () => {
    const start = 20_000_000;
    const background = stats.MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL - stats.RESERVED_FORCED_CALLS;
    for (let i = 0; i < background; i++) {
      await stats.refreshBadge(200 + i, { force: true, now: start + i * stats.FORCED_COALESCE_MS });
    }
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(background);

    const now = start + (background + 1) * stats.FORCED_COALESCE_MS;
    await stats.refreshBadge(300, { now }); // background: the shared budget is used up
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(background);
    await stats.refreshBadge(301, { force: true, now }); // popup: reserved calls remain
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(background + 1);
  });

  it('remembers the calls it spent across a worker restart', async () => {
    const start = 30_000_000;
    for (let i = 0; i < stats.MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL; i++) {
      await stats.refreshBadge(400 + i, { force: true, now: start + i * stats.FORCED_COALESCE_MS });
    }
    const spent = chromeMock._state.calls.getMatchedRules.length;
    expect(spent).toBe(stats.MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL);

    stats.__resetForTests(); // the worker was killed; only session storage survives
    await stats.refreshBadge(7, { force: true, now: start + 60_000 });
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(spent);
  });

  it('keeps the last known count instead of zeroing the badge when the quota is spent', async () => {
    const start = 40_000_000;
    chromeMock._state.setMatchedRules(matched(4));
    expect(await stats.refreshBadge(7, { force: true, now: start })).toBe(4);
    for (let i = 1; i <= stats.MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL; i++) {
      await stats.refreshBadge(500 + i, { force: true, now: start + i * stats.FORCED_COALESCE_MS });
    }
    const spent = chromeMock._state.calls.getMatchedRules.length;
    const total = (await stats.getStats()).blockedTotal;

    stats.__resetForTests(); // per-tab counters are gone, the quota log is not
    expect(await stats.refreshBadge(7, { force: true, now: start + 100_000 })).toBe(4);
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(spent);
    expect(chromeMock._state.badge(7)).toBe('4');
    // The 4 matches were counted before the restart; they must not be added twice.
    expect((await stats.getStats()).blockedTotal).toBe(total);
  });
});

describe('stats: onRuleMatchedDebug feed (unpacked installs)', () => {
  let chromeMock: ReturnType<typeof resetBackground>;
  beforeEach(() => {
    chromeMock = resetBackground();
    chromeMock._state.setMatchedRules(matched(99));
  });

  it('counts matches from the event and stops calling getMatchedRules', async () => {
    stats.resetTab(7, 1_000);
    stats.noteMatchedRule(debugMatch(1, 'https://ads.example/a.js'));
    stats.noteMatchedRule(debugMatch(2, 'https://ads.example/b.js'));
    expect(stats.usesDebugFeed()).toBe(true);

    expect(await stats.refreshBadge(7, { force: true })).toBe(2);
    expect(chromeMock._state.calls.getMatchedRules).toHaveLength(0);
    expect(chromeMock._state.badge(7)).toBe('2');
    expect((await stats.getStats()).blockedTotal).toBe(2);
    expect((await store.session.getTab(7))?.blocked).toBe(2);
    expect(stats.getBlockedUrls(7)).toEqual([
      'https://ads.example/a.js',
      'https://ads.example/b.js',
    ]);
    expect((await stats.getMatchedForTab(7)).map((m) => m.url)).toEqual([
      'https://ads.example/a.js',
      'https://ads.example/b.js',
    ]);
  });

  it('adds only the increment to the daily totals', async () => {
    const now = 6_000_000;
    stats.noteMatchedRule(debugMatch(1, 'https://ads.example/a.js'));
    await stats.refreshBadge(7, { force: true, now });
    stats.noteMatchedRule(debugMatch(2, 'https://ads.example/b.js'));
    stats.noteMatchedRule(debugMatch(3, 'https://ads.example/c.js'));
    await stats.refreshBadge(7, { force: true, now: now + stats.FORCED_COALESCE_MS });
    const totals = await stats.getStats();
    expect(totals.blockedTotal).toBe(3);
    expect(totals.perDay[stats.dayKey()]).toBe(3);
  });

  it('forgets a closed tab', () => {
    stats.noteMatchedRule(debugMatch(1, 'https://ads.example/a.js'));
    stats.forgetTab(7);
    expect(stats.getBlockedUrls(7)).toEqual([]);
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
    const now = 7_000_000;
    chromeMock._state.setMatchedRules(matched(2));
    await stats.refreshBadge(7, { force: true, now });
    chromeMock._state.setMatchedRules(matched(5));
    await stats.refreshBadge(7, { force: true, now: now + stats.FORCED_COALESCE_MS });
    const totals = await stats.getStats();
    expect(totals.blockedTotal).toBe(5);
    expect(totals.perDay[stats.dayKey()]).toBe(5);
  });

  it('never counts the same match twice when getMatchedRules forgets old matches', async () => {
    // Chrome drops matches older than five minutes for documents that are not active.
    const now = 8_000_000;
    chromeMock._state.setMatchedRules(matched(10));
    await stats.refreshBadge(7, { force: true, now });
    chromeMock._state.setMatchedRules(matched(6));
    await stats.refreshBadge(7, { force: true, now: now + stats.FORCED_COALESCE_MS });
    chromeMock._state.setMatchedRules(matched(10));
    await stats.refreshBadge(7, { force: true, now: now + 2 * stats.FORCED_COALESCE_MS });
    expect((await stats.getStats()).blockedTotal).toBe(10);
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
    stats.noteMatchedRule(debugMatch(1, 'https://ads.example/a.js'));
    expect(stats.getBlockedUrls(7)).toEqual(['https://ads.example/a.js']);
    expect(stats.getBlockedUrls(8)).toEqual([]);
  });
});
