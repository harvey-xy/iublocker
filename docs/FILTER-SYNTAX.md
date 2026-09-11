# Filter Syntax and DNR Mapping

iuBlocker's compiler (`packages/compiler`) accepts the ABP / uBlock Origin / AdGuard
filter syntax and produces `chrome.declarativeNetRequest` rules. This document is the
contract for what is supported, how each construct maps, and what is dropped (with a
warning) because MV3 cannot express it.

Terminology: "filter" = one line in a list. "rule" = one DNR rule object.

## 1. Line classification

```
! comment            → ignored
[Adblock Plus 2.0]   → ignored (header)
! Title: / ! Expires: / ! Version: / ! Homepage: / ! Last modified:  → captured as list metadata
#include / !#include → ignored (pre‑expanded by tools/fetch-lists); !#if / !#endif honoured for env=chromium
domains##selector    → cosmetic (docs/COSMETIC-FILTERING.md)
domains#@#selector   → cosmetic exception
domains#?#selector   → procedural cosmetic
domains##+js(...)    → scriptlet (docs/SCRIPTLETS.md)
domains#@#+js(...)   → scriptlet exception
domains##^...        → HTML filter — UNSUPPORTED (warn)
everything else      → network filter
```

## 2. Network filter grammar

```
[@@] pattern [$option[,option]*]
pattern := "/" regex "/" | [ "||" | "|" ] text [ "|" ]   with "*" wildcard and "^" separator
```

`text` may contain `*` (any run) and `^` (separator: anything that is not a letter,
digit, or one of `_ - . %`, or end of URL). Non‑ASCII hostnames are punycoded.

### 2.1 Pattern → `condition.urlFilter` / `regexFilter`

| Filter pattern                                       | DNR condition                     | Notes                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `                                                    |                                   | example.com^`                                                                                                                          | `urlFilter: "                                     |                                                                            | example.com^"` | Direct: DNR shares the ` |     | `, ` | `, `^`, `*` semantics. |
| `                                                    |                                   | example.com^` with no other options                                                                                                    | `requestDomains: ["example.com"]`, no `urlFilter` | Preferred: domain rules are cheaper and merge well (§5).                   |
| `                                                    | https://…`/`…                     | `                                                                                                                                      | `urlFilter` with anchors                          | Direct.                                                                    |
| `ad/banner*.gif`                                     | `urlFilter: "ad/banner*.gif"`     | Direct.                                                                                                                                |
| `/ads?[0-9]+\.js/`                                   | `regexFilter`                     | RE2 only; validated with `isRegexSupported` at build time; ≤ 1,000 per ruleset.                                                        |
| pattern with `^` in the middle                       | `urlFilter`                       | Direct.                                                                                                                                |
| Pure hostname `example.com` (hosts‑file style lists) | `requestDomains: ["example.com"]` | Peter Lowe / hosts lists. Only for lists whose `format` is `hosts` (or lines shaped `0.0.0.0 host`, which the classifier rewrites to ` |                                                   | host^`): in an ABP list a bare `ads.js` is a substring pattern, as in uBO. |

`isUrlFilterCaseSensitive` is `false` unless `$match-case`.

**`urlFilter` validity is load-bearing.** Chrome validates _every declared ruleset_ when
the extension loads — enabled or not — and one malformed rule makes it refuse to load the
extension entirely, taking the service worker with it. The compiler therefore checks each
`urlFilter` it emits (`urlFilterProblem` in `src/dnr/convert.ts`) and drops the filter with
a reason rather than shipping it: no empty filter, no non-ASCII, no `|` anchor in the
middle, and never a leading `||*`. `||*.example.com^` is rewritten to the substring
`.example.com^` (which is what it means) instead of being emitted as `||*…`, and a pattern
that is nothing but `||*` is dropped.

