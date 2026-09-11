# iuBlocker — notes for AI agents and contributors

Read `docs/ARCHITECTURE.md` first, then the doc for the area you touch. `docs/TASKS.md`
lists the workstreams and which directory each owns; stay inside your directory unless
you are changing a contract, in which case change `packages/shared` + the doc first.

Commands: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
`pnpm rulesets:build`, `pnpm e2e`. Node 22, pnpm 10. Chromium for e2e is pre-installed at
`$PLAYWRIGHT_BROWSERS_PATH`; never run `playwright install`.

Rules:

- TypeScript strict; `verbatimModuleSyntax` (use `import type`).
- `packages/compiler/src` (except `cli/`) and `packages/shared` must not import Node built-ins.
- The service worker is restarted often: no correctness-critical module state without hydration.
- No remote code. Scriptlet bodies are bundled; lists are data.
- No new dependencies without a one-line justification in the PR/commit message.
- Tests live next to the package (`test/` or `*.test.ts`), run by the root Vitest projects.
- Conventional Commits.
