<p align="center">
  <img src="docs/assets/logo.svg" width="96" alt="iuBlocker logo" />
</p>

<h1 align="center">iuBlocker</h1>

<p align="center">
  An open‑source, Manifest V3 content blocker for modern Chrome.<br/>
  uBlock Origin‑class blocking, built for the browser Google actually ships.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: GPL-3.0-or-later" src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg"></a>
  <img alt="Manifest V3" src="https://img.shields.io/badge/manifest-v3-green.svg">
  <img alt="Chrome 128+" src="https://img.shields.io/badge/chrome-128%2B-yellow.svg">
</p>

[繁體中文說明](README.zh-TW.md)

---

## Why iuBlocker?

Chrome has removed support for Manifest V2 extensions. The original uBlock Origin
(MV2) no longer runs on current Chrome releases. iuBlocker is a ground‑up,
MV3‑native content blocker that keeps the parts of uBlock Origin that matter
(filter‑list compatibility, cosmetic filtering, scriptlets, per‑site control) and
adds what MV3 makes possible:

| Capability                                                       | uBlock Origin (MV2)    | uBO Lite     | **iuBlocker**                                                                       |
| ---------------------------------------------------------------- | ---------------------- | ------------ | ----------------------------------------------------------------------------------- |
| Runs on current Chrome                                           | ❌                     | ✅           | ✅                                                                                  |
| Network blocking (EasyList, EasyPrivacy, uBO filters, …)         | ✅                     | ✅           | ✅ `declarativeNetRequest`, 330k static‑rule budget used efficiently                |
| Filter list updates without an extension update                  | ✅                     | ❌           | ✅ **Differential updates** via dynamic rules + `updateStaticRules`                 |
| Specific cosmetic filtering (`example.com##.ad`)                 | ✅                     | ✅           | ✅ Injected from the service worker at `onCommitted` (no content‑script round trip) |
| Generic cosmetic filtering                                       | ✅                     | partial      | ✅ DOM‑harvested id/class lookup + batched CSS                                      |
| Procedural cosmetic filters (`:has-text()`, `:matches-css()`, …) | ✅                     | partial      | ✅                                                                                  |
| Scriptlets (`##+js(...)`)                                        | ✅                     | ✅           | ✅ MAIN‑world, `document_start`, pre‑registered per domain                          |
| `$redirect`, `$removeparam`, `$csp`, `$removeheader`, `$header`  | ✅                     | partial      | ✅ mapped to DNR redirect / transform / modifyHeaders / responseHeaders             |
| Custom user filters                                              | ✅                     | ❌           | ✅ compiled in‑browser to dynamic rules + cosmetic DB                               |
| Element picker                                                   | ✅                     | ❌           | ✅                                                                                  |
| Per‑site blocking modes                                          | ✅ (dynamic filtering) | ✅ (4 modes) | ✅ 4 modes + global default + one‑click disable                                     |
| Telemetry / remote code                                          | none                   | none         | **none** — all code is bundled, lists are data                                      |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how this works under MV3's constraints.

## Status

Pre‑release. The project is being built in the open; see [docs/ROADMAP.md](docs/ROADMAP.md)
and [docs/TASKS.md](docs/TASKS.md) for the work breakdown.

## Install (development build)

Requirements: Node.js ≥ 22, pnpm ≥ 10, Chrome / Chromium ≥ 128.

```bash
git clone https://github.com/harvey-xy/iublocker.git
cd iublocker
pnpm install
pnpm rulesets:fetch      # download filter lists into .cache/lists
pnpm rulesets:build      # compile them into packages/extension/dist/rulesets
pnpm build               # build the extension into packages/extension/dist
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**
and select `packages/extension/dist`.

## Repository layout

```
packages/
  shared/       Types and contracts shared by every package (messages, storage, DB formats)
  compiler/     Filter‑list parser + DNR / cosmetic / scriptlet compiler (Node CLI + browser build)
  scriptlets/   Library of MAIN‑world scriptlets (bundled, never fetched remotely)
  extension/    The MV3 extension: service worker, content scripts, popup, dashboard, picker
tools/          Build helpers: list fetching, ruleset packaging, release, delta generation
e2e/            Playwright tests that load the unpacked extension in Chromium
docs/           Design docs (start with ARCHITECTURE.md)
```

## Documentation

| Doc                                                      | What it covers                                                |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)             | System design, MV3 constraints, request lifecycle, modes      |
| [docs/FILTER-SYNTAX.md](docs/FILTER-SYNTAX.md)           | Supported ABP/uBO syntax and the exact DNR mapping            |
| [docs/COSMETIC-FILTERING.md](docs/COSMETIC-FILTERING.md) | Element hiding, generic hiding, procedural filters, DB format |
| [docs/SCRIPTLETS.md](docs/SCRIPTLETS.md)                 | Scriptlet library, injection strategy, adding a scriptlet     |
| [docs/MESSAGING.md](docs/MESSAGING.md)                   | Runtime message protocol between contexts                     |
| [docs/STORAGE.md](docs/STORAGE.md)                       | Storage schema and migrations                                 |
| [docs/RULESETS.md](docs/RULESETS.md)                     | Ruleset packaging, budgets, differential updates              |
| [docs/BUILD-AND-RELEASE.md](docs/BUILD-AND-RELEASE.md)   | Build pipeline, CI, release process                           |
| [docs/TESTING.md](docs/TESTING.md)                       | Unit, integration, and e2e testing strategy                   |
| [docs/ROADMAP.md](docs/ROADMAP.md)                       | Milestones                                                    |
| [docs/TASKS.md](docs/TASKS.md)                           | Work breakdown used to parallelise implementation             |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[GPL‑3.0‑or‑later](LICENSE). Filter lists are the property of their respective
maintainers and are distributed under their own licenses (see `tools/filterlists.json`).
iuBlocker is not affiliated with uBlock Origin or Raymond Hill; we are grateful for the
filter‑list ecosystem and the design ideas that project pioneered.
