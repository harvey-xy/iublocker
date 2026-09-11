# Public-suffix snapshot

`suffixes.ts` holds a compact, hand-curated snapshot of the public suffixes needed to
expand filter _entities_ (`example.*` in `$domain=`, `$to=` and in cosmetic filters).

We do not ship the full Public Suffix List (~9,500 rules, ~80 KB): entity expansion is
capped at `ENTITY_EXPANSION_LIMIT` (300) hostnames anyway, so only the suffixes that
actually occur in filter lists matter. The snapshot is **ordered most-common-first**
because the fallback expansion is `PUBLIC_SUFFIXES.slice(0, limit)`.

## What is in it

1. every ccTLD,
2. the legacy gTLDs (`com`, `net`, `org`, `info`, `biz`, `mobi`, …),
3. the new gTLDs that appear in ad/tracker domains (`app`, `dev`, `cloud`, `xyz`, …),
4. the common second-level suffixes (`co.uk`, `com.au`, `co.jp`, `com.br`, `com.cn`,
   `co.in`, `co.za`, `com.tw`, `com.mx`, `com.ar`, …) including the full `*.br` and
   `*.pl` second-level sets, which are the ones filter lists actually use.

Wildcard rules (`*.ck`) and exception rules (`!www.ck`) from the real PSL are _not_
modelled: they never appear in filter-list entities.

## Regenerating

There is no network access in CI for this file, so it is checked in. To refresh it from
the upstream list:

```sh
curl -sSL https://publicsuffix.org/list/public_suffix_list.dat > /tmp/psl.dat

node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  // 1. keep ICANN rules only (between the BEGIN/END ICANN DOMAINS markers)
  // 2. drop wildcard/exception rules and punycode the rest
  // 3. rank by how many hostnames in .cache/lists/*.txt end with the suffix
  // 4. keep the top ~2000 and emit src/psl/suffixes.ts with the same shape
'
```

Keep the emitted file to a single whitespace-separated template string: it compresses
far better in the extension bundle than an array literal, and `PUBLIC_SUFFIXES` is only
materialised once.

## Invariants the tests rely on

- `com`, `net`, `org`, `co.uk`, `com.au`, `co.jp`, `com.br` are present.
- The first entry is `com`.
- Entries are unique and contain no leading dot.
