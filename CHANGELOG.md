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
- Tooling: list fetcher, delta generator, packager, CI / nightly rulesets / release
  workflows, Playwright e2e suite (25 tests) running the unpacked extension in Chromium.
