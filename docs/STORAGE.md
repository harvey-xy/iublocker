# Storage Schema

`chrome.storage.local` holds durable state; `chrome.storage.session` holds per‑session
tab data. Types live in `packages/shared/src/storage.ts`. Every key is versioned via a
single `schemaVersion` and migrated in `background/storage/migrations.ts`.

## `chrome.storage.local`

| Key | Type | Notes |
|---|---|---|
| `schemaVersion` | `number` | current: 1 |
| `settings` | `Settings` | see below |
| `siteModes` | `Record<hostname, SiteMode>` | per‑site overrides; absence = default |
| `lists` | `Record<listId, { enabled: boolean }>` | list toggles; defaults from `RulesetManifest.defaultEnabled` |
| `userFiltersText` | `string` | raw text as typed in the dashboard |
| `userCompiled` | `{ dnr: DNRRule[]; cosmetic: CosmeticDB; scriptlets: ScriptletDB; warnings: string[] }` | compiled form, rebuilt on save |
| `delta` | `{ base: string; version: string; appliedAt: number; cosmetic: CosmeticDB; scriptlets: ScriptletDB; disabled: Record<listId, number[]> }` | last applied differential update (dnr adds live in dynamic rules) |
| `updater` | `{ lastCheck: number; lastSuccess: number; lastError?: string; etag?: string }` | |
| `stats` | `{ since: number; blockedTotal: number; perDay: Record<'yyyy-mm-dd', number> }` | |
| `pickerDrafts` | `Record<hostname, string[]>` | unsaved picker candidates |

```ts
interface Settings {
  defaultMode: SiteMode;             // 'optimal'
  showBadgeCount: boolean;           // true
  autoUpdate: boolean;               // true
  updateIntervalHours: number;       // 6
  updateChannel: 'stable' | 'nightly';
  collapseBlockedElements: boolean;  // true
  cloudDeltaBaseUrl: string;         // default from build config; user‑overridable for self‑hosting
  theme: 'auto' | 'light' | 'dark';
  advanced: { logMatchedRules: boolean; allowTrustedUserScriptlets: boolean };
}
```

## `chrome.storage.session`

| Key | Type |
|---|---|
| `tab:<tabId>` | `{ hostname: string; blocked: number; lastUrl: string; matched?: MatchedRuleSummary[] }` |
| `pickerActive:<tabId>` | `true` |

## Access layer

`background/storage/store.ts` exposes `get<K>(key)`, `set(patch)`, `onChange(key, cb)`
with in‑memory caching (the worker restarts often; the first access after start hydrates
the cache with one `storage.local.get(null)` call). No other module calls
`chrome.storage` directly.
