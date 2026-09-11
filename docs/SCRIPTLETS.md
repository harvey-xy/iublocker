# Scriptlets

Scriptlets are small JavaScript functions injected into the page's **MAIN** world
before any page script runs, to neutralise anti‑adblock code, fake ad slots, stub
tracking APIs, and so on. Filter syntax: `example.com##+js(name, arg1, arg2, …)`.

MV3 forbids remote code, so **every scriptlet body ships inside the extension**. Filter
lists only carry the scriptlet _name_ and _arguments_ (data).

## 1. Library (`packages/scriptlets`)

Each scriptlet is a self‑contained function in `src/<name>.ts`:

```ts
import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'set-constant',
  aliases: ['set'],
  args: [{ name: 'property' }, { name: 'value' }, { name: 'stack', optional: true }],
  // The function is serialised with `serializeScriptletFn` (never a raw toString) and
  // injected as `(fn)(args)`. It MUST NOT close over module scope: no imports used
  // inside, helpers are inlined or passed through the `$` helper bag.
  fn: function (property: string, value: string) {
    /* … */
  },
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

| Name                                                                                          | Aliases                              | Purpose                                                                              |
| --------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| `abort-on-property-read`                                                                      | `aopr`                               | throw when a property is read                                                        |
| `abort-on-property-write`                                                                     | `aopw`                               | throw when a property is written                                                     |
| `abort-current-script`                                                                        | `acs`, `abort-current-inline-script` | abort the currently executing inline script matching a needle                        |
| `abort-on-stack-trace`                                                                        | `aost`                               | abort when property accessed from a matching stack                                   |
| `set-constant`                                                                                | `set`                                | define a constant global property                                                    |
| `set-local-storage-item`, `set-session-storage-item`                                          |                                      | set storage items                                                                    |
| `set-cookie`, `set-cookie-reload`                                                             |                                      | set cookies                                                                          |
| `remove-cookie`                                                                               | `cookie-remover`                     | remove cookies                                                                       |
| `no-setTimeout-if`                                                                            | `nostif`, `setTimeout-defuser`       | defuse matching setTimeout calls                                                     |
| `no-setInterval-if`                                                                           | `nosiif`                             | defuse matching setInterval calls                                                    |
| `no-fetch-if`                                                                                 | `prevent-fetch`                      | block/mimic fetch calls                                                              |
| `no-xhr-if`                                                                                   | `prevent-xhr`                        | block/mimic XHR calls                                                                |
| `prevent-addEventListener`                                                                    | `aeld`, `addEventListener-defuser`   | defuse listeners                                                                     |
| `prevent-window-open`                                                                         | `nowoif`, `window.open-defuser`      | neuter popups                                                                        |
| `prevent-requestAnimationFrame`                                                               | `norafif`                            | defuse rAF callbacks                                                                 |
| `json-prune`                                                                                  |                                      | remove properties from parsed JSON                                                   |
| `json-prune-fetch-response`, `json-prune-xhr-response`                                        |                                      | prune network JSON                                                                   |
| `remove-attr`                                                                                 | `ra`                                 | remove element attributes (with optional selector, `stay`)                           |
| `remove-class`                                                                                | `rc`                                 | remove classes                                                                       |
| `set-attr`                                                                                    |                                      | set attributes                                                                       |
| `remove-node-text`                                                                            | `rmnt`                               | remove text nodes matching                                                           |
| `replace-node-text`                                                                           | `rpnt`                               | replace text nodes                                                                   |
| `nano-setTimeout-booster`, `nano-setInterval-booster`                                         | `nano-stb`, `nano-sib`               | speed up timers                                                                      |
| `adjust-setTimeout`, `adjust-setInterval`                                                     |                                      | adjust delays                                                                        |
| `disable-newtab-links`                                                                        |                                      |                                                                                      |
| `noeval-if`                                                                                   | `noeval`                             | block matching eval                                                                  |
| `no-window-open-if`                                                                           |                                      | alias of prevent-window-open                                                         |
| `trusted-*` (`trusted-set-cookie`, `trusted-replace-fetch-response`, `trusted-set-constant`…) |                                      | only from lists flagged `trusted: true` in `filterlists.json` or user filters        |
| `googletagservices_gpt.js`, `google-analytics_ga.js`, …                                       |                                      | **surrogates**: implemented as redirect resources (§5), also invocable as scriptlets |

### 1.2 Second set (added to close uBO-list coverage gaps)

Measured against `uBlock filters` + `uBlock annoyances`, most frequent first.

| Name                                                                                                                                                                      | Aliases           | Purpose                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------- |
| `trusted-replace-argument`                                                                                                                                                |                   | swap one argument of a wrapped function (`json:`, `repl:/a/b/`, `condition`) |
| `href-sanitizer`                                                                                                                                                          |                   | rewrite tracking links to the URL they wrap (`?param`, `[attr]`, `-base64`)  |
| `nowebrtc`                                                                                                                                                                |                   | replace `RTCPeerConnection` with an inert stub                               |
| `trusted-prevent-dom-bypass`                                                                                                                                              |                   | seed a freshly inserted frame with this window's patched natives             |
| `trusted-click-element`                                                                                                                                                   |                   | click a sequence of selectors (numeric entries are pauses)                   |
| `trusted-replace-node-text`                                                                                                                                               | `trusted-rpnt`    | `replace-node-text` with an arbitrary replacement                            |
| `trusted-create-html`                                                                                                                                                     |                   | insert an HTML fragment into a matched parent                                |
| `trusted-suppress-native-method`                                                                                                                                          |                   | `prevent`/`abort` a native call whose arguments match a signature            |
| `json-edit`, `trusted-json-edit`                                                                                                                                          |                   | uBO json-edit path expressions over `JSON.parse` / `Response.json`           |
| `json-edit-fetch-response`, `json-edit-xhr-response`, `jsonl-edit-xhr-response`, `json-edit-fetch-request`, `trusted-json-edit-{fetch-response,xhr-response,xhr-request}` |                   | the same path language over network payloads                                 |
| `xml-prune`                                                                                                                                                               |                   | drop nodes/attributes from XML (DASH/VAST) responses, CSS or `xpath(…)`      |
| `prevent-refresh`                                                                                                                                                         | `refresh-defuser` | defuse `<meta http-equiv="refresh">`                                         |
| `trusted-replace-outbound-text`                                                                                                                                           |                   | rewrite the string a wrapped function returns                                |
| `trusted-prevent-xhr`, `trusted-prevent-fetch`                                                                                                                            |                   | trusted `no-xhr-if` / `no-fetch-if` (arbitrary bodies, response props)       |
| `trusted-set-attr`, `trusted-set-session-storage-item`, `trusted-set-cookie-reload`                                                                                       |                   | trusted variants of the corresponding setters                                |
| `m3u-prune`                                                                                                                                                               |                   | drop ad segments from HLS playlists                                          |
| `prevent-innerHTML`                                                                                                                                                       |                   | refuse `innerHTML` assignments matching a pattern                            |
| `trusted-override-element-method`                                                                                                                                         |                   | neutralise a prototype method for elements matching a selector               |
| `trusted-edit-inbound-object`                                                                                                                                             |                   | apply a json-edit path to an argument before the call                        |
| `spoof-css`                                                                                                                                                               |                   | make `getComputedStyle()` report chosen values                               |
| `prevent-canvas`                                                                                                                                                          |                   | refuse `canvas.getContext()` for a context type                              |
| `prevent-clipboard-write`                                                                                                                                                 |                   | refuse clipboard writes matching a pattern ("ClickFix" payloads)             |
| `alert-buster`, `window-close-if`                                                                                                                                         |                   | silence `alert()`; close the frame when the URL matches                      |
| `trusted-set-constant`                                                                                                                                                    | `trusted-set`     | (existing) now also accepts `json:…` and `{"value": …}`                      |

**Argument counts.** uBO scriptlets have grown trailing `name, value` _extra arguments_
(`condition`, `sedCount`, `stay`, `log`, `elements`, `when`, `runAt`, `domain`, `reload`,
`propsToMatch`, …). The schemas here declare those trailing slots as optional arguments and
the implementations parse them as name/value pairs, falling back to the legacy positional
reading when the first extra is not a known key. Extra arguments we do not implement are
accepted and ignored rather than dropping the filter.

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
  // Keys are an exact hostname, the generic bucket "*", or an entity key
  // ending in the literal ".*" ("example.*").
  byHost: Record<string, ScriptletCall[]>; // key → [{name, args}]
  exceptions: Record<string, string[]>; // key → names excluded via #@#+js or ~negation
}
interface ScriptletCall {
  name: string;
  args: string[];
}
```

