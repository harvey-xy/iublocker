# Testing Strategy

## Unit (Vitest, per package)

- `compiler`: table‑driven parser tests (`test/fixtures/*.txt` + expected JSON), DNR
  conversion snapshots, dedupe/merge property tests, PSL/entity expansion, regex
  validation, ID allocation, delta generation. Target ≥ 90% line coverage.
- `scriptlets`: each scriptlet has a jsdom test that sets up the page global, injects
  the scriptlet the same way the extension does (`new Function` is fine **in tests**),
  and asserts behaviour (e.g. `set-constant` defines, `no-setTimeout-if` defuses).
- `extension`: pure modules (hostname walk, mode resolution, cosmetic lookup, message
  router) tested with a `chrome` mock (`test/chrome-mock.ts`, minimal hand‑written; no
  heavy sinon‑chrome dependency). Content‑script cosmetic engine tested in jsdom.

## Integration (Node)

`packages/compiler/test/integration/` compiles the checked‑in list snapshot in
`e2e/fixtures/lists/` and asserts budget, no duplicate IDs, every regex passes RE2
validation, `report.json` is stable (snapshot).

## E2E (Playwright, `e2e/`)

- Launch Chromium with `--disable-extensions-except=<dist>` `--load-extension=<dist>`
  via `chromium.launchPersistentContext` (headless "new" supports extensions). Use the
  pre‑installed browser (`PLAYWRIGHT_BROWSERS_PATH`), never download in CI containers.
- A local static server (`e2e/server.ts`) on `127.0.0.1:<port>` serves fixture pages
  under `e2e/fixtures/pages/`:
  - `network.html` loads `/ads/banner.js`, `/track/pixel.gif`, an iframe to `/ads/frame.html`
    → assert blocked (script never sets `window.__ad`), image `naturalWidth === 0`.
  - `cosmetic.html` has `.ad-banner`, `#sponsored`, and text‑based procedural cases →
    assert `getComputedStyle(el).display === 'none'` in `optimal` / `complete`.
  - `scriptlet.html` reads `window.adConfig` → `set-constant` must make it `false`.
  - `redirect.html` loads `/ads/gpt.js` → replaced by the surrogate (`window.googletag.cmd` exists).
  - `removeparam.html` navigates with `?utm_source=x` → URL cleaned.
  - `modes.html` verifies `off`/`basic` behaviour through the popup API (messages sent
    from the extension's own page via `page.evaluate` in the popup).
- The e2e list `e2e/fixtures/test-list.txt` targets `127.0.0.1` paths and is compiled
  into the `e2e-test` ruleset only when `IUB_E2E=1`.
- Popup/dashboard smoke tests open `chrome-extension://<id>/popup.html` and assert the
  mode selector round‑trips through storage.

## Real-list load verification (`pnpm verify:real`)

Chrome parses **every static ruleset a manifest declares** when the extension loads —
disabled ones included. One rule it refuses ("Rule with id N specifies an incorrect value
for the urlFilter key") makes it refuse the whole extension, and one rule it _skips_
(a `regexFilter` over its 2 KB compiled-memory budget) silently vanishes from the build.
Unit tests check what the compiler _meant_ to emit; only Chrome can say what it accepted.

`pnpm verify:real` (`tools/verify-real-rulesets.ts`) closes that gap:

1. compiles `.cache/lists` (the live lists, `pnpm rulesets:fetch`) into a **temp**
   directory — `packages/extension/rulesets` and `packages/extension/dist` are never
   touched;
2. builds the extension there (`scripts/build.ts --out <tmp>/dist --rulesets <tmp>/rulesets
--strict`);
3. runs `e2e/tests/real-rulesets.spec.ts` against it with `IUB_REAL_RULESETS_DIST` set;
4. prints rules per list (declared vs what Chrome counted), bytes, registered content
   scripts and the probe outcomes.

The spec is **skipped unless `IUB_REAL_RULESETS_DIST` points at a built extension**, so
plain `pnpm e2e` stays snapshot-based and fast. It overrides the `distPath` fixture option
(`e2e/fixtures/extension.ts`) for its own file; everything else about the launch is the
shared fixture. What it asserts:

- the service worker starts and `chrome.runtime.getManifest()` answers — a build Chrome
  rejects never gets this far — and every declared `rule_resources` path exists in `dist`;
- `getEnabledRulesets()` equals the first-run default set computed from
  `rulesets/manifest.json` for the browser UI language (`defaultEnabled` lists plus
  regional lists matching `chrome.i18n.getUILanguage()`), mirroring
  `background/rulesets/manager.defaultEnabledFor`;
- `getAvailableStaticRuleCount()` clears the `330,000 − budget.staticRulesDefaultEnabled −
1,000` floor **and** equals `330,000` minus exactly the rules the manifest attributes to
  the enabled lists;
- per ruleset: enabling it alone must cost exactly `counts.dnr` rules. This is the check
  that catches rules Chrome silently skips — it found 11 over-budget regexes in the live
  lists (see `MAX_REGEX_PROGRAM_SIZE` in `packages/compiler/src/dnr/re2.ts`). The estimator
  that predicts those skips is calibrated against a real browser by
  `packages/compiler/test/tools/re2-oracle.mjs`, whose verdicts are checked into
  `packages/compiler/test/fixtures/re2-corpus.json` and asserted by `test/dnr-re2.test.ts`;
  re-run the oracle after a lists refresh if new regex filters appear;
- no service-worker console error mentioning `Rule with id`, `rule_resources` or `Invalid`;
- `testMatchOutcome` blocks well-known ad/tracker requests (adsbygoogle, gtm.js, gpt.js,
  analytics.js, ad_status.js) with a `block`/`redirect` rule that really exists in the
  shipped ruleset file, and does **not** block `https://example.com/` or a jQuery CDN URL.
  Coverage of a given URL is list content, not a property of the build, so at least
  `MIN_BLOCKED_PROBES` (3) of the five must be blocked and the summary names the rest;
- `getRegisteredContentScripts()` matches what `scriptlets/registrar.buildDesired` would
  register for the enabled lists (one script per group, split at 1,000 hosts), and every
  `js` file it points at exists in `dist`;
- the message router answers `debug:dumpState` from an extension page with the build's
  ruleset version.

CI runs it nightly (`rulesets-nightly.yml`, right after the fetch + compile) and on every
release before packaging. `ci.yml` stays snapshot-only: it must not depend on the network
or on what upstream lists happen to contain today.

## Manual checklist (release)

`docs/MANUAL-QA.md` (kept short): top 20 sites by region, YouTube (with/without
uBO filters), a news site with anti‑adblock, a site with cookie banners, and a
false‑positive check on a banking site with `basic` mode.
