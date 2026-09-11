# Cosmetic Filtering

Cosmetic filters hide page elements. MV3 gives us two tools: `scripting.insertCSS`
(from the service worker, `origin: 'USER'`) and content scripts. This doc specifies the
compiled database format, the runtime engine, and mode behaviour.

## 1. Filter forms

| Form                                            | Meaning                            | Where applied                                                                                              |
| ----------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `##.ad`                                         | generic element hiding (all sites) | content script, `complete` mode only                                                                       |
| `example.com##.ad`                              | specific hiding                    | worker `insertCSS` at `onCommitted`, `optimal`+                                                            |
| `example.com,~sub.example.com##.ad`             | with negations                     | same                                                                                                       |
| `example.*##.ad`                                | entity (any public suffix)         | stored under the entity key `example.*`, matched via PSL at lookup time                                    |
| `example.com#@#.ad`                             | exception for a specific selector  | removes from specific set; for generic, adds to per‑domain exclusion                                       |
| `#@#.ad`                                        | generic exception                  | drops generic selector globally                                                                            |
| `example.com#?#.x:has-text(Sponsored)`          | procedural                         | content script, `complete` mode (or `optimal` when the list marks it `!#trusted`? — no: always `complete`) |
| `example.com##.ad:style(opacity:0.1!important)` | style injection (uBO `:style`)     | worker `insertCSS`, `optimal`+                                                                             |
| `example.com##.ad:remove()`                     | remove element                     | content script, `complete` (procedural path)                                                               |
| `@@                                             |                                    | example.com^$elemhide` / `$generichide`/`$specifichide`                                                    | disable all / generic / specific cosmetic on the site | recorded in DB `exceptions` |

Selectors are validated with a permissive CSS selector parser at compile time. Native
CSS (`:has()`, `:is()`, `:not()`, `:nth-child`) stays native; only uBO procedural
pseudo‑classes force the content‑script path.

Supported procedural operators (uBO names): `:has-text()`, `:matches-css()`,
`:matches-css-before()`, `:matches-css-after()`, `:matches-attr()`, `:matches-path()`,
`:min-text-length()`, `:upward()`, `:xpath()`, `:watch-attr()`, `:others()`, `:remove()`,
`:style()`, `:matches-media()`, `:if()`/`:if-not()` (legacy → `:has`/`:not`),
`:has()` and `:not()` with procedural arguments. Unknown operators drop the filter with a
warning.

The compiler also accepts the AdGuard CSS‑injection separators `#$#`, `#@$#`, `#$?#` and
`#@$?#`; a `#$#selector { declarations }` body compiles to the same `styles` entry as uBO's
`:style()`. AdGuard's `#%#//scriptlet(…)` JavaScript syntax is rejected with a warning.

Legacy and vendor spellings are normalised to their canonical form at compile time, so the
same filter written either way produces the same DB entry (and cancels the same `#@#`
exception): `:if()`→`:has()`, `:if-not()`→`:not()`, `:-abp-has()`→`:has()`,
`:contains()`/`:-abp-contains()`→`:has-text()`, `:matches()`→`:is()`,
`:nth-ancestor()`→`:upward()`.

## 2. Compiled DB format (`CosmeticDB`, defined in `@iublocker/shared`)

One file per list: `rulesets/cosmetic/<listId>.json`.

```ts
interface CosmeticDB {
  version: 1;
  listId: string;
  generic: {
    // Simple selectors indexed by their key token for DOM‑harvest lookup.
    // A "simple" selector is a single compound selector whose first token is an
    // id or class: "#foo", ".bar", ".bar.baz", "div.bar[x]" (key = "bar").
    byId: Record<string, string[]>; // "foo" → ["#foo", "#foo > .x"]
    byClass: Record<string, string[]>; // "bar" → [".bar", ".bar.baz"]
    // Everything else (attribute selectors, tag‑only, complex): injected in one batch
    // when generic hiding is on. Kept small by the compiler (warn if > 2,000).
    complex: string[];
    // Global generic exceptions already applied; per‑domain exceptions below.
  };
  // Keys below are an exact hostname, the generic bucket "*", or an entity key
  // ending in the literal ".*" ("example.*"). See "Hostname keys" below.
  specific: Record<string, string[]>; // key → plain selectors (joined into CSS)
  styles: Record<string, [selector: string, style: string][]>; // :style()
  procedural: Record<string, ProceduralFilter[]>; // key → compiled procedural chains
  exceptions: {
    selectors: Record<string, string[]>; // key → selectors excluded (#@# or ~negation)
    elemhide: string[]; // hostnames with $elemhide
    generichide: string[]; // hostnames with $generichide
    specifichide: string[]; // hostnames with $specifichide
  };
}

interface ProceduralFilter {
  raw: string;
  tasks: ProceduralTask[]; // [["has-text", "Sponsored"], ["upward", 2], ["remove"]]
}
```