**Entities in network rules.** DNR has no concept of `example.*`, so `$domain=`, `$to=`
and `$denyallow=` entities are expanded to concrete hostnames at compile time. The
expansion prefers hostnames the same list spells out elsewhere (`||news.co.uk^` and
`||news.de^` in the list ⇒ `$domain=news.*` expands to exactly those two) and only falls
back to the most common public suffixes when the list never names one; the fallback is
capped at `ENTITY_EXPANSION_LIMIT` = **100** hostnames. Cosmetic and scriptlet filters do
_not_ expand — they keep the entity key and match it at lookup time
(docs/COSMETIC-FILTERING.md §2, docs/SCRIPTLETS.md §2).

### 2.2 Options → `condition` / `action`

| Option                                                                                                                                                                                                                          | Mapping                                                                                                                                                    | Support                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `$script $image $stylesheet $object $xmlhttprequest/$xhr $subdocument/$frame $ping $websocket $media $font $other $webtransport $webbundle`                                                                                     | `resourceTypes` (or `excludedResourceTypes` when negated `~`)                                                                                              | ✅                                                                       |
| `$document` / `$doc`                                                                                                                                                                                                            | `resourceTypes: ["main_frame"]`; on `@@` → `allowAllRequests` (main_frame + sub_frame)                                                                     | ✅                                                                       |
| `$all`                                                                                                                                                                                                                          | every resource type                                                                                                                                        | ✅ (`$popup` part dropped)                                               |
| `$third-party` / `$3p` / `~first-party`                                                                                                                                                                                         | `domainType: "thirdParty"`                                                                                                                                 | ✅                                                                       |
| `$first-party` / `$1p` / `~third-party`                                                                                                                                                                                         | `domainType: "firstParty"`                                                                                                                                 | ✅                                                                       |
| `$domain=a.com                                                                                                                                                                                                                  | ~b.com`                                                                                                                                                    | `initiatorDomains` / `excludedInitiatorDomains`                          | ✅ Entities (`a.*`) expanded from the public‑suffix table (see below). Regex domains (`/…/`) dropped. |
| `$from=`                                                                                                                                                                                                                        | alias of `$domain=`                                                                                                                                        | ✅                                                                       |
| `$to=a.com                                                                                                                                                                                                                      | ~b.com`                                                                                                                                                    | `requestDomains` / `excludedRequestDomains`                              | ✅                                                                                                    |
| `$denyallow=a.com`                                                                                                                                                                                                              | `excludedRequestDomains` (on a rule whose `initiatorDomains` is set)                                                                                       | ✅                                                                       |
| `$method=get                                                                                                                                                                                                                    | ~post`                                                                                                                                                     | `requestMethods` / `excludedRequestMethods`                              | ✅                                                                                                    |
| `$match-case`                                                                                                                                                                                                                   | `isUrlFilterCaseSensitive: true`                                                                                                                           | ✅                                                                       |
| `$important`                                                                                                                                                                                                                    | priority tier 3 (§4)                                                                                                                                       | ✅                                                                       |
| `$badfilter`                                                                                                                                                                                                                    | removes the identical filter (compile‑time, across all lists in the same build)                                                                            | ✅                                                                       |
| `$redirect=name` / `$redirect-rule=name` / `$rewrite=abp-resource:name`                                                                                                                                                         | `action.redirect.extensionPath` → `/resources/<name>` (web‑accessible, see `docs/SCRIPTLETS.md` §5); `redirect-rule` only emits if a matching block exists | ✅ for names in the resource table; unknown names warn                   |
| `$removeparam=name`                                                                                                                                                                                                             | `action.redirect.transform.queryTransform.removeParams: ["name"]`                                                                                          | ✅ Only exact names; `~`, regex and empty (`$removeparam` alone) dropped |
| `$csp=directive`                                                                                                                                                                                                                | `modifyHeaders` `responseHeaders: [{header:"Content-Security-Policy", operation:"append", value}]`, `resourceTypes: ["main_frame","sub_frame"]`            | ✅                                                                       |
| `$removeheader=name` / `$removeheader=request:name`                                                                                                                                                                             | `modifyHeaders` remove on response / request                                                                                                               | ✅ except headers Chrome forbids modifying (warn)                        |
| `$header=name[:value]`                                                                                                                                                                                                          | `condition.responseHeaders: [{header, values?}]`; `~` → `excludedResponseHeaders`                                                                          | ✅ Chrome ≥ 128                                                          |
| `$permissions=…`                                                                                                                                                                                                                | `modifyHeaders` append `Permissions-Policy`                                                                                                                | ✅                                                                       |
| `$popup`, `$popunder`, `$inline-script`, `$inline-font`, `$strict1p/3p`, `$replace`, `$urlskip`, `$ipaddress`, `$cname`, `$webrtc`, `$mp4`, `$empty` (as block+redirect to empty: mapped to `$redirect=empty`), `$genericblock` | dropped with a warning, except `$empty` and `$mp4` which map to redirects                                                                                  | ⚠️                                                                       |
| `$elemhide`, `$generichide`, `$specifichide`, `$ghide`, `$shide`, `$ehide`                                                                                                                                                      | not DNR; recorded in the cosmetic DB as exceptions keyed by `initiatorDomains`/pattern hostname                                                            | ✅ (cosmetic engine)                                                     |

