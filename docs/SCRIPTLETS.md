# Scriptlets

Scriptlets are small JavaScript functions injected into the page's **MAIN** world
before any page script runs, to neutralise anti‑adblock code, fake ad slots, stub
tracking APIs, and so on. Filter syntax: `example.com##+js(name, arg1, arg2, …)`.

MV3 forbids remote code, so **every scriptlet body ships inside the extension**. Filter
lists only carry the scriptlet *name* and *arguments* (data).

## 1. Library (`packages/scriptlets`)

Each scriptlet is a self‑contained function in `src/<name>.ts`:

```ts
import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'set-constant',
  aliases: ['set'],
  args: [{ name: 'property' }, { name: 'value' }, { name: 'stack', optional: true }],
  // The function is serialised with Function.prototype.toString and injected as
  // `(fn)(args)`. It MUST NOT close over module scope: no imports used inside,
  // helpers are inlined or passed through the `$` helper bag.
  fn: function (property: string, value: string) { /* … */ },
});
```

Rules for `fn`:
- No references to anything outside the function body except globals of the page.
- No `chrome.*` API usage (MAIN world has none).
- Wrap everything in `try {} catch {}`; never throw into the page.
- Idempotent: running twice on the same page is harmless.
- Use `Object.defineProperty` traps and `Proxy` carefully; preserve `toString` of
  patched natives where the page could fingerprint (see `_helpers/patchNative`).

### 1.1 Initial set (v1, ordered by frequency in the default lists)

| Name | Aliases | Purpose |
|---|---|---|
| `abort-on-property-read` | `aopr` | throw when a property is read |
| `abort-on-property-write` | `aopw` | throw when a property is written |
| `abort-current-script` | `acs`, `abort-current-inline-script` | abort the currently executing inline script matching a needle |
| `abort-on-stack-trace` | `aost` | abort when property accessed from a matching stack |
| `set-constant` | `set` | define a constant global property |
| `set-local-storage-item`, `set-session-storage-item` | | set storage items |
| `set-cookie`, `set-cookie-reload` | | set cookies |
| `remove-cookie` | `cookie-remover` | remove cookies |
| `no-setTimeout-if` | `nostif`, `setTimeout-defuser` | defuse matching setTimeout calls |
| `no-setInterval-if` | `nosiif` | defuse matching setInterval calls |
| `no-fetch-if` | `prevent-fetch` | block/mimic fetch calls |
| `no-xhr-if` | `prevent-xhr` | block/mimic XHR calls |
| `prevent-addEventListener` | `aeld`, `addEventListener-defuser` | defuse listeners |
| `prevent-window-open` | `nowoif`, `window.open-defuser` | neuter popups |
| `prevent-requestAnimationFrame` | `norafif` | defuse rAF callbacks |
| `json-prune` | | remove properties from parsed JSON |
| `json-prune-fetch-response`, `json-prune-xhr-response` | | prune network JSON |
| `remove-attr` | `ra` | remove element attributes (with optional selector, `stay`) |
| `remove-class` | `rc` | remove classes |
| `set-attr` | | set attributes |
| `remove-node-text` | `rmnt` | remove text nodes matching |
| `replace-node-text` | `rpnt` | replace text nodes |
| `nano-setTimeout-booster`, `nano-setInterval-booster` | `nano-stb`, `nano-sib` | speed up timers |
| `adjust-setTimeout`, `adjust-setInterval` | | adjust delays |
| `disable-newtab-links` | | |
| `noeval-if` | `noeval` | block matching eval |
| `no-window-open-if` | | alias of prevent-window-open |
| `trusted-*` (`trusted-set-cookie`, `trusted-replace-fetch-response`, `trusted-set-constant`…) | | only from lists flagged `trusted: true` in `filterlists.json` or user filters |
| `googletagservices_gpt.js`, `google-analytics_ga.js`, … | | **surrogates**: implemented as redirect resources (§5), also invocable as scriptlets |

All parameters follow uBO argument semantics (e.g. `/regex/` arguments, `!` negation
for `no-setTimeout-if`). Reference behaviour: uBO's `assets/resources/scriptlets.js`;
reimplemented in TypeScript, not copied.

## 2. Compiled form

