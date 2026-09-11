/**
 * Real-list load verification — docs/TESTING.md "Real-list load verification".
 *
 * Unit tests cannot catch what Chrome's own DNR validator refuses: Chrome parses **every
 * declared static ruleset** when the extension loads (disabled ones included), so a single
 * rule it rejects takes the whole extension down, and a rule it *skips* (an over-budget
 * `regexFilter`, say) silently disappears from the build. The only way to know is to hand
 * a real-list build to Chrome and ask it what it got.
 *
 * The suite is skipped unless `IUB_REAL_RULESETS_DIST` points at a built extension
 * directory, so `pnpm e2e` stays snapshot-based and fast. `pnpm verify:real`
 * (tools/verify-real-rulesets.ts) compiles `.cache/lists` into a temp directory, builds
 * the extension there and runs this file against it.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RulesetManifest } from '../../packages/shared/src/rulesets';
import { EXTENSION_DIST } from '../fixtures/paths';
import { expect, test } from '../fixtures/extension';

const REAL_DIST = process.env.IUB_REAL_RULESETS_DIST
  ? path.resolve(process.env.IUB_REAL_RULESETS_DIST)
  : undefined;

/** Chrome's global static-rule budget (packages/shared DNR_LIMITS.GLOBAL_STATIC_RULES). */
const GLOBAL_STATIC_RULES = 330_000;

/** Hosts per registered content script (background/scriptlets/registrar MAX_HOSTS_PER_SCRIPT). */
const MAX_HOSTS_PER_SCRIPT = 1_000;

/** How many of the well-known ad/tracker probes must actually be blocked. */
const MIN_BLOCKED_PROBES = 3;

/** Console output Chrome produces when it refuses a ruleset or a rule. */
const RULESET_ERROR = /rule with id|rule_resources|invalid/i;

test.skip(
  REAL_DIST === undefined,
  'set IUB_REAL_RULESETS_DIST=<built extension dir> to run it (pnpm verify:real does)',
);
test.use({ distPath: REAL_DIST ?? EXTENSION_DIST });

/* ------------------------------------------------------------------ dist helpers -- */

function distDir(): string {
  if (!REAL_DIST) throw new Error('IUB_REAL_RULESETS_DIST is not set');
  return REAL_DIST;
}

async function readJson<T>(...segments: string[]): Promise<T> {
  return JSON.parse(await readFile(path.join(distDir(), ...segments), 'utf8')) as T;
}

async function rulesetManifest(): Promise<RulesetManifest> {
  return readJson<RulesetManifest>('rulesets', 'manifest.json');
}

interface DnrRule {
  id: number;
  action: { type: string };
  condition: Record<string, unknown>;
}

const ruleCache = new Map<string, Promise<DnrRule[]>>();

function rulesOf(rulesetId: string): Promise<DnrRule[]> {
  let rules = ruleCache.get(rulesetId);
  if (!rules) {
    rules = readJson<DnrRule[]>('rulesets', 'dnr', `${rulesetId}.json`);
    ruleCache.set(rulesetId, rules);
  }
  return rules;
}

async function ruleById(rulesetId: string, ruleId: number): Promise<DnrRule | undefined> {
  return (await rulesOf(rulesetId)).find((rule) => rule.id === ruleId);
}

/**
 * The lists a fresh profile enables, mirroring `background/rulesets/manager`
 * `defaultEnabledFor`: everything marked `defaultEnabled`, plus regional lists whose
 * language matches the browser UI language.
 */
function expectedEnabledIds(manifest: RulesetManifest, languages: readonly string[]): string[] {
  const langs = languages.map((l) => l.toLowerCase());
  return manifest.lists
    .filter((entry) => {
      if (entry.defaultEnabled) return true;
      if (entry.group !== 'regional') return false;
      return (entry.lang ?? []).some((raw) => {
        const lang = raw.toLowerCase();
        return langs.some((have) => have === lang || have.split('-')[0] === lang.split('-')[0]);
      });
    })
    .map((entry) => entry.id);
}

/**
 * The content scripts the registrar wants for `enabled`, mirroring
 * `background/scriptlets/registrar` `buildDesired`: one script per scriptlet group (there
 * is one group per scriptlet *name*) whose list is enabled, split into chunks of
 * MAX_HOSTS_PER_SCRIPT hosts — or a single all-URLs script when the group's hosts are the
 * generic `"*"`.
 */