**Entity keys.** `example.*##+js(…)` is stored once under the key `example.*`, and
`~example.*` under the same key in `exceptions` — entities are **not** expanded into
concrete hostnames at compile time. Expanding them (the old behaviour, up to 300 hostnames
per entity) turned uBlock filters into 1,018,817 scriptlet calls, nearly all of them for
hostnames that do not exist.

`lookupScriptlets(dbs, hostname)` matches both the suffix walk (plus `"*"`) and the entity
keys above the hostname's public suffix, computed with the compiler's PSL
(`packages/compiler/src/psl`): `a.b.example.co.uk` also tries `a.b.example.*`,
`b.example.*` and `example.*`. Exceptions are collected from every one of those keys before
any call is kept.

`lookupScriptletsDetailed(dbs, hostname)` returns the same result split in two:

```ts
{ concrete: ScriptletCall[]; entity: ScriptletCall[] }
```

`concrete` is what matched a real hostname key (or `"*"`) and is therefore
pre-registerable; `entity` is what matched _only_ through an entity key. A call reachable
both ways counts as concrete. §3 explains why the split exists.

## 3. Injection strategy

Two paths, both producing `(function(){ try{ (fn)(...args) }catch{} })()` code:

1. **Pre‑registered (list scriptlets).** At install/update/ruleset‑toggle time the
   `ScriptletRegistrar` groups hostnames by their _set of calls_ and calls
   `scripting.registerContentScripts([{ id: 'sl-<hash>', js: [...libs, file], matches:
['*://*.host/*', …], world: 'MAIN', runAt: 'document_start', allFrames: true,
persistAcrossSessions: true }])` for every group whose list is enabled. Hosts in
   `off`/`basic` mode are excluded via `excludeMatches`. Chrome caps the total size of
   registered scripts; the build fails if the sum exceeds 8 MB.

   **Two files, not one.** Scriptlet function bodies are several kB each and are shared by
   thousands of groups, so they are emitted **once per scriptlet name**:

   ```
   scriptlet-lib/<name>.js       self.__iub_lib = self.__iub_lib || {};
                                 self.__iub_lib["<name>"] = <fn>;
   scriptlet-groups/<hash>.js    run(key, "<name>", [args]) …  (nothing else)
   ```

   Chrome runs a script's `js` files in order, so listing the libs first guarantees the
   functions are defined before the group file looks them up. A group file is a few hundred
   bytes. Emitting each body into every group instead produced 28 MB of bundles for the
   default lists; the same lists now cost ~67 kB of libs plus ~3.5 MB of group files.
   `BUILD_BUDGET.SCRIPTLET_GROUP_BYTES` counts each file **once**, not once per group that
   registers it.

   Function sources are always produced with `serializeScriptletFn` from
   `@iublocker/scriptlets`, never a raw `Function.prototype.toString()`: it splices in the
   `__name` shim a transpiler may have left behind and refuses a body that depends on any
   other transpiler helper.

   **Only concrete hostnames are grouped.** `registerContentScripts` needs literal match
   patterns, so a scriptlet that matches a page only through an entity key (`example.*`)
   cannot be pre‑registered. Those calls are served by path 2 below —
   `ScriptletIndex.lookupDynamic` returns them alongside the user/delta scriptlets, using
   the `entity` half of `lookupScriptletsDetailed`.

   **Group cap.** A single list may pre‑register at most
   `SCRIPTLET_GROUPS_PER_LIST` = 3,000 groups. Above that the compiler demotes the smallest
   groups (fewest hosts, then fewest calls, then hash — deterministic) until the list fits,
   and records their hostnames in `manifest.scriptletDynamicHosts`. The worker injects
   those hosts' calls with `executeScript` instead. The generic `"*"` group is never
   demoted. uBlock filters currently produce ~4,400 distinct call lists, so ~1,400 of the
   rarest ones take the dynamic path.

