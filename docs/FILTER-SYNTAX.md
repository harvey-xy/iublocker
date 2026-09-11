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

| Filter pattern | DNR condition | Notes |
|---|---|---|
| `||example.com^` | `urlFilter: "||example.com^"` | Direct: DNR shares the `||`, `|`, `^`, `*` semantics. |
| `||example.com^` with no other options | `requestDomains: ["example.com"]`, no `urlFilter` | Preferred: domain rules are cheaper and merge well (§5). |
| `|https://…` / `…|` | `urlFilter` with anchors | Direct. |
| `ad/banner*.gif` | `urlFilter: "ad/banner*.gif"` | Direct. |
| `/ads?[0-9]+\.js/` | `regexFilter` | RE2 only; validated with `isRegexSupported` at build time; ≤ 1,000 per ruleset. |
| pattern with `^` in the middle | `urlFilter` | Direct. |
| Pure hostname `example.com` (hosts‑file style lists) | `requestDomains: ["example.com"]` | Peter Lowe / hosts lists. |

`isUrlFilterCaseSensitive` is `false` unless `$match-case`.

### 2.2 Options → `condition` / `action`

| Option | Mapping | Support |
|---|---|---|
| `$script $image $stylesheet $object $xmlhttprequest/$xhr $subdocument/$frame $ping $websocket $media $font $other $webtransport $webbundle` | `resourceTypes` (or `excludedResourceTypes` when negated `~`) | ✅ |
| `$document` / `$doc` | `resourceTypes: ["main_frame"]`; on `@@` → `allowAllRequests` (main_frame + sub_frame) | ✅ |
| `$all` | every resource type | ✅ (`$popup` part dropped) |
| `$third-party` / `$3p` / `~first-party` | `domainType: "thirdParty"` | ✅ |
| `$first-party` / `$1p` / `~third-party` | `domainType: "firstParty"` | ✅ |
| `$domain=a.com|~b.com` | `initiatorDomains` / `excludedInitiatorDomains` | ✅ Entities (`a.*`) expanded from the public‑suffix table. Regex domains (`/…/`) dropped. |
| `$from=` | alias of `$domain=` | ✅ |
| `$to=a.com|~b.com` | `requestDomains` / `excludedRequestDomains` | ✅ |
| `$denyallow=a.com` | `excludedRequestDomains` (on a rule whose `initiatorDomains` is set) | ✅ |
| `$method=get|~post` | `requestMethods` / `excludedRequestMethods` | ✅ |
| `$match-case` | `isUrlFilterCaseSensitive: true` | ✅ |
| `$important` | priority tier 3 (§4) | ✅ |
| `$badfilter` | removes the identical filter (compile‑time, across all lists in the same build) | ✅ |
| `$redirect=name` / `$redirect-rule=name` / `$rewrite=abp-resource:name` | `action.redirect.extensionPath` → `/resources/<name>` (web‑accessible, see `docs/SCRIPTLETS.md` §5); `redirect-rule` only emits if a matching block exists | ✅ for names in the resource table; unknown names warn |
| `$removeparam=name` | `action.redirect.transform.queryTransform.removeParams: ["name"]` | ✅ Only exact names; `~`, regex and empty (`$removeparam` alone) dropped |
| `$csp=directive` | `modifyHeaders` `responseHeaders: [{header:"Content-Security-Policy", operation:"append", value}]`, `resourceTypes: ["main_frame","sub_frame"]` | ✅ |
| `$removeheader=name` / `$removeheader=request:name` | `modifyHeaders` remove on response / request | ✅ except headers Chrome forbids modifying (warn) |
| `$header=name[:value]` | `condition.responseHeaders: [{header, values?}]`; `~` → `excludedResponseHeaders` | ✅ Chrome ≥ 128 |
| `$permissions=…` | `modifyHeaders` append `Permissions-Policy` | ✅ |
| `$popup`, `$popunder`, `$inline-script`, `$inline-font`, `$strict1p/3p`, `$replace`, `$urlskip`, `$ipaddress`, `$cname`, `$webrtc`, `$mp4`, `$empty` (as block+redirect to empty: mapped to `$redirect=empty`), `$genericblock` | dropped with a warning, except `$empty` and `$mp4` which map to redirects | ⚠️ |
| `$elemhide`, `$generichide`, `$specifichide`, `$ghide`, `$shide`, `$ehide` | not DNR; recorded in the cosmetic DB as exceptions keyed by `initiatorDomains`/pattern hostname | ✅ (cosmetic engine) |

