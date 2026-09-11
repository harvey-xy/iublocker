# Rulesets: packaging, budgets, differential updates

## 1. Sources (`tools/filterlists.json`)

```json
{
  "lists": [
    { "id": "easylist",      "title": "EasyList",       "urls": ["https://easylist.to/easylist/easylist.txt"], "group": "ads",      "defaultEnabled": true,  "trusted": false, "license": "CC BY-SA 3.0", "expires": "4 days" },
    { "id": "easyprivacy",   "title": "EasyPrivacy",    "urls": ["https://easylist.to/easylist/easyprivacy.txt"], "group": "privacy", "defaultEnabled": true },
    { "id": "ubo-filters",   "title": "uBlock filters", "urls": ["https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt", ".../badware.txt", ".../privacy.txt", ".../quick-fixes.txt", ".../unbreak.txt"], "group": "ads", "defaultEnabled": true, "trusted": true },
    { "id": "peter-lowe",    "title": "Peter Lowe's Ad and tracking server list", "urls": ["https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext"], "format": "hosts", "group": "privacy", "defaultEnabled": true },
    { "id": "malware-urlhaus", "title": "Online Malicious URL Blocklist", "urls": ["https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt"], "group": "malware", "defaultEnabled": true },
    { "id": "easylist-cookie", "title": "EasyList Cookie", "urls": ["https://secure.fanboy.co.nz/fanboy-cookiemonster.txt"], "group": "annoyances", "defaultEnabled": false },
    { "id": "ubo-annoyances", "title": "uBlock annoyances", "urls": ["https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances.txt"], "group": "annoyances", "defaultEnabled": false, "trusted": true },
    { "id": "fanboy-annoyance", "title": "Fanboy's Annoyance", "urls": ["https://secure.fanboy.co.nz/fanboy-annoyance.txt"], "group": "annoyances", "defaultEnabled": false },
    { "id": "adguard-mobile", "title": "AdGuard Mobile Ads", "urls": ["https://filters.adtidy.org/extension/ublock/filters/11.txt"], "group": "ads", "defaultEnabled": false },
    { "id": "easylist-zh",   "title": "EasyList China", "urls": ["https://easylist-downloads.adblockplus.org/easylistchina.txt"], "group": "regional", "lang": ["zh"], "defaultEnabled": false },
    { "id": "cjx-annoyance", "title": "CJX's Annoyance List", "urls": ["https://raw.githubusercontent.com/cjx82630/cjxlist/master/cjx-annoyance.txt"], "group": "regional", "lang": ["zh"], "defaultEnabled": false },
    { "id": "easylist-jp",   "title": "EasyList Japan (ABP Japanese)", "urls": ["https://raw.githubusercontent.com/k2jp/abp-japanese-filters/master/abpjf.txt"], "group": "regional", "lang": ["ja"], "defaultEnabled": false },
    { "id": "easylist-kr",   "title": "List-KR", "urls": ["https://raw.githubusercontent.com/List-KR/List-KR/master/filter-uBlockOrigin.txt"], "group": "regional", "lang": ["ko"], "defaultEnabled": false },
    { "id": "easylist-de",   "title": "EasyList Germany", "urls": ["https://easylist.to/easylistgermany/easylistgermany.txt"], "group": "regional", "lang": ["de"], "defaultEnabled": false },
    { "id": "easylist-fr",   "title": "Liste FR", "urls": ["https://easylist-downloads.adblockplus.org/liste_fr.txt"], "group": "regional", "lang": ["fr"], "defaultEnabled": false },
    { "id": "easylist-es",   "title": "EasyList Spanish", "urls": ["https://easylist-downloads.adblockplus.org/easylistspanish.txt"], "group": "regional", "lang": ["es"], "defaultEnabled": false },
    { "id": "easylist-it",   "title": "EasyList Italy", "urls": ["https://easylist-downloads.adblockplus.org/easylistitaly.txt"], "group": "regional", "lang": ["it"], "defaultEnabled": false },
    { "id": "ruadlist",      "title": "RU AdList", "urls": ["https://easylist-downloads.adblockplus.org/advblock.txt"], "group": "regional", "lang": ["ru"], "defaultEnabled": false },
    { "id": "easylist-pt",   "title": "EasyList Portuguese", "urls": ["https://easylist-downloads.adblockplus.org/easylistportuguese.txt"], "group": "regional", "lang": ["pt"], "defaultEnabled": false },
    { "id": "easylist-nl",   "title": "EasyList Dutch", "urls": ["https://easylist-downloads.adblockplus.org/easylistdutch.txt"], "group": "regional", "lang": ["nl"], "defaultEnabled": false },
    { "id": "easylist-pl",   "title": "EasyList Polish", "urls": ["https://easylist-downloads.adblockplus.org/easylistpolish.txt"], "group": "regional", "lang": ["pl"], "defaultEnabled": false },
    { "id": "abpvn",         "title": "ABPVN (Vietnamese)", "urls": ["https://raw.githubusercontent.com/abpvn/abpvn/master/filter/abpvn.txt"], "group": "regional", "lang": ["vi"], "defaultEnabled": false }
  ]
}
```