`packages/scriptlets` builds `dist/registry.json` (names, aliases, arg schemas,
trusted flag) and `dist/registry.js`: a module exporting
`export const scriptlets: Record<string, { fn: string; trusted: boolean }>` where
`fn` is the function source. The compiler validates names against the registry.

The list compiler emits per list `rulesets/scriptlets/<listId>.json`:

```ts
interface ScriptletDB {
  version: 1;
  listId: string;
  byHost: Record<string, ScriptletCall[]>;   // hostname → [{name, args}]
  exceptions: Record<string, string[]>;      // hostname → names excluded via #@#+js
}
interface ScriptletCall { name: string; args: string[]; }
```

## 3. Injection strategy

Two paths, both producing `(function(){ try{ (fn)(...args) }catch{} })()` code:

1. **Pre‑registered (list scriptlets).** At install/update/ruleset‑toggle time the
   `ScriptletRegistrar` groups hostnames by their *set of calls*, generates one JS
   file per group under `dist/scriptlets/groups/<hash>.js` **at build time** (the
   set of groups is known at build time from the shipped lists), and calls
   `scripting.registerContentScripts([{ id: 'sl-<hash>', js: [file], matches:
   ['*://*.host/*', …], world: 'MAIN', runAt: 'document_start', allFrames: true,
   persistAcrossSessions: true }])` for every group whose list is enabled. Hosts in
   `off`/`basic` mode are excluded via `excludeMatches`. Chrome caps the total size of
   registered scripts; the build fails if the sum exceeds 8 MB.
2. **Dynamic (user scriptlets, delta‑added scriptlets).** At `webNavigation.onCommitted`
   the worker calls `scripting.executeScript({ target:{tabId, frameIds:[frameId]},
   world: 'MAIN', injectImmediately: true, func: runner, args: [calls] })` where
   `runner` looks up function sources from the bundled registry (imported into the
   worker) and evaluates them with `new Function`? — **No.** `new Function` is remote‑code
   adjacent and blocked by extension CSP. Instead the worker passes `func: registry[name].fn`
   directly (the actual function object, bundled into the worker) and `args`.
   One `executeScript` call per scriptlet call; batched by `Promise.all`.

Race note: path 2 can lose to very early inline scripts; that is why lists ship via
path 1. The delta updater can add new host→call mappings (data) which then use path 2
until the next release folds them into path 1.

## 4. Argument validation

Arguments are strings. The compiler rejects calls whose argument count is outside the
declared schema, and `trusted-*` scriptlets from untrusted lists. In the browser, user
filters go through the same validation before being stored.

## 5. Redirect resources (`$redirect=`)

Neutered replacements served from `packages/extension/public/resources/` and exposed
via `web_accessible_resources` (`matches: ["<all_urls>"]`, `use_dynamic_url: true`).
Initial table (name → file, MIME):

```
noop.js / noopjs            → noop.js            (empty script)
noop.txt / nooptext         → noop.txt
noop.css                    → noop.css
noop-0.1s.mp3 / noopmp3-0.1s→ noop-0.1s.mp3
noop-1s.mp4 / noopmp4-1s    → noop-1s.mp4
1x1.gif / 1x1-transparent.gif → 1x1.gif
2x2.png / 2x2-transparent.png → 2x2.png
3x2.png, 32x32.png
noopframe / noop.html       → noop.html
empty                       → empty            (0 bytes, Content-Type from type option)
google-analytics_ga.js, google-analytics_analytics.js, google-analytics_cx_api.js,
googletagservices_gpt.js, googletagmanager_gtm.js, googlesyndication_adsbygoogle.js,
doubleclick_instream_ad_status.js, amazon_ads.js, outbrain-widget.js,
scorecardresearch_beacon.js, chartbeat.js, hd-main.js, fuckadblock.js-3.2.0,
prebid-ads.js, nobab.js, nofab.js, popads.js, popads-dummy.js, addthis_widget.js,
ampproject_v0.js, monkeybroker.js, ligatus_angular-tag.js, click2load.html (with query param passthrough)
```

The compiler maps `$redirect=<name>` to `extensionPath: "/resources/<file>"` and
drops unknown names with a warning. `click2load.html` receives the original URL via
`regexSubstitution` when the filter is a regex, else via `transform` is not possible →
plain `extensionPath` (documented limitation).
