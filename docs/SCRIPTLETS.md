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

Two paths, both running `(fn)(...args)` inside a `try/catch` in the page's MAIN world:

1. **Pre‑registered (list scriptlets).** At install/update/ruleset‑toggle time the
   `ScriptletRegistrar` registers **one content script per scriptlet _name_** (plus a chunk
   index):
   `scripting.registerContentScripts([{ id: 'sl-<name>-<chunk>', js: [lib, groupFile],
matches: ['*://*.host/*', …], world: 'MAIN', runAt: 'document_start', allFrames: true,
persistAcrossSessions: true }])` for every group whose list is enabled. Hosts in
   `off`/`basic` mode are excluded via `excludeMatches`. Chrome caps the total size of
   registered scripts; the build fails if the sum exceeds 8 MB.

   **One registration per name, not per call list.** `registerContentScripts` gets slower
   the more scripts are already registered: the previous "one group per distinct set of
   calls" layout produced 3,007 registrations for the 19 shipped lists and Chrome was still
   installing them after two minutes (800 done after 5 s, 1,620 after 45 s). Grouping by
   name instead produces **74 groups / 95 registrations** — a few seconds, once. This is the
   uBO‑Lite layout: the hostname → arguments table moves into the file, and the suffix walk
   that used to be expressed as thousands of match patterns happens in three lines of JS.

   **Two files, not one.** Scriptlet function bodies are several kB each, so they stay in
   their own file and the group file carries only data:

   ```
   scriptlet-lib/<name>.js       self.__iub_lib = self.__iub_lib || {};
                                 self.__iub_lib["<name>"] = <fn>;
   scriptlet-groups/<name>.js    A = [[args…], …]           distinct argument vectors
                                 H = {"host": 0|[0,1], …}   what each hostname adds
                                 X = {"host": 1, …}         #@#+js(…) exceptions
                                 idx = [...]                generic (##+js) arguments
   ```

   Chrome runs a script's `js` files in order, so listing the lib first guarantees the
   function is defined before the group file looks it up. The 19 shipped lists cost ~214 kB
   of libs plus ~1.0 MB of group files (was ~3.1 MB).
   `BUILD_BUDGET.SCRIPTLET_GROUP_BYTES` counts each file **once**, not once per
   registration that names it.

   **The runtime walk.** The group file resolves `self.__iub_lib["<name>"]`, then walks
   `location.hostname`'s suffixes (`a.b.c` → `a.b.c`, `b.c`, `c`). If any level appears in
   `X` the scriptlet does not run at all; otherwise every matching level's argument indices
   are collected (plus the generic ones) and run once each, deduped through the
   `window.__iub_sl` guard below. Subdomains therefore inherit their parent domain's calls
   without a row of their own, and a host that adds nothing to its parent costs neither a
   table row nor a match pattern.

   **Match patterns.** One per host: `*://*.example.com/*` matches `example.com` itself as
   well as its subdomains, so the extra `*://example.com/*` would only double the number of
   patterns Chrome has to index (measured: ~17 s of registration with both, ~5 s with one).
   IP literals and single‑label hosts keep the plain `*://host/*` form — `*://*.127.0.0.1/*`
   is not a valid match pattern and would make Chrome reject the whole registration.

   **Which hosts are registered.** `hosts` is the union across lists, and `hostLists[i]` is
   a bit set over `listIds` saying which lists put host `i` there, so a host that only a
   **disabled** list asks for is left out of the match patterns. Two enabled lists that name
   the same host still share the file, so a host both lists name runs both lists' arguments.

   Function sources are always produced with `serializeScriptletFn` from
   `@iublocker/scriptlets`, never a raw `Function.prototype.toString()`: it splices in the
   `__name` shim a transpiler may have left behind and refuses a body that depends on any
   other transpiler helper.

   **Only concrete hostnames are grouped.** `registerContentScripts` needs literal match
   patterns, so a scriptlet that matches a page only through an entity key (`example.*`)
   cannot be pre‑registered. Those calls are served by path 2 below —
   `ScriptletIndex.lookupDynamic` returns them alongside the user/delta scriptlets, using
   the `entity` half of `lookupScriptletsDetailed`.

2. **Dynamic (user scriptlets, delta‑added scriptlets, entity matches).**
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