Regional lists default‑enabled at runtime when `navigator.languages` matches `lang`
(first run only). `!#include` directives are expanded by `tools/fetch-lists`. Each list
has a unique static ruleset with the same `id`.

## 2. Output layout (`packages/extension/dist/rulesets/`)

```
manifest.json                 RulesetManifest (below)
dnr/<listId>.json             DNR rules (declared in manifest.json → declarative_net_request.rule_resources)
cosmetic/<listId>.json        CosmeticDB
scriptlets/<listId>.json      ScriptletDB
scriptlet-groups/<hash>.js    MAIN‑world bundles for registerContentScripts
report.json                   per‑list RulesetReport (counts, dropped filters with reasons, budget)
```

```ts
interface RulesetManifest {
  version: string;               // "2026.09.11.1" — date of list snapshot + build number
  builtAt: string;               // ISO
  lists: Array<{
    id: string; title: string; group: ListGroup; lang?: string[]; defaultEnabled: boolean; trusted: boolean;
    homepage?: string; license?: string;
    sources: Array<{ url: string; sha256: string; fetchedAt: string }>;
    counts: { dnr: number; regex: number; cosmeticGeneric: number; cosmeticSpecific: number; procedural: number; scriptlets: number; dropped: number };
    files: { dnr: string; cosmetic: string; scriptlets: string };
  }>;
  budget: { staticRulesTotal: number; staticRulesDefaultEnabled: number; regexTotal: number };
  scriptletGroups: Array<{ hash: string; file: string; hosts: string[]; listIds: string[] }>;
}
```

## 3. Budgets enforced by the build

- Sum of DNR rules across `defaultEnabled` lists ≤ 300,000 (leaves headroom under 330,000
  for users enabling extras). Build fails above it.
- Any single list ≤ 150,000 rules.
- Regex ≤ 1,000 per list (compiler drops beyond with warnings; report lists them).
- Scriptlet group bundles total ≤ 8 MB.
- `manifest.json` (extension) declares ≤ 100 rulesets; the build fails otherwise.

## 4. Extension manifest wiring

`tools/build-extension` reads `rulesets/manifest.json` and writes
`declarative_net_request.rule_resources` entries `{ id, enabled: defaultEnabled, path }`
into the generated `manifest.json`. Runtime enabling uses `updateEnabledRulesets`.
Regional lists have `enabled: false` in the manifest; the worker enables matching
languages on first install.

## 5. Dynamic rule ID allocation

See `docs/FILTER-SYNTAX.md` §6. Allocation is by `DynamicRules.allocate(range, count)`
which scans existing rules once per worker start and hands out the lowest free IDs in the
range. User rules are fully rewritten on every user‑filter save (remove all in user range,
add new); delta rules are fully rewritten on every delta apply.

## 6. Differential updates

CI (`.github/workflows/rulesets-nightly.yml`) runs daily:

1. `pnpm rulesets:fetch && pnpm rulesets:build` → fresh full build (`new`).
2. For each **released** extension version still supported (last 3), load its shipped
   `rulesets/manifest.json` + `dnr/*.json` (`old`) from the release assets.
3. `tools/make-delta old new` → `delta/<extensionVersion>.json`:
   - `dnr.add` = rules in `new` not in `old` (structural equality ignoring `id`), IDs
     assigned in the delta range, capped at 20,000 (rank: `$important` and allow first,
     then by list priority order, then list order);
   - `dnr.disable` = per ruleset, IDs of rules in `old` not in `new`, capped at 5,000
     per ruleset;
   - cosmetic/scriptlet add/remove sets by hostname.
4. Publish `delta/*.json` + `manifest.json` to the `rulesets` branch (served through
   `https://raw.githubusercontent.com/harvey-xy/iublocker/rulesets/…`) and as assets on
   a rolling `rulesets-nightly` release.

The extension's `Updater` (alarm every `updateIntervalHours`) fetches
`<cloudDeltaBaseUrl>/delta/<runtime.getManifest().version>.json`, compares `version`
with `storage.delta.version`, and applies atomically: `updateDynamicRules({removeRuleIds:
<delta range>, addRules})`, `updateStaticRules` per list, then storage. Failure leaves
the previous delta intact.