**Hostname keys.** A key in `specific`, `styles`, `procedural` and
`exceptions.selectors` is one of three things:

1. an exact hostname (`sub.example.com`),
2. the generic bucket `"*"` (§2.1), or
3. an **entity key** — a base plus the literal `.*` suffix (`example.*`).

Entities are **not** expanded at compile time. `example.*##.ad` is stored once, under the
key `example.*`; a negated entity (`~example.*`) is recorded in `exceptions.selectors`
under the same key. Expanding entities against the public-suffix snapshot (the old
behaviour, capped at 300 hostnames per entity) multiplied every entity filter by a few
hundred: uBlock filters alone compiled to 453,402 specific selectors, of which the
overwhelming majority named hostnames that do not exist.

Negations of concrete hostnames are unchanged: `example.com,~sub.example.com##.ad` stores
the selector under `example.com` and an exception under `sub.example.com`.

**Lookup.** `lookupCosmetic(dbs, hostname)` matches a hostname against two key sets:

- the **suffix walk** — `a.b.example.co.uk` → `a.b.example.co.uk`, `b.example.co.uk`,
  `example.co.uk`, `co.uk`, `uk`;
- the **entity keys** — the public suffix is computed with the compiler's own compact PSL
  (`packages/compiler/src/psl`, the project's only suffix snapshot), and every label prefix
  above it yields a key: `a.b.example.*`, `b.example.*`, `example.*`.

The result is the union over both sets, minus the exceptions recorded under _any_ of them.
A hostname whose public suffix is not in the snapshot (an IP literal, `localhost`, an
unlisted TLD) simply has no entity keys, and a bare public suffix never produces one
(`co.uk` is not `co.*`). The key lists are memoised, so the walk costs one `Map` hit per
`onCommitted`.

Specific selectors are deduped and joined as `sel1,sel2,…{display:none!important}` in
chunks of 1,000 selectors per `insertCSS` call to avoid oversized rules.

### 2.1 Compiler notes

- **The `"*"` hostname key.** `specific`, `styles` and `procedural` are keyed by exact
  hostname, but a generic `:style()` or procedural filter (`##.a:style(…)`, `#?#…`,
  `##…:remove()` with no domain list) has no hostname to key on. Those are stored under
  `"*"`, and `lookupCosmetic` adds the `"*"` bucket to `styles`/`procedural` for every
  hostname. Only plain generic selectors go into `generic.byId`/`byClass`/`complex`.
- **Procedural chains always start with a `css` step.** `#?#:has-text(Ad)` compiles to
  `[['css','*'], ['has-text','Ad']]` so the runtime executor never has to special‑case an
  empty starting set. Plain CSS between/after operators becomes further `css` steps
  (`.a:has-text(x) > .b` → `[['css','.a'],['has-text','x'],['css','> .b']]`).
- **Selector lists.** A top‑level `,` is fine in a plain selector but drops a procedural
  filter with a warning (uBO has the same restriction).
- **`#?#` with a plain selector** degrades to ordinary element hiding rather than creating a
  one‑task procedural filter.
- **Generic key extraction** takes the first id _or_ class token of the first compound
  (id wins), and only when the selector has no top‑level `,`, `+` or `~`: `div.bar[x]` →
  class `bar`, `.b#a` → id `a`, `div > .a` → `complex`.
- **Exception bookkeeping.** An unqualified `#@#sel` is applied at compile time (the generic
  selector is simply not emitted) and leaves nothing in `exceptions.selectors`. A qualified
  `example.com#@#sel` is recorded under that hostname _and_ removes the hostname's own
  `specific`/`styles`/`procedural` entry for `sel`; negations (`~sub.example.com`) are
  recorded the same way. Exceptions match on the normalised selector for plain/`:style()`
  filters and on the raw selector text (`ProceduralFilter.raw`) for procedural ones. All of
  this is order‑independent: exceptions are collected before the DB is built.
- **`generic.complex` cap.** Above 2,000 entries the compiler keeps the first 2,000 (list
  order) and emits a warning.
- **One public-suffix snapshot.** `packages/compiler/src/psl` is the only suffix table in
  the project; `packages/compiler/src/cosmetic/entities.ts` re-exports it. The cosmetic and
  scriptlet compilers use it only through `entityKeysFor()` at lookup time — they never
  expand. `expandEntity()` survives for the network compiler, where DNR needs concrete
  domains (docs/FILTER-SYNTAX.md §2.1).
- **`lookupCosmetic` returns the `elemhide`/`generichide`/`specifichide` flags but does not
  pre‑filter on them** — the worker and content script gate on the flags together with the
  site mode.

## 3. Runtime engine (content script, ISOLATED world, `document_start`, all frames)

```
start
 ├─ ask worker: cosmetic:get {hostname, frameId, topHostname}
 │    worker returns {mode, specific? (already injected → omitted), procedural[], generic?: {byId, byClass, complex} | null, exceptions}
 ├─ if mode < optimal or elemhide → stop
 ├─ procedural: evaluate on DOMContentLoaded, then on mutations (throttled)
 ├─ generic (complete mode only, unless generichide):
 │    harvest ids + classes from the DOM (initially and on mutations, incremental),
 │    look up byId/byClass, inject matching selectors as <style> in ISOLATED world
 │    (a single managed <style id="iub-cosmetic"> element, shared with the
 │    content-script `selectors`/`styles`; append, never rewrite; re-appended if
 │    the page removes it),
 │    inject generic.complex once.
 └─ collapse: for blocked images/iframes (DNR blocks the request; the element remains)
      set `display:none` on <img>/<iframe> whose load errored and whose src matched a
      "collapsible" hint (worker gives the list of blocked URLs via getMatchedRules on demand)
```

Mutation handling: one `MutationObserver({childList, subtree, attributes})` with
`attributeFilter: ['class','id', …:watch-attr() names]` (unfiltered when a filter uses
`:watch-attr()` without arguments), batched through `requestIdleCallback({timeout: 250})`
falling back to `setTimeout(250)`; max one procedural pass per 100 ms. Passes are skipped
while `document.hidden` and run once on `visibilitychange`.

`:others()` yields the minimal set that hides everything except the matched elements and
their ancestors: every sibling along the path from the document element down to each match.

Procedural evaluation contract (`ProceduralTask` executor): each task maps a `Set<Element>`
to a new set. `:has-text` uses `textContent` with regex or literal; `:matches-css` uses
`getComputedStyle`; `:upward(n|selector)`; `:xpath` via `document.evaluate`;
`:remove()` removes the nodes; `:style()` collects CSS text per selector and injects. The
executor is pure DOM code, independently unit‑testable in jsdom.

Style precedence: hiding uses `display:none!important` in a `<style>` element appended
to `documentElement` (before `<head>` exists) and moved into `<head>` later; the
worker's `insertCSS` with `origin: 'USER'` has the highest cascade origin and is used
for specific filters so the page cannot override them.

## 4. Mode behaviour

| Mode     | specific/`:style` (worker) | procedural + `:remove` | generic |
| -------- | -------------------------- | ---------------------- | ------- |
| off      | ✗                          | ✗                      | ✗       |
| basic    | ✗                          | ✗                      | ✗       |
| optimal  | ✓                          | ✗                      | ✗       |
| complete | ✓                          | ✓ (specific + generic) | ✓       |

## 5. User filters and the picker

User cosmetic filters use the same parser at runtime (`compiler` browser build) and
are merged into a `userCosmetic: CosmeticDB` stored in `chrome.storage.local`
(`docs/STORAGE.md`). The picker generates a specific filter (`host##selector`) with a
stable selector: prefer `#id`, then unique class combos, then a positional path capped
at depth 6, and lets the user broaden/narrow with a slider (uBO‑style). Preview uses
a temporary `<style>`; "Create" sends `filters:addUser`.
