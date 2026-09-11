#!/usr/bin/env node
/**
 * RE2 oracle — asks a real Chromium what it does with a `regexFilter`.
 *
 * Dev tool, not a test. `packages/compiler/src/dnr/re2.ts` has to *predict*, at build
 * time, whether Chrome will accept a regex: Chrome compiles `condition.regexFilter` with
 * RE2 under a 2 KB memory budget and silently **skips** any static rule that does not
 * fit ("Rule with id N was skipped as the regexFilter value exceeded the 2KB memory limit
 * when compiled"). This script is how `estimateProgramSize` gets calibrated: it feeds a
 * corpus of regexes to the browser and records the ground truth.
 *
 * Two verdicts are recorded per regex:
 *   - `chromeAccepts` — whether `declarativeNetRequest.updateDynamicRules()` takes a rule
 *     carrying the regex. This is the authoritative answer (the same RE2 compile path the
 *     static rulesets go through); rejections come back as an exception naming the reason.
 *     Rules are submitted in batches and a failing batch is bisected, so the per-regex
 *     cost is ~log2(batch) round trips instead of one each.
 *   - `isRegexSupported` — what `declarativeNetRequest.isRegexSupported()` reports. It is
 *     the documented API for this question and usually agrees, so a disagreement is worth
 *     knowing about.
 *
 * Usage:
 *   node packages/compiler/test/tools/re2-oracle.mjs <input.json> [--out <out.json>]
 *                                                    [--dist <unpacked extension dir>]
 *
 * <input.json> is either `["regex", …]` or `[{ "regex": "…" }, …]` (extra keys are kept).
 * Output is `[{ regex, chromeAccepts, isRegexSupported, error? }, …]` on stdout, or to
 * `--out`. Progress goes to stderr.
 *
 * Chromium must be the pre-installed Playwright build ($PLAYWRIGHT_BROWSERS_PATH); never
 * run `playwright install`. Any unpacked MV3 build works as the host extension — the tool
 * only needs a service worker with the `declarativeNetRequest` permission.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
/** Repo root, four levels up from packages/compiler/test/tools. */
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');

/** Dynamic-rule ID range reserved for tooling (docs/FILTER-SYNTAX.md §6 leaves 300k+ dynamic). */
const FIRST_RULE_ID = 300_000;
/** Chrome caps dynamic regex rules at 1,000; stay well under so a batch never fails for that. */
const BATCH_SIZE = 200;

function parseArgs(argv) {
  const args = { input: undefined, out: undefined, dist: process.env.IUB_ORACLE_DIST };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') args.out = argv[(i += 1)];
    else if (a === '--dist') args.dist = argv[(i += 1)];
    else if (!args.input) args.input = a;
  }
  return args;
}

/**
 * Resolve Playwright. It is an e2e-only devDependency, so it is not hoisted to the repo
 * root; fall back to the pnpm store rather than adding a dependency for a dev tool.
 */
function loadPlaywright() {
  for (const id of ['playwright', '@playwright/test']) {
    try {
      return require_(id);
    } catch {
      /* try the next one */
    }
  }
  const store = path.join(ROOT, 'node_modules', '.pnpm');
  const dir = (fs.existsSync(store) ? fs.readdirSync(store) : []).find((d) => d.startsWith('playwright@'));
  if (dir) return require_(path.join(store, dir, 'node_modules', 'playwright'));
  throw new Error('playwright not found — it is installed for e2e/ (pnpm install)');
}

