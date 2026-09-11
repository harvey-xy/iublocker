# Cosmetic Filtering

Cosmetic filters hide page elements. MV3 gives us two tools: `scripting.insertCSS`
(from the service worker, `origin: 'USER'`) and content scripts. This doc specifies the
compiled database format, the runtime engine, and mode behaviour.

## 1. Filter forms

| Form | Meaning | Where applied |
|---|---|---|
| `##.ad` | generic element hiding (all sites) | content script, `complete` mode only |
| `example.com##.ad` | specific hiding | worker `insertCSS` at `onCommitted`, `optimal`+ |
| `example.com,~sub.example.com##.ad` | with negations | same |
| `example.*##.ad` | entity (any public suffix) | expanded via PSL at compile time |
| `example.com#@#.ad` | exception for a specific selector | removes from specific set; for generic, adds to per‑domain exclusion |
| `#@#.ad` | generic exception | drops generic selector globally |
| `example.com#?#.x:has-text(Sponsored)` | procedural | content script, `complete` mode (or `optimal` when the list marks it `!#trusted`? — no: always `complete`) |
| `example.com##.ad:style(opacity:0.1!important)` | style injection (uBO `:style`) | worker `insertCSS`, `optimal`+ |
| `example.com##.ad:remove()` | remove element | content script, `optimal`+ |
| `@@||example.com^$elemhide` / `$generichide` / `$specifichide` | disable all / generic / specific cosmetic on the site | recorded in DB `exceptions` |

Selectors are validated with a permissive CSS selector parser at compile time. Native
CSS (`:has()`, `:is()`, `:not()`, `:nth-child`) stays native; only uBO procedural
pseudo‑classes force the content‑script path.

Supported procedural operators (uBO names): `:has-text()`, `:matches-css()`,
`:matches-css-before()`, `:matches-css-after()`, `:matches-attr()`, `:matches-path()`,
`:min-text-length()`, `:upward()`, `:xpath()`, `:watch-attr()`, `:others()`, `:remove()`,
`:style()`, `:matches-media()`, `:if()`/`:if-not()` (legacy → `:has`/`:not`),
`:has()` and `:not()` with procedural arguments. Unknown operators drop the filter with a
warning.

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
    byId:    Record<string, string[]>;   // "foo" → ["#foo", "#foo > .x"]
    byClass: Record<string, string[]>;   // "bar" → [".bar", ".bar.baz"]
    // Everything else (attribute selectors, tag‑only, complex): injected in one batch
    // when generic hiding is on. Kept small by the compiler (warn if > 2,000).
    complex: string[];
    // Global generic exceptions already applied; per‑domain exceptions below.
  };
  specific: Record<string, string[]>;     // hostname → plain selectors (joined into CSS)
  styles:   Record<string, [selector: string, style: string][]>; // :style()
  procedural: Record<string, ProceduralFilter[]>; // hostname → compiled procedural chains
  exceptions: {
    selectors: Record<string, string[]>;  // hostname → selectors excluded (#@#)
    elemhide: string[];                   // hostnames with $elemhide
    generichide: string[];                // hostnames with $generichide
    specifichide: string[];               // hostnames with $specifichide
  };
}

interface ProceduralFilter {
  raw: string;
  tasks: ProceduralTask[];   // [["has-text", "Sponsored"], ["upward", 2], ["remove"]]
}
```

Hostname keys: exact hostnames only, with negations compiled into `exceptions.selectors`
under the negated hostname (`~sub.example.com##.ad` on `example.com` → specific under
`example.com`, exception under `sub.example.com`). Entities are expanded to concrete
suffixes present in the PSL snapshot (`example.com`, `example.co.uk`, …), capped at 300
per entity.

Lookup at runtime for hostname `a.b.example.com`: union of entries for `a.b.example.com`,
`b.example.com`, `example.com` minus exceptions for the same walk. Specific selectors
are deduped and joined as `sel1,sel2,…{display:none!important}` in chunks of 1,000
selectors per `insertCSS` call to avoid oversized rules.

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
 │    (CSSOM via a single <style id="iub-generic"> element; append, never rewrite),
 │    inject generic.complex once.
 └─ collapse: for blocked images/iframes (DNR blocks the request; the element remains)
      set `display:none` on <img>/<iframe> whose load errored and whose src matched a
      "collapsible" hint (worker gives the list of blocked URLs via getMatchedRules on demand)
```

Mutation handling: `MutationObserver({childList, subtree, attributes: ['class','id']})`
with batching through `requestIdleCallback` (≤ 50 ms budget) falling back to
`setTimeout(250)`; max one procedural pass per 100 ms.

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

| Mode | specific/`:style` (worker) | procedural + `:remove` | generic |
|---|---|---|---|
| off | ✗ | ✗ | ✗ |
| basic | ✗ | ✗ | ✗ |
| optimal | ✓ | ✓ (specific only) | ✗ |
| complete | ✓ | ✓ | ✓ |

## 5. User filters and the picker

User cosmetic filters use the same parser at runtime (`compiler` browser build) and
are merged into a `userCosmetic: CosmeticDB` stored in `chrome.storage.local`
(`docs/STORAGE.md`). The picker generates a specific filter (`host##selector`) with a
stable selector: prefer `#id`, then unique class combos, then a positional path capped
at depth 6, and lets the user broaden/narrow with a slider (uBO‑style). Preview uses
a temporary `<style>`; "Create" sends `filters:addUser`.