2. **Dynamic (user scriptlets, delta‑added scriptlets, entity matches, demoted hosts).**
   At `webNavigation.onCommitted`
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

### 3.1 Compiler notes (group computation and bundle emission)

- `computeScriptletGroups(dbs, resolve?)` groups by the **canonical JSON of the effective
  call list** — the `concrete` calls from `lookupScriptletsDetailed` for that hostname,
  sorted by name then argument JSON, so the grouping is order‑independent. Only **concrete**
  hostnames that appear as a `byHost` key are listed (entity keys are skipped); subdomains
  inherit through the `*://*.host/*` match pattern. A hostname that has its own calls
  therefore also carries its parent domains' calls, and both groups match the page — the
  runtime guard below makes the overlap harmless.
- `libsFor(calls, resolve?)` lists the `scriptlet-lib/<name>.js` files a call list needs, in
  first‑use order, canonicalising aliases (so `set` and `set-constant` share one lib) and
  skipping names that do not resolve. `collectScriptletLibs(groups)` is the deduped union
  the CLI writes. `emitScriptletLib(name, resolve?)` returns the lib source or `null`.
- `capScriptletGroups(groups, maxPerList?)` enforces the group cap and returns
  `{ groups, dynamicHosts }`.
- `hash` is the first 12 hex digits of a 64‑bit FNV‑1a digest of that canonical JSON
  (pure TS, no `node:crypto`, so the compiler stays isomorphic); `file` is
  `scriptlet-groups/<hash>.js`. Groups are returned sorted by hash for reproducible builds.
