# iuBlocker Architecture

This document is the source of truth for how iuBlocker is structured. Every other
doc in `docs/` elaborates on a section here. If code and this document disagree, fix
one of them and say which in the PR.

## 1. Goals and non‑goals

**Goals**

1. Block ads, trackers, and annoyances on current Chrome (Manifest V3, Chrome ≥ 128)
   at least as effectively as uBlock Origin Lite, and as close to uBlock Origin (MV2)
   as the platform allows.
2. Stay compatible with the existing filter‑list ecosystem (EasyList / AdGuard / uBO
   syntax). Users and list maintainers should not need to learn a new format.
3. Update filter lists without shipping a new extension version.
4. Be fast: no per‑request JavaScript on the hot path, no layout thrash from cosmetic
   filtering, no blocking work in the service worker start‑up path.
5. Be trustworthy: no telemetry, no remote code, minimal permissions surface, fully
   reproducible builds.

**Non‑goals**

- Reimplementing uBO's dynamic filtering matrix ("my rules" per request‑type grid).
  Per‑site _modes_ cover the practical cases.
- Firefox / Safari support in v1 (the compiler output is browser‑neutral; a WebExtension
  port is a later milestone).
- HTML filtering (`##^`) and `$replace`: MV3 has no response‑body access.

## 2. The MV3 constraint set (read this first)

MV3 dictates the architecture. The relevant facts, with the Chrome version they landed in:

| Constraint                                          | Value                                                                    | Consequence                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| No blocking `webRequest`                            | —                                                                        | All network blocking is declarative (`declarativeNetRequest`, "DNR").                                 |
| Static rulesets                                     | ≤ 100 declared, ≤ 50 enabled (Chrome 120)                                | Each filter list = one ruleset; users toggle lists by enabling rulesets.                              |
| Global static rule budget                           | 330,000 rules across enabled rulesets (Chrome 121), 30,000 guaranteed    | Compiler must dedupe and merge aggressively and report budget usage.                                  |
| Static rule IDs                                     | unique per ruleset; `getMatchedRules` returns `(rulesetId, ruleId)`      | Each list numbers its rules from 1 (`docs/FILTER-SYNTAX.md` §6).                                      |
| Regex rules                                         | ≤ 1,000 per ruleset, RE2 syntax, ≤ 2 KB compiled memory                  | Regex filters are a scarce resource; the compiler ranks and drops.                                    |
| Dynamic rules                                       | ≤ 30,000 (Chrome 121); ≤ 5,000 may be "unsafe" (redirect/modifyHeaders…) | Used for user filters, per‑site overrides and differential list updates.                              |
| Session rules                                       | ≤ 5,000                                                                  | Used for transient state (site temporarily disabled, picker preview).                                 |
| `updateStaticRules`                                 | disable ≤ 5,000 rule IDs per ruleset (Chrome 111)                        | Differential updates can retract shipped rules that broke a site.                                     |
| `responseHeaders` condition                         | Chrome 128                                                               | `$header=` filters; block by `Content-Type`.                                                          |
| Content scripts in `MAIN` world at `document_start` | `scripting.registerContentScripts` (Chrome 111)                          | Scriptlets run before page scripts, but must be pre‑registered per host pattern.                      |
| Service worker lifetime                             | ~30 s idle, killed under memory pressure                                 | All state must be in `chrome.storage`; every event handler must be re‑entrant.                        |
| No remote code (CWS policy)                         | —                                                                        | Scriptlet _code_ is bundled; list updates are pure data (rules, selectors, scriptlet _names + args_). |
| `insertCSS` from the worker                         | `origin: 'USER'`                                                         | Element hiding CSS beats page `!important` rules and needs no content script.                         |

## 3. Components