function expectedScripts(
  manifest: RulesetManifest,
  enabled: ReadonlySet<string>,
): { count: number; files: string[] } {
  let count = 0;
  const files = new Set<string>();
  for (const group of manifest.scriptletGroups ?? []) {
    const listIds = group.listIds ?? [];
    if (listIds.length > 0 && !listIds.some((id) => enabled.has(id))) continue;
    let hosts = (group.hosts ?? []).filter((host) => typeof host === 'string' && host.length > 0);
    // `hostLists[i]` says which of `listIds` put host `i` there; a host only a disabled list
    // asks for is not registered (background/scriptlets/registrar `enabledHosts`).
    const masks = group.hostLists;
    if (Array.isArray(masks) && masks.length === hosts.length) {
      let enabledMask = 0;
      listIds.forEach((id, index) => {
        if (index < 31 && enabled.has(id)) enabledMask |= 1 << index;
      });
      hosts = hosts.filter((_, index) => ((masks[index] ?? 0) & enabledMask) !== 0);
    }
    if (hosts.length === 0) continue;
    count += hosts.includes('*') ? 1 : Math.ceil(hosts.length / MAX_HOSTS_PER_SCRIPT);
    for (const file of [...(group.libs ?? []), group.file]) {
      if (typeof file === 'string' && file.length > 0) files.add(file);
    }
  }
  return { count, files: [...files] };
}

/* ---------------------------------------------------------------------- probes -- */

interface Probe {
  url: string;
  type: string;
  initiator?: string;
}

/**
 * Well-known ad and tracker requests. Which list covers which URL is list content, not a
 * property of the build, so the suite requires MIN_BLOCKED_PROBES of them rather than all
 * — the summary names the ones that got through.
 */
const AD_PROBES: Probe[] = [
  {
    url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    type: 'script',
    initiator: 'https://example.com',
  },
  {
    url: 'https://www.googletagmanager.com/gtm.js?id=GTM-X',
    type: 'script',
    initiator: 'https://example.com',
  },
  {
    url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
    type: 'script',
    initiator: 'https://example.com',
  },
  { url: 'https://www.google-analytics.com/analytics.js', type: 'script', initiator: 'https://example.com' },
  {
    url: 'https://static.doubleclick.net/instream/ad_status.js',
    type: 'script',
    initiator: 'https://example.com',
  },
];

/** Requests that must survive: a plain page and a CDN library. */
const CLEAN_PROBES: Probe[] = [
  { url: 'https://example.com/', type: 'main_frame' },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js',
    type: 'script',
    initiator: 'https://example.com',
  },
];

interface MatchedRule {
  ruleId: number;
  rulesetId: string;
}

const BLOCKING_ACTIONS = new Set(['block', 'redirect', 'upgradeScheme']);

interface ProbeResult extends Probe {
  blocked: boolean;
  matched: { rulesetId: string; ruleId: number; action: string }[];
}

/* --------------------------------------------------------------------- summary -- */

const summary: Record<string, unknown> = {};

test.afterAll(async () => {
  const out = process.env.IUB_REAL_RULESETS_SUMMARY;
  if (!out || Object.keys(summary).length === 0) return;
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(path.resolve(out), `${JSON.stringify(summary, null, 2)}\n`);
});

/* ----------------------------------------------------------------------- tests -- */