- `emitScriptletGroupBundle(group, resolve?)` emits an IIFE that invokes
  `self.__iub_lib[name]` with `JSON.stringify`‑d arguments, each call in its own
  `try/catch`, and does nothing if the lib is missing. `U+2028`, `U+2029` and `</` are
  escaped. It contains no function bodies at all.
- **Double‑execution guard.** `window.__iub_sl` maps `"<name>#<argsJSON>"` → `1`; a call
  whose key is already present is skipped. This is what makes overlapping group
  registrations (and a re‑injection after a soft navigation) safe.
- `serializeScriptletFn` splices a local inert `__name` shim into the body when a
  transpiler rewrote nested function expressions to `__name(fn, "fn")` (esbuild
  `--keep-names`), since that helper is not part of `fn.toString()`. The scriptlets build
  should still avoid `keepNames`.
- **Generic scriptlets.** `##+js(…)` with no domain list is stored under the `"*"` host key
  and becomes its own group (the registrar maps it to `<all_urls>`). `#@#+js(name)` with no
  domain list is a global exception, also stored under `"*"`; `#@#+js()` stores the name
  `"*"`, meaning "disable every scriptlet on this hostname".

## 4. Argument validation

Arguments are strings. The compiler rejects calls whose argument count is outside the
declared schema, and `trusted-*` scriptlets from untrusted lists. In the browser, user
filters go through the same validation before being stored.

Argument syntax follows uBO: comma separated with surrounding whitespace trimmed, `\,` for
a literal comma, single/double quoted arguments (quotes stripped, `\'`/`\"`/`\\`
unescaped), and an argument starting with `/` that closes with `/` plus optional flags is
kept verbatim as a regex literal (commas inside it do not split). Names are resolved through
the registry after stripping a trailing `.js`, so aliases are stored canonically and an
exception written against an alias cancels the call. Unknown names, too few/too many
arguments, and `trusted-*` from an untrusted list all drop the filter with a reason in
`report.json`; an exception naming an unknown scriptlet is kept but warned about.

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
noop.json / noopjson       → noop.json        ({})
noop-vast2.xml / noopvast-2.0, noop-vast3.xml / noopvast-3.0, noop-vast4.xml / noopvast-4.0
noop-vmap1.0.xml / noopvmap-1.0                (empty VMAP document)
google-ima.js / google-ima3 → functional IMA3 SDK stub (google.ima: AdDisplayContainer,
                              AdsLoader → AdsManagerLoadedEvent → stub AdsManager that
                              fires CONTENT_RESUME_REQUESTED + ALL_ADS_COMPLETED)
fingerprint2.js / fingerprintjs2, fingerprint3.js / fingerprintjs3  (fixed fingerprint)
amazon_apstag.js            (Amazon Publisher Services: no bids)
ati-smarttag.js             (AT Internet SmartTag)
nobab2.js                   (second-generation BlockAdBlock)
```

The compiler maps `$redirect=<name>` to `extensionPath: "/resources/<file>"` and
drops unknown names with a warning. `click2load.html` receives the original URL via
`regexSubstitution` when the filter is a regex, else via `transform` is not possible →
plain `extensionPath` (documented limitation).