/** Locate the Playwright chromium that is already on disk. */
function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const candidates = [];
  for (const dir of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    if (!dir.startsWith('chromium-')) continue;
    candidates.push(path.join(root, dir, 'chrome-linux', 'chrome'));
  }
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`no chromium under ${root} — do not run "playwright install", ask for the image's build`);
  return found;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('usage: re2-oracle.mjs <input.json> [--out out.json] [--dist extension-dir]');
    process.exit(2);
  }
  if (!args.dist) {
    console.error('no extension build given: pass --dist <unpacked dir> or set IUB_ORACLE_DIST');
    process.exit(2);
  }

  const raw = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  const entries = raw.map((e) => (typeof e === 'string' ? { regex: e } : e));
  const regexes = entries.map((e) => e.regex);
  console.error(`oracle: ${regexes.length} regexes, extension ${args.dist}`);

  const { chromium } = loadPlaywright();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'iub-re2-oracle-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: findChromium(),
    args: [`--disable-extensions-except=${args.dist}`, `--load-extension=${args.dist}`, '--no-sandbox'],
  });

  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
    // The worker registers its own rules on install; let it settle before we add ours.
    await new Promise((r) => setTimeout(r, 2000));

    /** `isRegexSupported` verdict per regex — cheap, one call each, never throws. */
    const supported = [];
    for (let i = 0; i < regexes.length; i += BATCH_SIZE) {
      const chunk = regexes.slice(i, i + BATCH_SIZE);
      const res = await sw.evaluate(async (list) => {
        const out = [];
        for (const regex of list) {
          try {
            const r = await chrome.declarativeNetRequest.isRegexSupported({ regex, isCaseSensitive: false });
            out.push({ isSupported: r.isSupported === true, reason: r.reason ?? null });
          } catch (e) {
            out.push({ isSupported: false, reason: String((e && e.message) || e) });
          }
        }
        return out;
      }, chunk);
      supported.push(...res);
      console.error(`  isRegexSupported ${Math.min(i + BATCH_SIZE, regexes.length)}/${regexes.length}`);
    }

    /**
     * `updateDynamicRules` verdict. Chrome rejects the *whole* call when any rule in it is
     * bad, so a failing batch is bisected down to the individual offender(s); a batch that
     * goes through tells us every regex in it is fine in one round trip.
     */
    const verdict = new Map();
    const tryBatch = (indices) =>
      sw.evaluate(
        async ({ list, first }) => {
          const rules = list.map(({ regex }, i) => ({
            id: first + i,
            priority: 1,
            action: { type: 'block' },
            condition: { regexFilter: regex, resourceTypes: ['script'] },
          }));
          const ids = rules.map((r) => r.id);
          try {
            await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids, addRules: rules });
          } catch (e) {
            return String((e && e.message) || e);
          } finally {
            try {
              await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
            } catch {
              /* the add failed, so there is nothing to clean up */
            }
          }
          return null;
        },
        { list: indices.map((i) => ({ regex: regexes[i] })), first: FIRST_RULE_ID },
      );

    const bisect = async (indices) => {
      if (indices.length === 0) return;
      const err = await tryBatch(indices);
      if (err === null) {
        for (const i of indices) verdict.set(i, { accepts: true, error: null });
        return;
      }
      if (indices.length === 1) {
        verdict.set(indices[0], { accepts: false, error: err });
        return;
      }
      const mid = indices.length >> 1;
      await bisect(indices.slice(0, mid));
      await bisect(indices.slice(mid));
    };

    for (let i = 0; i < regexes.length; i += BATCH_SIZE) {
      const indices = [];
      for (let j = i; j < Math.min(i + BATCH_SIZE, regexes.length); j += 1) indices.push(j);
      await bisect(indices);
      console.error(`  updateDynamicRules ${Math.min(i + BATCH_SIZE, regexes.length)}/${regexes.length}`);
    }

    const results = entries.map((entry, i) => {
      const v = verdict.get(i) ?? { accepts: false, error: 'no verdict' };
      const s = supported[i] ?? { isSupported: false, reason: 'no verdict' };
      return {
        ...entry,
        chromeAccepts: v.accepts,
        isRegexSupported: s.isSupported,
        ...(v.error ? { error: v.error } : {}),
        ...(s.reason ? { isRegexSupportedReason: s.reason } : {}),
      };
    });

    const rejected = results.filter((r) => !r.chromeAccepts).length;
    const disagree = results.filter((r) => r.chromeAccepts !== r.isRegexSupported).length;
    console.error(`oracle: ${results.length} regexes, ${rejected} rejected by Chrome, ${disagree} where isRegexSupported disagrees`);

    const json = JSON.stringify(results, null, 2);
    if (args.out) fs.writeFileSync(args.out, `${json}\n`);
    else process.stdout.write(`${json}\n`);
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

await main();