- `computeScriptletGroups(dbs, resolve?)` returns one `ScriptletGroupBuild` per scriptlet
  **name**, sorted by name so the build is reproducible. For every concrete `byHost` key
  (entity keys are skipped) it takes the `concrete` half of `lookupScriptletsDetailed` —
  i.e. the effective call list after exceptions, with parent‑domain and generic calls
  already folded in — and files each call under its canonical name. Names with no bundled
  body are dropped: there would be no lib to call.
- Hosts are visited **parents first**, so each row records only what its host _adds_ to what
  its parents and the generic row already contribute. A host whose delta is empty is dropped
  entirely unless it is the only reason an otherwise‑unrepresented list reaches that page
  (`hostLists`, see below), because its parent's `*://*.parent/*` pattern already covers it.
- The build fields are `argsList` (distinct argument vectors), `hostArgs` (host → indices),
  `genericArgs` (indices that run everywhere) and `exclude` (hostnames an `#@#+js(…)`
  cancels, restricted to the ones this group's patterns can actually reach). The shipped
  half — `name`, `hash`, `file`, `libs`, `hosts`, `listIds`, `hostLists` — is what
  `manifest.json` carries.
- `hosts` is `["*"]` when the scriptlet has a generic call: one all‑URLs registration then
  answers for every host, and the concrete rows stay in the table.
- `libsFor(calls, resolve?)` lists the `scriptlet-lib/<name>.js` files a call list needs, in
  first‑use order, canonicalising aliases (so `set` and `set-constant` share one lib) and
  skipping names that do not resolve. `collectScriptletLibs(groups)` is the deduped union
  the CLI writes. `emitScriptletLib(name, resolve?)` returns the lib source or `null`.
- `hash` is the first 12 hex digits of a 64‑bit FNV‑1a digest of the emitted tables (pure
  TS, no `node:crypto`, so the compiler stays isomorphic); `file` is
  `scriptlet-groups/<name>.js`.
- `emitScriptletGroupBundle(group)` emits the IIFE described above: the tables through
  `JSON.stringify` (so list data can never break out of a literal, with `U+2028`, `U+2029`
  and `</` escaped), the suffix walk, and one `try/catch` per call. It contains no function
  bodies at all, and does nothing when the lib is missing.
- **Double‑execution guard.** `window.__iub_sl` maps `"<name>#<argsJSON>"` → `1`; a call
  whose key is already present is skipped. This is what makes a parent row and a child row
  that name the same arguments (and a re‑injection after a soft navigation) safe.
- `serializeScriptletFn` splices a local inert `__name` shim into the body when a
  transpiler rewrote nested function expressions to `__name(fn, "fn")` (esbuild
  `--keep-names`), since that helper is not part of `fn.toString()`. The scriptlets build
  should still avoid `keepNames`.
- **Generic scriptlets.** `##+js(…)` with no domain list is stored under the `"*"` host key
  and becomes the group's `genericArgs` (the registrar maps `hosts: ["*"]` to
  `http://*/*` + `https://*/*`). `#@#+js(name)` with no domain list is a global exception,
  also stored under `"*"`, and is applied when the DBs are compiled; `#@#+js()` stores the
  name `"*"`, meaning "disable every scriptlet on this hostname", which lands in every
  group's `exclude`.

## 4. Argument validation

Arguments are strings. The compiler rejects calls whose argument count is outside the
declared schema, and `trusted-*` scriptlets from untrusted lists. In the browser, user
filters go through the same validation before being stored.

Argument syntax follows uBO: comma separated with surrounding whitespace trimmed, `\,` for
a literal comma, single/double quoted arguments (quotes stripped, `\'`/`\"`/`\\`
unescaped), and an argument starting with `/` that closes with `/` plus optional flags is
kept verbatim as a regex literal (commas inside it do not split). A quote that does _not_
delimit the whole argument is ordinary text, exactly as in uBO — `+js(nostif, '0x)` and
`+js(rpnt, script, "enabled":true, "enabled":false)` keep their quotes instead of being
rejected. A `/…/` argument is additionally checked for catastrophic backtracking
(`src/regex-safety.ts`, docs/COSMETIC-FILTERING.md §1): it becomes a `RegExp` in the page
with nothing to interrupt it, so `+js(set-constant, /(a+)+/, 1)` is dropped with that
reason. Names are resolved through
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