```
┌──────────────────────────── build time (Node) ────────────────────────────┐
│ tools/fetch-lists  →  .cache/lists/*.txt                                  │
│ packages/compiler  →  dist/rulesets/dnr/<list>.json      (static rulesets)│
│                       dist/rulesets/cosmetic/<list>.json (cosmetic DB)    │
│                       dist/rulesets/scriptlets/<list>.json                │
│                       dist/rulesets/scriptlet-lib/<name>.js  (fn bodies)  │
│                       dist/rulesets/scriptlet-groups/<hash>.js (calls)    │
│                       dist/rulesets/manifest.json         (RulesetManifest)│
│ packages/scriptlets → dist/scriptlets/registry.js  (bundled MAIN‑world code)│
└───────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────── run time (Chrome) ────────────────────────────┐
│ Service worker (background)                                               │
│   ├─ RulesetManager   enable/disable static rulesets, budget accounting    │
│   ├─ DynamicRules     user filters, per‑site allow, delta updates          │
│   ├─ CosmeticIndex    loads cosmetic DBs lazily, answers per‑hostname       │
│   ├─ ScriptletRegistrar  registerContentScripts(MAIN) per hostname group   │
│   ├─ SiteModes        off / basic / optimal / complete per hostname        │
│   ├─ Injector         webNavigation.onCommitted → insertCSS + executeScript│
│   ├─ Updater          fetches delta.json, applies dynamic/static changes    │
│   ├─ Stats            per‑tab counters via getMatchedRules + badge         │
│   └─ Messaging        single typed router (docs/MESSAGING.md)              │
│                                                                           │
│ Content scripts (ISOLATED world, document_start, all frames)              │
│   ├─ cosmetic/      generic hiding (DOM harvest), procedural filters,     │
│   │                 MutationObserver, collapse of blocked elements         │
│   └─ picker/        element picker UI (on demand, via executeScript)      │
│                                                                           │
│ Content scripts (MAIN world, document_start)                              │
│   └─ scriptlets/    pre‑registered per hostname group; user scriptlets     │
│                     via executeScript({world:'MAIN', injectImmediately})   │
│                                                                           │
│ UI (extension pages)                                                      │
│   ├─ popup/         per‑site mode, counters, quick toggles, picker button  │
│   └─ dashboard/     lists, custom filters, whitelist, settings, logger     │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Packages

| Package                 | Runs in                                                | Depends on                                   |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------- |
| `@iublocker/shared`     | everywhere                                             | nothing                                      |
| `@iublocker/compiler`   | Node (build) **and** the service worker (user filters) | shared                                       |
| `@iublocker/scriptlets` | MAIN world                                             | nothing (self‑contained functions)           |
| `@iublocker/extension`  | Chrome                                                 | shared, compiler (browser build), scriptlets |

The compiler must therefore be isomorphic: no Node built‑ins in `src/` except in the
`cli/` sub‑directory.

## 4. Request lifecycle

1. **Navigation starts.** DNR evaluates static + dynamic + session rules in the network
   process. No extension code runs. Rule precedence (Chrome): higher `priority` wins;
   at equal priority `allow` > `allowAllRequests` > `block` > `upgradeScheme` > `redirect`;
   `modifyHeaders` rules apply if their priority exceeds any matching `allow`.
   Priority tiers are fixed in `docs/FILTER-SYNTAX.md` §4.
2. **`webNavigation.onCommitted`** (main frame and sub‑frames). The worker:
   - resolves the site mode for the top‑level hostname (`SiteModes.resolve`);
   - if mode ≥ `optimal`, looks up specific cosmetic selectors for the frame hostname
     and calls `scripting.insertCSS({origin:'USER', css})` immediately;
   - if mode ≥ `optimal`, looks up user‑defined scriptlets (not pre‑registered) and
     calls `scripting.executeScript({world:'MAIN', injectImmediately:true})`.
3. **Pre‑registered content scripts** run at `document_start`:
   - MAIN‑world scriptlet bundles (only on hosts that have scriptlets);
   - the ISOLATED‑world cosmetic engine (all hosts, all frames).
4. **Cosmetic engine** sends `cosmetic:get` (hostname, mode) → receives specific +
   procedural selectors and, in `complete` mode, generic‑hiding lookup tables. It
   harvests DOM ids/classes, applies matching generic selectors, evaluates procedural
   filters, and keeps watching via a throttled `MutationObserver`.
5. **Stats.** `declarativeNetRequest.getMatchedRules({tabId})` (requires the
   `declarativeNetRequestFeedback` permission) updates the badge lazily, on popup open
   and on `tabs.onUpdated` (`status === 'complete'`), never per request.

## 5. Site modes

| Mode                | Network (DNR)                                | Specific cosmetic + scriptlets | Generic + procedural cosmetic |
| ------------------- | -------------------------------------------- | ------------------------------ | ----------------------------- |
| `off`               | session `allowAllRequests` rule for the site | ✗                              | ✗                             |
| `basic`             | ✓                                            | ✗                              | ✗                             |
| `optimal` (default) | ✓                                            | ✓                              | ✗                             |
| `complete`          | ✓                                            | ✓                              | ✓                             |

Resolution order: exact hostname → parent domains → global default. Stored in
`settings.siteModes` (`docs/STORAGE.md`). `off` is implemented as a session rule
`{action:{type:'allowAllRequests'}, condition:{requestDomains:[host], resourceTypes:['main_frame','sub_frame']}, priority: 1_000_000}`
plus the cosmetic engine bailing out early.

## 6. Filter lists → rulesets

Compile‑time pipeline, one list = one static ruleset (`docs/RULESETS.md`):

```
list.txt ─parse─▶ Filter[] ─classify─▶ network / cosmetic / scriptlet / unsupported
network   ─convert─▶ DNRRule[] ─dedupe/merge/rank─▶ dnr/<id>.json (+ budget report)
cosmetic  ─index──▶ cosmetic/<id>.json  (generic tables + per‑domain specific/procedural/exceptions)
scriptlet ─index──▶ scriptlets/<id>.json (per‑domain [name, args]) + scriptlet-lib/ + host groups
```

Runtime pipeline for user filters (same parser, in the worker): network → dynamic
rules (IDs allocated from the user range, `docs/RULESETS.md` §5); cosmetic and scriptlet
→ merged into the in‑memory index and persisted as `userCosmetic` in storage.

## 7. Differential updates

Static rulesets can only change with an extension release. To update lists between
releases, CI publishes `delta.json` for every shipped ruleset version:

```
delta.json = {
  base: "<rulesetVersion the extension shipped with>",
  version: "<yyyy.mm.dd.n>",
  dnr: { add: DNRRule[], disable: { "<rulesetId>": number[] } },
  cosmetic: { add: CosmeticDBPatch, remove: ... },
  scriptlets: { add: ..., remove: ... }
}
```

The `Updater` applies `dnr.add` through `updateDynamicRules` (IDs in the delta range),
`dnr.disable` through `updateStaticRules`, and merges cosmetic/scriptlet patches into
storage. When a new extension version ships with a newer base, the applied delta is
discarded. Budget: delta adds are capped at 20,000 dynamic rules so 10,000 remain for
user filters. See `docs/RULESETS.md` §6.

## 8. Permissions

```json
"permissions": ["declarativeNetRequest", "declarativeNetRequestFeedback", "scripting",
                "storage", "unlimitedStorage", "tabs", "webNavigation", "alarms"],
