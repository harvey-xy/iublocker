# Filter list snapshot (synthetic)

These files are a **small, hand-written, synthetic** stand-in for the real filter lists in
`tools/filterlists.json`. They are **not** copies of EasyList, EasyPrivacy, the uBlock
Origin filters or Peter Lowe's list — every rule targets `*-example.com` style
documentation domains that do not resolve.

## Why they exist

CI must be deterministic and offline-friendly: `pnpm rulesets:build` needs a list cache,
but downloading the live lists on every run would make builds non-reproducible (and the
compiler's integration snapshots unstable). So CI runs

```
pnpm rulesets:fetch -- --snapshot e2e/fixtures/lists
```

which copies `<id>.txt` and `<id>.meta.json` straight into `.cache/lists/` instead of
downloading anything. `pnpm rulesets:fetch` with no flags still fetches the real lists.

## Contents

| File              | Format        | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `easylist.txt`    | ABP           | third-party blocks, path patterns, every resource type, `$domain/$from/$to/$denyallow/$method/$match-case/$important`, `@@` exceptions incl. `$document/$elemhide/$generichide/$specifichide`, `$badfilter`, regex filters, `$redirect`/`$redirect-rule`, `$removeparam`, `$csp`, `$removeheader`, `$header`, `$permissions`, generic + specific + entity cosmetics, `#@#`, `:style()`, `:remove()`, `#?#` procedural, `!#if env_chromium` |
| `easyprivacy.txt` | ABP           | analytics hosts, tracking pixels, fingerprinting/sync, script paths, link decoration (`$removeparam`), header rules, exceptions, regex, a few cosmetics                                                                                                                                                                                                                                                                                    |
| `ubo-filters.txt` | ABP (trusted) | `##+js(...)` scriptlets — `set-constant`, `aopr`/`abort-on-property-read`, `nostif`/`no-setTimeout-if`, `json-prune` and friends — `#@#+js(...)` exceptions, unbreak `@@` rules, `$important` badware rules, quick-fix cosmetics                                                                                                                                                                                                           |
| `peter-lowe.txt`  | hosts         | `0.0.0.0 <host>` lines plus the usual `127.0.0.1 localhost` preamble                                                                                                                                                                                                                                                                                                                                                                       |

Each list has a `<id>.meta.json` with a fixed `fetchedAt` and the sha256 of the `.txt`, so
`rulesets/manifest.json` is byte-stable between CI runs.

## Editing

Regenerate the checksums after changing any `.txt`:

```
node --input-type=module -e "import{createHash}from'node:crypto';import{readFileSync,writeFileSync}from'node:fs';\
for(const id of ['easylist','easyprivacy','ubo-filters','peter-lowe']){const t=readFileSync('e2e/fixtures/lists/'+id+'.txt','utf8');\
const m=JSON.parse(readFileSync('e2e/fixtures/lists/'+id+'.meta.json','utf8'));\
m.sources[0].sha256=createHash('sha256').update(t,'utf8').digest('hex');m.sources[0].bytes=Buffer.byteLength(t);\
writeFileSync('e2e/fixtures/lists/'+id+'.meta.json',JSON.stringify(m,null,2)+'\n');}"
```

Ids must exist in `tools/filterlists.json`. Lists without a snapshot file are skipped by
`--snapshot` with a warning. Keep these files free of `127.0.0.1` rules — the e2e tests
serve their fixtures from there and `e2e/fixtures/test-list.txt` owns that host.