Unknown options make the whole filter invalid (dropped with a warning), matching uBO.

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
than enumerating. `$document` on a block filter blocks `main_frame` too.

## 4. Priority tiers

DNR precedence is by `priority` first. Fixed tiers:

| Tier | Filters | `priority` |
|---|---|---|
| 1 | plain block, redirect, removeparam, csp, removeheader | 1 |
| 2 | `@@` exception (allow) | 2 |
| 3 | `$important` block/redirect | 3 |
| 4 | `@@…$document` (allowAllRequests) from lists | 4 |
| 5 | user custom block (dynamic) | 10 |
| 6 | user custom `@@` (dynamic) | 11 |
| 7 | user `$important` (dynamic) | 12 |
| 8 | picker preview / temporary (session) | 1000 |
| 9 | site mode `off` (session, `allowAllRequests`) | 1,000,000 |

`modifyHeaders` rules (`$csp`, `$removeheader`) use tier 1 (or 3 with `$important`); they
apply unless an `allow` rule of ≥ their priority matches, which is what `@@…$csp`
exceptions rely on.

## 5. Deduplication and merging (compiler)

Order of operations, per ruleset:

1. Parse all lines; apply `$badfilter` across the whole build.
2. Canonicalise: lowercase hostnames, sort option lists, punycode.
3. **Domain merge**: filters that differ only in the pattern hostname and are
   `||host^` with identical options merge into one rule with `requestDomains: [h1, h2, …]`
   (cap 5,000 domains per rule to keep rules cheap to evaluate).
4. **Initiator merge**: identical pattern + options except `$domain=` merge their
   `initiatorDomains`.
5. Drop rules shadowed by a broader rule in the same tier (e.g. `||a.com/x` when
   `||a.com^` exists with a superset of types) — only when provably redundant.
6. Rank regex rules by list order; keep the first 1,000 per ruleset, warn on the rest.
7. Assign IDs (§6), validate with `isRegexSupported` where available (Node build:
   a local RE2 validator; unsupported constructs like lookahead/backreferences are
   rejected), emit JSON, and emit a `RulesetReport` with counts per category.

## 6. Rule ID ranges

| Range | Owner |
|---|---|
| 1 – 299,999 | static rulesets (IDs are per‑ruleset, but the compiler keeps them globally unique for logging) |
| 300,000 – 319,999 | delta updates (dynamic) |
| 320,000 – 329,999 | user custom filters (dynamic) |
| 330,000 – 334,999 | site allow / per‑site overrides (session) |
| 335,000 – 335,999 | picker / temporary (session) |

## 7. Validation examples (test fixtures live in `packages/compiler/test/fixtures/`)

```
||ads.example.com^                          → {requestDomains:["ads.example.com"], excludedResourceTypes:["main_frame"]}
||example.com/banner/*$image,3p             → {urlFilter:"||example.com/banner/*", resourceTypes:["image"], domainType:"thirdParty"}
@@||cdn.example.com^$script,domain=site.com → allow, priority 2, initiatorDomains:["site.com"], resourceTypes:["script"]
||tracker.com^$important                    → block, priority 3
||example.com/ads.js$redirect=noop.js       → redirect extensionPath "/resources/noop.js"
$removeparam=utm_source                     → redirect transform removeParams (all URLs)
||site.com^$csp=script-src 'none'           → modifyHeaders CSP append on main_frame/sub_frame
/^https?:\/\/[a-z]+\.ad\.example\.com\//    → regexFilter
||example.com^$popup                        → dropped (warning: unsupported option "popup")
```
