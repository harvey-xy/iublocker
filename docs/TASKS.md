# Work Breakdown

The project is implemented by parallel workstreams, each owning a disjoint directory.
Interfaces between streams are frozen in `packages/shared` and the docs; a stream that
needs an interface change edits `packages/shared` **first**, documents it, and tells the
others (in this repo: via the PR description).

Legend: 🔴 blocking for M1, 🟠 M2, 🟢 M3/M4.

**Status (2026‑09‑11):** T1–T7 delivered and integrated; unit suite 1,127 tests, e2e 25/25
on Chromium 141. T8 follow‑ups in progress: per‑ruleset rule IDs, entity keys without
compile‑time expansion, shared scriptlet library files, list mirrors.

## T1 — Compiler: network filters → DNR (`packages/compiler/src/{parser,network,dnr,cli}`) 🔴

- Line classifier + network filter parser (all options in `docs/FILTER-SYNTAX.md` §2).
- Hosts‑file format parser.
- DNR converter with priority tiers, resource‑type mapping, redirect resource table,
  removeparam/csp/removeheader/header/permissions mappings.
- Dedupe + domain/initiator merge, regex ranking (limit 1,000), `$badfilter`.
- RE2 validation (`re2js` or a conservative syntax checker), PSL‑based entity expansion.
- CLI `iub-compile --lists tools/filterlists.json --cache .cache/lists --out <dir>` writing
  `dnr/*.json`, `manifest.json`, `report.json` (cosmetic/scriptlet DBs from T2 when present,
  else empty DBs).
- Isomorphic: `compileUserFilters(text): { dnr, cosmetic, scriptlets, warnings }` for the worker.
- Tests per `docs/TESTING.md`.

## T2 — Compiler: cosmetic + scriptlet filters (`packages/compiler/src/{cosmetic,scriptlet}`) 🟠

- Cosmetic parser: `##`, `#@#`, `#?#`, `:style()`, `:remove()`, procedural operator chain
  parser, selector validation, entity expansion, generic key extraction (`byId`/`byClass`).
- `CosmeticDB` builder + merge (`mergeCosmeticDB(a, b)`), hostname lookup helper
  (`lookupCosmetic(db, hostname)`), `$elemhide/$generichide/$specifichide` exceptions.
- Scriptlet filter parser (`##+js`, `#@#+js`, quoted/escaped args, `/regex/` args),
  `ScriptletDB` builder, name validation against `@iublocker/scriptlets` registry,
  trusted‑list gating, host‑group computation + bundle emission for pre‑registration.
- Tests.

## T3 — Scriptlet library (`packages/scriptlets`) 🟠

- `defineScriptlet` helper, registry build (`dist/registry.js` + `registry.json`), the v1
  scriptlet set in `docs/SCRIPTLETS.md` §1.1, argument parsing helpers (regex args,
  `!` negation), native‑patch helpers preserving `toString`.
- Redirect resource files under `packages/extension/public/resources/` with surrogates
  (gpt, ga, gtm, adsbygoogle, …) and the name→file table exported from the package.
- jsdom tests per scriptlet.

## T4 — Extension: service worker (`packages/extension/src/background`) 🔴

- Storage layer + migrations, settings defaults, first‑run (regional lists by language).
- `RulesetManager` (enable/disable, budget check via `getAvailableStaticRuleCount`),
  `DynamicRules` (ID allocation, user/delta ranges), `SiteModes`, session allow rules.
- `Injector` on `webNavigation.onCommitted`: specific cosmetic `insertCSS`, dynamic
  scriptlets `executeScript`, mode gating; `CosmeticIndex` lazy‑loading list DBs +
  user + delta DBs with hostname lookup.
- `ScriptletRegistrar` using `scripting.registerContentScripts` for groups.
- Message router implementing every `Request` in `docs/MESSAGING.md`.
- Stats/badge via `getMatchedRules` (throttled), `Updater` with alarms and delta apply.
- User filters: `compileUserFilters` → dynamic rules + storage.
- Unit tests with the chrome mock.

## T5 — Extension: content scripts (`packages/extension/src/content`) 🟠

- Cosmetic engine per `docs/COSMETIC-FILTERING.md` §3: message round trip, generic
  harvest + lookup, `<style>` management, procedural executor (all operators), mutation
  batching, blocked‑element collapse, frame support.
- Element picker (`picker.ts`): overlay UI in a closed shadow root, hover highlight,
  selector generation + broaden/narrow, preview, create → `filters:addUser`.
- jsdom tests for the procedural executor and selector generator.

## T6 — Extension: UI (`packages/extension/src/ui`, `public/*.html`) 🟢

- Popup: site name, mode selector (4 modes), blocked count, "disable on this site"
  toggle, picker button, open dashboard, update status. Keyboard accessible.
- Dashboard: Lists tab (groups, toggles, counts, budget meter), My filters (textarea +
  compile warnings), Sites (mode table), Settings, About (versions, licenses), Logger
  (matched rules for a tab, via `declarativeNetRequestFeedback`).
- i18n: `_locales/en`, `zh_TW`, `zh_CN` with `chrome.i18n`.
- Preact, no global CSS framework; dark mode via `prefers-color-scheme`.

## T7 — Tooling, CI, E2E (`tools/`, `.github/`, `e2e/`) 🔴

- `tools/fetch-lists.ts` (with `!#include`, retries, checksums), `tools/make-delta.ts`,
  `tools/package.ts`, `tools/cws-upload.ts` (skeleton).
- Workflows: `ci.yml`, `rulesets-nightly.yml`, `release.yml`.
- Fixture list snapshot `e2e/fixtures/lists/` (small, deterministic), fixture pages,
  static server, Playwright config using the pre‑installed Chromium, the tests in
  `docs/TESTING.md`.

## T8 — Integration (after T1–T7) 🔴

- Wire everything, run `pnpm build`, `pnpm test`, `pnpm e2e`; fix cross‑package issues;
  produce the first loadable build; update docs where reality diverged.

Dependency graph: T1, T3, T4, T6, T7 start immediately. T2 depends on T3's registry
shape (frozen in `shared`), T5 on `shared` only. T8 last.
