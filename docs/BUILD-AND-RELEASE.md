# Build and Release

## Toolchain

- Node 22, pnpm 10 (workspaces), TypeScript 5 (strict), esbuild for bundling,
  Vitest for unit tests, Playwright for e2e, ESLint 9 (flat config) + Prettier.
- Preact for popup/dashboard UI.

## Commands (root)

| Command                                      | Does                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                               | install workspace                                                                                                 |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | across all packages                                                                                               |
| `pnpm rulesets:fetch`                        | `tools/fetch-lists.ts` → `.cache/lists/<id>.txt` (+ `.meta.json` with sha256/etag). Retries, follows `!#include`. |
| `pnpm rulesets:build`                        | `packages/compiler` CLI → `packages/extension/dist/rulesets/*` + `report.json`                                    |
| `pnpm build`                                 | builds `shared`, `scriptlets`, `compiler`, then `extension` (`packages/extension/scripts/build.ts`)               |
| `pnpm build:e2e`                             | `IUB_E2E=1 pnpm build`: additionally bundles `e2e/fixtures/test-list.txt` as ruleset `e2e-test`                   |
| `pnpm e2e`                                   | Playwright with the unpacked extension                                                                            |
| `pnpm delta -- <oldDir> <newDir>`            | `tools/make-delta.ts`                                                                                             |
| `pnpm package`                               | zips `packages/extension/dist` → `artifacts/iublocker-<version>.zip`                                              |

## Extension build (`packages/extension/scripts/build.ts`)

1. Clean `dist/`.
2. esbuild entry points: `src/background/index.ts` (ESM, service worker),
   `src/content/cosmetic.ts`, `src/content/picker.ts` (IIFE), `src/ui/popup/index.tsx`,
   `src/ui/dashboard/index.tsx`, `src/ui/logger/index.tsx` (IIFE, `jsx: automatic`,
   `jsxImportSource: preact`). Target `chrome128`, minify in release, sourcemaps in dev.
   An entry point whose source file does not exist yet is **skipped with a warning** so the
   package always builds while workstreams land in parallel.
3. Copy `public/` (HTML pages, `resources/` redirect files, icons, `_locales/`).
4. Copy `packages/extension/rulesets/` (compiler output). Missing output is a warning and
   the build continues with an empty ruleset list — pass `--strict` to fail instead, or
   `--skip-rulesets` to skip the step entirely.
5. Generate `manifest.json` from `src/manifest.ts` + ruleset manifest (rule_resources
   `{id, enabled: defaultEnabled, path: "rulesets/dnr/<id>.json"}`, web_accessible_resources,
   version from root `package.json`). Content-script entries whose bundle was skipped are
   dropped so Chrome can always load `dist/`. With `IUB_E2E=1` (or `--e2e`) the `e2e-test`
   ruleset is declared and enabled.
6. Write `dist/build-info.json` (git sha, list snapshot version, entries built/skipped).

Flags: `--watch`, `--minify`, `--strict`, `--skip-rulesets`, `--e2e`, `--out <dir>`
(build somewhere other than `dist/`; used by the build's own smoke test).

## CI (`.github/workflows/ci.yml`)

On PR and push to `main`: install → lint → typecheck → unit tests → `rulesets:build`
with a **small cached snapshot** of lists checked in under `e2e/fixtures/lists/`
(not the live lists, for determinism) → build → e2e (Chromium, headless new) → upload
`dist` as artifact.

## Nightly rulesets (`.github/workflows/rulesets-nightly.yml`)

See `docs/RULESETS.md` §6. Commits to the `rulesets` branch and updates the
`rulesets-nightly` prerelease.

## Release (`.github/workflows/release.yml`)

On tag `v*`: full fresh list fetch → build → package → GitHub Release with
`iublocker-<version>.zip`, `rulesets/manifest.json`, `report.json`. Chrome Web Store
upload is a manual step until the store listing exists (`tools/cws-upload.ts` is
provided, keyed by repository secrets).

Versioning: extension `version` = `MAJOR.MINOR.PATCH`; list snapshot version =
`YYYY.MM.DD.N` in `rulesets/manifest.json`; the popup shows both.