test('Chrome loads the real build and its service worker comes up', async ({ sw, swConsole }) => {
  const manifest = await sw.evaluate(() => (globalThis as any).chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(typeof manifest.version).toBe('string');

  const declared: { id: string; enabled: boolean; path: string }[] =
    manifest.declarative_net_request?.rule_resources ?? [];
  const ruleset = await rulesetManifest();
  expect(declared.map((entry) => entry.id).sort()).toEqual(ruleset.lists.map((entry) => entry.id).sort());
  for (const entry of declared) expect(existsSync(path.join(distDir(), entry.path))).toBe(true);

  // The worker answers, which is the point: a ruleset Chrome refuses takes it down.
  const version = await sw.evaluate(async () => {
    const res = await fetch((globalThis as any).chrome.runtime.getURL('rulesets/manifest.json'));
    return (await res.json()).version as string;
  });
  expect(version).toBe(ruleset.version);

  const errors = swConsole.filter((entry) => entry.type === 'error' && RULESET_ERROR.test(entry.text));
  expect(errors, `service worker reported ruleset errors: ${JSON.stringify(errors)}`).toEqual([]);

  summary.build = {
    extensionVersion: manifest.version,
    rulesetVersion: ruleset.version,
    declaredRulesets: declared.length,
    lists: ruleset.lists.map((entry) => ({
      id: entry.id,
      defaultEnabled: entry.defaultEnabled,
      rules: entry.counts.dnr,
      regex: entry.counts.regex,
    })),
    budget: ruleset.budget,
  };
});

test('the enabled rulesets are the manifest defaults for the browser UI language', async ({ sw }) => {
  const ruleset = await rulesetManifest();
  const { enabled, languages, available } = await sw.evaluate(async () => {
    const chrome = (globalThis as any).chrome;
    const ui = new Set<string>();
    const uiLanguage = chrome.i18n?.getUILanguage?.();
    if (uiLanguage) ui.add(uiLanguage);
    for (const lang of navigator.languages ?? []) ui.add(lang);
    return {
      enabled: (await chrome.declarativeNetRequest.getEnabledRulesets()) as string[],
      languages: [...ui],
      available: (await chrome.declarativeNetRequest.getAvailableStaticRuleCount()) as number,
    };
  });

  expect([...enabled].sort()).toEqual(expectedEnabledIds(ruleset, languages).sort());

  // Sanity floor from docs/RULESETS.md §3: the default set must leave room for extras.
  expect(available).toBeGreaterThanOrEqual(
    GLOBAL_STATIC_RULES - ruleset.budget.staticRulesDefaultEnabled - 1_000,
  );

  // Sharper: Chrome charges exactly the rules it actually loaded, so the remaining budget
  // must equal the global limit minus what the manifest says the enabled lists hold. A
  // rule Chrome skipped (an over-budget regexFilter, a condition it does not understand)
  // shows up here and nowhere else.
  const declaredRules = ruleset.lists
    .filter((entry) => enabled.includes(entry.id))
    .reduce((sum, entry) => sum + entry.counts.dnr, 0);
  expect(
    GLOBAL_STATIC_RULES - available,
    `Chrome loaded ${GLOBAL_STATIC_RULES - available} rules for [${enabled.join(', ')}], the ruleset manifest declares ${declaredRules}`,
  ).toBe(declaredRules);

  summary.defaultProfile = { enabled, languages, availableStaticRuleCount: available, declaredRules };
});

test('every declared ruleset loads with exactly the rules the manifest declares', async ({ sw }) => {
  test.slow();
  const ruleset = await rulesetManifest();
  const ids = ruleset.lists.map((entry) => entry.id);

  // Enable one list at a time and watch the remaining static-rule budget: the difference
  // is the number of rules Chrome accepted from it.
  const counted = await sw.evaluate(async (ids: string[]) => {
    const dnr = (globalThis as any).chrome.declarativeNetRequest;
    const initial: string[] = await dnr.getEnabledRulesets();
    await dnr.updateEnabledRulesets({ disableRulesetIds: initial });
    const empty: number = await dnr.getAvailableStaticRuleCount();
    const out: Record<string, number> = {};
    for (const id of ids) {
      await dnr.updateEnabledRulesets({ enableRulesetIds: [id] });
      out[id] = empty - (await dnr.getAvailableStaticRuleCount());
      await dnr.updateEnabledRulesets({ disableRulesetIds: [id] });
    }
    await dnr.updateEnabledRulesets({ enableRulesetIds: initial });
    return out;
  }, ids);

  const mismatches = ruleset.lists
    .filter((entry) => counted[entry.id] !== entry.counts.dnr)
    .map((entry) => `${entry.id}: manifest ${entry.counts.dnr}, Chrome ${counted[entry.id]}`);
  expect(
    mismatches,
    'Chrome skipped rules from these rulesets — the compiler emitted something it will not take',
  ).toEqual([]);

  summary.rulesPerList = counted;
});

test('well-known ad and tracker requests are blocked, ordinary ones are not', async ({ sw }) => {
  test.slow();
  const ruleset = await rulesetManifest();

  // Probe against everything the build ships, not just the default profile: which list
  // carries a given ad domain differs per snapshot, and enabling them all is still well
  // inside Chrome's budget for a build that passed docs/RULESETS.md §3.
  const enabled = await sw.evaluate(
    async (ids: string[]) => {
      const dnr = (globalThis as any).chrome.declarativeNetRequest;
      const current: string[] = await dnr.getEnabledRulesets();
      const missing = ids.filter((id) => !current.includes(id));
      for (const id of missing) {
        try {
          await dnr.updateEnabledRulesets({ enableRulesetIds: [id] });
        } catch {
          /* out of budget or over the enabled-ruleset cap — the rest still count */
        }
      }
      return (await dnr.getEnabledRulesets()) as string[];
    },
    ruleset.lists.map((entry) => entry.id),
  );
  expect(enabled.length).toBeGreaterThanOrEqual(ruleset.lists.filter((entry) => entry.defaultEnabled).length);

  const run = async (probe: Probe): Promise<ProbeResult> => {
    const matched: MatchedRule[] = await sw.evaluate(async (probe: Probe) => {
      const result = await (globalThis as any).chrome.declarativeNetRequest.testMatchOutcome({
        url: probe.url,
        type: probe.type,
        method: 'get',
        ...(probe.initiator ? { initiator: probe.initiator } : {}),
      });
      return result.matchedRules ?? [];
    }, probe);

    const withActions = [];
    for (const hit of matched) {
      const rule = await ruleById(hit.rulesetId, hit.ruleId);
      withActions.push({
        rulesetId: hit.rulesetId,
        ruleId: hit.ruleId,
        action: rule?.action.type ?? 'unknown',
      });
    }
    return {
      ...probe,
      blocked: withActions.some((hit) => BLOCKING_ACTIONS.has(hit.action)),
      matched: withActions,
    };
  };

  const ads: ProbeResult[] = [];
  for (const probe of AD_PROBES) ads.push(await run(probe));
  const clean: ProbeResult[] = [];
  for (const probe of CLEAN_PROBES) clean.push(await run(probe));

  const blocked = ads.filter((probe) => probe.blocked);
  expect(
    blocked.length,
    `only ${blocked.length} of ${ads.length} ad probes were blocked; not blocked: ${ads
      .filter((probe) => !probe.blocked)
      .map((probe) => probe.url)
      .join(', ')}`,
  ).toBeGreaterThanOrEqual(MIN_BLOCKED_PROBES);

  // Every hit must come from a rule that really is in the shipped ruleset file.
  for (const probe of blocked) {
    for (const hit of probe.matched) {
      expect(await ruleById(hit.rulesetId, hit.ruleId), `${hit.rulesetId}#${hit.ruleId}`).toBeDefined();
    }
  }

  for (const probe of clean) {
    expect(probe.blocked, `${probe.url} must not be blocked: ${JSON.stringify(probe.matched)}`).toBe(false);
  }

  summary.probes = { enabledRulesets: enabled, blocked: ads, clean };
});

test('the registered scriptlet content scripts match the manifest and their files exist', async ({ sw }) => {
  const ruleset = await rulesetManifest();
  const { enabled, registered } = await sw.evaluate(async () => {
    const chrome = (globalThis as any).chrome;
    return {
      enabled: (await chrome.declarativeNetRequest.getEnabledRulesets()) as string[],
      registered: (await chrome.scripting.getRegisteredContentScripts()) as {
        id: string;
        js?: string[];
      }[],
    };
  });

  const expected = expectedScripts(ruleset, new Set(enabled));
  // Registration runs in batches after install. One group per scriptlet name keeps that to
  // a few dozen entries, but it is still asynchronous — wait for the count to settle.
  const started = Date.now();
  while (registered.length !== expected.count && Date.now() - started < 120_000) {
    await new Promise((r) => setTimeout(r, 500));
    registered.length = 0;
    registered.push(
      ...(await sw.evaluate(
        async () =>
          (await (globalThis as any).chrome.scripting.getRegisteredContentScripts()) as {
            id: string;
            js?: string[];
          }[],
      )),
    );
  }
  summary.registrationMs = Date.now() - started;
  expect(registered.length).toBe(expected.count);

  const missing: string[] = [];
  for (const script of registered) {
    for (const file of script.js ?? []) {
      const rel = file.startsWith('rulesets/') ? file : `rulesets/${file.replace(/^\/+/, '')}`;
      if (!existsSync(path.join(distDir(), rel))) missing.push(`${script.id}: ${rel}`);
    }
  }
  expect(missing, 'registered content scripts point at files that are not in the build').toEqual([]);

  summary.scriptlets = {
    groups: (ruleset.scriptletGroups ?? []).length,
    hosts: (ruleset.scriptletGroups ?? []).reduce((n, group) => n + (group.hosts ?? []).length, 0),
    registeredScripts: registered.length,
    files: expected.files.length,
  };
});

test('the message router answers from an extension page', async ({ sendRequest }) => {
  const ruleset = await rulesetManifest();
  const state = await sendRequest<{
    rulesetVersion: string;
    enabledLists: string[];
    registeredScriptletGroups: number;
  }>({ type: 'debug:dumpState' });

  expect(state.rulesetVersion).toBe(ruleset.version);
  expect(Array.isArray(state.enabledLists)).toBe(true);
  expect(state.enabledLists.length).toBeGreaterThan(0);
});