Unknown options make the whole filter invalid (dropped with a warning), matching uBO.

AdGuard-only options (`$stealth`, `$cookie`, `$app`, `$jsinject`, `$referrerpolicy`,
`$uritransform`, `$content`, `$removeparam-regexp`) and AdGuard's HTML-filtering syntax
(`domains$$element[attr="…"]`, which puts a second `$` at the head of the option list) are
dropped with a reason that names them, not as "unknown option" — AdGuard's own lists ship
tens of thousands of such lines and they are not list bugs.

The compiler evaluates `!#if` directives as a **Chromium MV3 extension**: `env_chromium`,
`env_chrome`, `env_mv3`, `ext_ublock`, `cap_user_stylesheet` and `adguard_ext_chromium_mv3`
are true. That last one matters for scale: AdGuard's lists gate their CNAME-tracker
sections on `!adguard_ext_chromium_mv3` precisely because MV3 cannot afford them (AdGuard
Spyware alone carries ~210,000 such lines), and gate MV3-adapted replacements on the
positive form.

## 3. Resource types

ABP option → DNR `ResourceType`:

```
script→script  image→image  stylesheet/css→stylesheet  object→object
xmlhttprequest/xhr→xmlhttprequest  subdocument/frame→sub_frame  document/doc→main_frame
ping/beacon→ping  websocket→websocket  media→media  font→font  other→other
webtransport→webtransport  webbundle→webbundle  csp_report→csp_report
```

A network filter with no type option matches **all types except `main_frame`**
(ABP semantics), so the compiler emits `excludedResourceTypes: ["main_frame"]` rather
than enumerating. `$document` on a block filter blocks `main_frame` too. Note that a DNR
rule with no `resourceTypes` at all never matches `main_frame` either (verified on Chrome
141), so filters that must apply to navigations (`$removeparam`, `$csp`, `@@…$document`)
always list their types explicitly.

## 4. Priority tiers

DNR precedence is by `priority` first. Fixed tiers:

| Tier | Filters                                                                                                                                                        | `priority` |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1    | plain block, removeparam, csp, removeheader                                                                                                                    | 1          |
| 2    | `$redirect` (must outrank plain block: DNR resolves `block` > `redirect` at equal priority; `@@` at the same priority still wins because `allow` > `redirect`) | 2          |
| 2    | `@@` exception (allow)                                                                                                                                         | 2          |
| 3    | `$important` block                                                                                                                                             | 3          |
| 4    | `$important` redirect                                                                                                                                          | 4          |
| 5    | `@@…$document` (allowAllRequests) from lists                                                                                                                   | 5          |
| 6    | user custom block (dynamic)                                                                                                                                    | 10         |
| 7    | user custom redirect / `@@` (dynamic)                                                                                                                          | 11         |
| 8    | user `$important` block (dynamic)                                                                                                                              | 12         |
| 9    | user `$important` redirect (dynamic)                                                                                                                           | 13         |
| 10   | picker preview / temporary (session)                                                                                                                           | 1000       |
| 11   | site mode `off` (session, `allowAllRequests`)                                                                                                                  | 1,000,000  |

