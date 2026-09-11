# Roadmap

## M0 — Foundation (this iteration)

- Repository, docs, contracts (`@iublocker/shared`), CI skeleton.

## M1 — Blocking core

- Compiler: network filters → DNR with dedupe/merge, report, budgets.
- Extension: static rulesets, list toggles, site modes, badge counts, popup.
- E2E: network blocking on fixture pages.

## M2 — Cosmetic + scriptlets

- Cosmetic DB, worker `insertCSS`, generic hiding, procedural engine.
- Scriptlet library (v1 set), pre‑registered groups, dynamic path.
- Redirect resources.

## M3 — User control

- Custom filters compiled in‑browser (dynamic rules + cosmetic).
- Element picker, per‑site whitelist UI, dashboard, logger.

## M4 — Updates & release

- Differential updates (nightly CI, `rulesets` branch), updater with alarm.
- Release workflow, zip packaging, CWS upload script, manual QA doc.
- v0.1.0 public pre‑release.

## Later

- Firefox (MV3 with `webRequest` blocking where available) port.
- Import/export settings; sync via `chrome.storage.sync` for site modes.
- Localisation beyond en/zh‑TW/zh‑CN.
- Optional host permissions mode (permission‑less install).
