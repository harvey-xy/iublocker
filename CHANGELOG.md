# Changelog

All notable changes are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]
- Project foundation: architecture docs, shared contracts, monorepo scaffold.
- Compiler: ABP/uBO network filters → declarativeNetRequest (dedupe, domain merge, regex
  ranking, RE2 validation, priority tiers), cosmetic + procedural + scriptlet filters →
  per-list databases, in-browser compilation of user filters, CLI with budget report.
- Scriptlet library (58 scriptlets + surrogates) and `$redirect` resources.
- Extension: MV3 service worker (rulesets, site modes, injector, updater with
  differential updates, stats), content scripts (cosmetic engine, procedural executor,
  element picker), popup / dashboard / logger UI with en, zh_TW, zh_CN locales.
- Tooling: list fetcher (with GitHub mirror sets), delta generator, packager, CI / nightly
  rulesets / release workflows, Playwright e2e suite (25 tests) running the unpacked
  extension in Chromium, and `pnpm verify:real` loading the full real-list build in Chrome.
- Scale fixes from real lists: per-ruleset rule IDs, chunked domain merging, entity keys
  (`example.*`) resolved at lookup time, one scriptlet group file per scriptlet name, RE2
  program-size estimator calibrated against Chrome, 98 scriptlets and 136 `$redirect` names.
- Hardening from adversarial review: `getMatchedRules` quota budgeting (badge/stats no longer
  stall), serialised reconcile / dynamic-rule rewrites / storage updates, resilient ruleset
  enabling, delta redirects restricted to bundled resources, cosmetic engine resistant to
  prototype-key and DOM-clobbering attacks, nested `:has()` compiled as procedural (no more
  poisoned CSS chunks), `||host-` prefix anchors, `@@…$redirect-rule` exceptions, `$header`
  globs, prototype-safe list-controlled keys, catastrophic-regex rejection.