`modifyHeaders` rules (`$csp`, `$removeheader`) use tier 1 (or 3 with `$important`); they
apply unless an `allow` rule of ≥ their priority matches, which is what `@@…$csp`
exceptions rely on.

## 5. Deduplication and merging (compiler)

Order of operations, per ruleset:

1. Parse all lines; apply `$badfilter` across the whole build.
2. Canonicalise: lowercase hostnames, sort option lists, punycode.
3. **Domain merge**: filters that differ only in the pattern hostname and are
   `||host^` with identical options merge into one rule with `requestDomains: [h1, h2, …]`
   (cap 5,000 domains per rule to keep rules cheap to evaluate). A group with more than
   5,000 distinct domains is **chunked** into `ceil(n / 5,000)` rules — it is never left
   unmerged. This is what keeps hosts-format lists and AdGuard's domain sections inside
   the per-list budget: Peter Lowe's ~3,500 hosts become a single rule, and a 100,000-host
   section becomes 20. A rule that already carries more than the cap (a long `$to=` list)
   is left alone. `||host^`, `||host^$third-party` and `||host^$3p` all merge, because
   `$3p` canonicalises to the same `domainType` and the option list is sorted before the
   dedupe key is taken (step 2).
4. **Initiator merge**: identical pattern + options except `$domain=` merge their
   `initiatorDomains`, with the same chunking rule.
5. Drop rules shadowed by a broader rule in the same tier (e.g. `||a.com/x` when
   `||a.com^` exists with a superset of types) — only when provably redundant.
6. Rank regex rules by list order; keep the first 1,000 per ruleset, warn on the rest.
7. Assign IDs (§6), validate with `isRegexSupported` where available (Node build:
   a local RE2 validator; unsupported constructs like lookahead/backreferences are
   rejected), emit JSON, and emit a `RulesetReport` with counts per category.

## 6. Rule ID ranges

**Static rule IDs are per ruleset.** Chrome only requires a rule ID to be unique _within_
its own ruleset, and `declarativeNetRequest.getMatchedRules()` identifies a match by the
`(rulesetId, ruleId)` pair — never by the ID alone. The compiler therefore numbers every
list from 1 independently: `dnr/easylist.json` and `dnr/easyprivacy.json` both start at
rule 1. Anything that names a rule (the logger, `report.json`, `delta.json`'s
`dnr.disable` map, `updateStaticRules`) must carry the ruleset ID alongside it.

Numbering globally instead used to exhaust the 299,999-ID static range after two large
lists, after which _every_ remaining list compiled to zero rules.

| Range             | Owner                                                        |
| ----------------- | ------------------------------------------------------------ |
| 1 – 299,999       | static rulesets — **per ruleset**, each list numbered from 1 |
| 300,000 – 319,999 | delta updates (dynamic)                                      |
| 320,000 – 329,999 | user custom filters (dynamic)                                |
| 330,000 – 334,999 | site allow / per‑site overrides (session)                    |
| 335,000 – 335,999 | picker / temporary (session)                                 |

## 7. Validation examples (test fixtures live in `packages/compiler/test/fixtures/`)

```
||ads.example.com^                          → {requestDomains:["ads.example.com"], excludedResourceTypes:["main_frame"]}
||example.com/banner/*$image,3p             → {urlFilter:"||example.com/banner/*", resourceTypes:["image"], domainType:"thirdParty"}
@@||cdn.example.com^$script,domain=site.com → allow, priority 2, initiatorDomains:["site.com"], resourceTypes:["script"]
||tracker.com^$important                    → block, priority 3
||example.com/ads.js$redirect=noop.js       → redirect extensionPath "/resources/noop.js", priority 2
$removeparam=utm_source                     → redirect transform removeParams (all URLs, all resource types incl. main_frame)
||site.com^$csp=script-src 'none'           → modifyHeaders CSP append on main_frame/sub_frame
/^https?:\/\/[a-z]+\.ad\.example\.com\//    → regexFilter
||example.com^$popup                        → dropped (warning: unsupported option "popup")
```
