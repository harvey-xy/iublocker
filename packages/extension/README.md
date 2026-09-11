# @iublocker/extension

The Chrome (MV3) extension: service worker, content scripts, UI pages and the build that
assembles `dist/`. Architecture: [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

## Build

```bash
pnpm --filter @iublocker/extension build            # dist/, sourcemaps, unminified
pnpm --filter @iublocker/extension build -- --minify
pnpm --filter @iublocker/extension build:watch      # esbuild watch mode
```

`scripts/build.ts` flags:

| Flag              | Effect                                                                            |
| ----------------- | --------------------------------------------------------------------------------- |
| `--watch`         | keep esbuild contexts alive and rebuild on change (static assets are copied once) |
| `--minify`        | minify and drop sourcemaps (implied by `NODE_ENV=production`)                     |
| `--out <dir>`     | write somewhere other than `dist/` (used by the build smoke test)                 |
| `--strict`        | fail instead of warning when `rulesets/` (compiler output) is missing             |
| `--skip-rulesets` | build without any static ruleset                                                  |
| `--e2e`           | also declare the `e2e-test` ruleset, enabled (same as `IUB_E2E=1`)                |

Steps: clean `dist/` → bundle every entry point **that exists** (a missing one is a
warning, so the package builds while other workstreams are still landing theirs) → copy
`public/**` and `rulesets/**` → generate `manifest.json` (base manifest + root
`package.json` version + `declarative_net_request.rule_resources` from
`rulesets/manifest.json`) → write `build-info.json` (git sha, ruleset version, entries).

Entry points: `src/background/index.ts` → `background.js` (ESM service worker),
`src/content/{cosmetic,picker}.ts` → `content/*.js` (IIFE),
`src/ui/{popup,dashboard,logger}/index.tsx` → `*.js` (IIFE, Preact, `jsx: automatic`).
Target `chrome128`. Content-script entries that were skipped are dropped from the
generated `manifest.json` so Chrome can always load `dist/`.

Load `dist/` through `chrome://extensions` → "Load unpacked". For real blocking run
`pnpm rulesets:build` first — without it the build ships zero static rulesets.

## Service worker (`src/background`)

`index.ts` registers every listener synchronously at the top level (MV3 loses events
otherwise) and does no top-level `await`; state is hydrated lazily inside handlers.

| Module                    | Responsibility                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage/store.ts`        | typed `get`/`set`/`onChange` over `LocalStorageSchema`, one `storage.local.get(null)` hydration per worker start, session-tab helpers. The only module that touches `chrome.storage` |
| `storage/migrations.ts`   | `schemaVersion` migrations, run from `onInstalled`                                                                                                                                   |
| `settings.ts`             | validated settings patches (clamped update interval, https-only delta URL)                                                                                                           |
| `siteModes.ts`            | hostname-walk resolution, `off` → session `allowAllRequests` rules in `ID_RANGE.SITE`                                                                                                |
| `rulesets/manager.ts`     | reads `rulesets/manifest.json`, list toggles, first-run defaults (regional lists by UI language), `updateEnabledRulesets`, budget, delta `updateStaticRules`                         |
| `rulesets/dynamic.ts`     | ID allocation and whole-range rewrites for the user and delta ranges, unsafe-rule budget                                                                                             |
| `cosmetic/index.ts`       | lazily loads enabled lists' cosmetic DBs + user + delta, per-hostname lookup, merged generic tables                                                                                  |
| `scriptlets/index.ts`     | same for scriptlet DBs; `lookupDynamic()` = user + delta calls not covered by a pre-registered group                                                                                 |
| `scriptlets/registrar.ts` | `scripting.registerContentScripts` for the shipped MAIN-world bundles, reconciled against `getRegisteredContentScripts()`                                                            |
| `injector.ts`             | `webNavigation.onCommitted`: `insertCSS({origin:'USER'})` in ≤ 1,000-selector chunks + `executeScript({world:'MAIN'})` for dynamic scriptlets                                        |
| `messaging/router.ts`     | the single typed router for every `Request` in `@iublocker/shared`                                                                                                                   |
| `stats.ts`                | badge + daily counters from `getMatchedRules`, throttled to 1 s per tab                                                                                                              |
| `updater.ts`              | `iub-update` alarm, delta fetch with ETag, atomic apply with rollback                                                                                                                |
| `user.ts`                 | user filters → `compileUserFilters` → dynamic user range + storage                                                                                                                   |
| `picker.ts`               | injects `content/picker.js` on demand                                                                                                                                                |
| `lifecycle.ts`            | `onInstalled` / `onStartup` reconciliation, stale-delta discard                                                                                                                      |

No remote code anywhere: scriptlet bodies are bundled functions passed to
`executeScript({func})`; lists and deltas are data only.

## Tests

```bash
pnpm vitest run --project extension            # all
pnpm vitest run --project extension background # worker only
```

`test/chrome-mock.ts` is a dependency-free `chrome.*` fake (rules, scripting,
storage with change events, alarms, tabs, badges) installed by `test/setup.ts`;
`test/background-utils.ts` adds cache resets, a `fetch` stub for bundle files and
ruleset/DB factories. The compiler and scriptlet packages are mocked with `vi.mock`
where a test needs deterministic lookups.