"host_permissions": ["<all_urls>"]
```

`<all_urls>` is required for `insertCSS`/`executeScript` on every site and for
`getMatchedRules`. `declarativeNetRequestWithHostAccess` is intentionally not used:
we want blocking to work regardless of site access grants. No `webRequest`
(observation only, not needed).

## 9. Performance rules

- The worker never does synchronous work > 5 ms in `onCommitted`; cosmetic DBs are
  loaded once and cached in module scope (re‑hydrated from storage on cold start).
- Content scripts inject at most one `<style>` per batch and coalesce mutations with
  `requestIdleCallback` (fallback: 250 ms timer). Procedural filters are re‑evaluated
  only for added/changed subtrees.
- Generic hiding never injects all generic selectors; it injects those whose id/class
  token appears in the document (uBO's approach) plus a small "always" set.
- All hostnames are matched through a precomputed suffix walk (`a.b.c` → `a.b.c`,
  `b.c`, `c`), no regexes at runtime.

## 10. Security and privacy

- No `fetch` to anything but the configured list/delta origins (GitHub raw / release
  assets), and only from the `Updater`.
- Scriptlets are compiled functions with argument validation; user‑supplied scriptlet
  arguments are strings only, never evaluated.
- Content scripts never trust page DOM for anything that reaches the worker except
  the picker's generated selector, which is validated by the parser before use.
- CSP for extension pages: `script-src 'self'; object-src 'self'`.
- Reproducible build: `pnpm build` is deterministic given the same `.cache/lists`
  snapshot; the release workflow records list checksums in `rulesets/manifest.json`.

## 11. Decision log

| #   | Decision                                                      | Why                                                                                   |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| D1  | One list = one static ruleset                                 | Users can toggle lists; keeps under 50 enabled.                                       |
| D2  | Insert specific cosmetic CSS from the worker at `onCommitted` | Avoids the content‑script→worker round trip that causes flashes of unblocked content. |
| D3  | Generic hiding only in `complete` mode                        | Same trade‑off as uBOL: generic rules are the main breakage source.                   |
| D4  | Pre‑register scriptlet bundles with `registerContentScripts`  | Only way to guarantee MAIN‑world execution before page scripts.                       |
| D5  | Differential updates via dynamic rules + `updateStaticRules`  | Only MV3‑compatible way to update lists without a release.                            |
| D6  | Vanilla TS + Preact for UI, esbuild for bundling              | Small, fast, no framework churn.                                                      |
| D7  | GPL‑3.0‑or‑later                                              | Compatible with filter‑list ecosystem norms and uBO‑derived ideas.                    |
