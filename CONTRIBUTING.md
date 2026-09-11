# Contributing to iuBlocker

Thanks for helping. Please read `docs/ARCHITECTURE.md` before your first PR.

## Setup

```bash
pnpm install
pnpm rulesets:fetch && pnpm rulesets:build
pnpm build && pnpm test
```

## Ground rules

- **No remote code, no telemetry.** PRs adding either are closed.
- Every message shape, storage key, or DB format change starts in `packages/shared` and
  in the corresponding doc.
- Keep the service worker re‑entrant: no module‑level state that is required for
  correctness without a hydration path.
- Filters and lists: we do not maintain filter lists here. Report site breakage to the
  list maintainers (EasyList forum, uAssets) unless it is caused by our compiler.
- Tests accompany features. `pnpm lint typecheck test` must pass.
- Commit messages: Conventional Commits (`feat(compiler): …`, `fix(content): …`).

## Reporting broken sites

Open an issue with the "Site breakage" template: URL, mode, enabled lists, the output of
Dashboard → About → "Copy diagnostics".

## License

By contributing you agree your work is licensed under GPL‑3.0‑or‑later.
