# Testing Strategy

## Unit (Vitest, per package)

- `compiler`: table‑driven parser tests (`test/fixtures/*.txt` + expected JSON), DNR
  conversion snapshots, dedupe/merge property tests, PSL/entity expansion, regex
  validation, ID allocation, delta generation. Target ≥ 90% line coverage.
- `scriptlets`: each scriptlet has a jsdom test that sets up the page global, injects
  the scriptlet the same way the extension does (`new Function` is fine **in tests**),
  and asserts behaviour (e.g. `set-constant` defines, `no-setTimeout-if` defuses).
- `extension`: pure modules (hostname walk, mode resolution, cosmetic lookup, message
  router) tested with a `chrome` mock (`test/chrome-mock.ts`, minimal hand‑written; no
  heavy sinon‑chrome dependency). Content‑script cosmetic engine tested in jsdom.

## Integration (Node)

`packages/compiler/test/integration/` compiles the checked‑in list snapshot in
`e2e/fixtures/lists/` and asserts budget, no duplicate IDs, every regex passes RE2
validation, `report.json` is stable (snapshot).

## E2E (Playwright, `e2e/`)

- Launch Chromium with `--disable-extensions-except=<dist>` `--load-extension=<dist>`
  via `chromium.launchPersistentContext` (headless "new" supports extensions). Use the
  pre‑installed browser (`PLAYWRIGHT_BROWSERS_PATH`), never download in CI containers.
- A local static server (`e2e/server.ts`) on `127.0.0.1:<port>` serves fixture pages
  under `e2e/fixtures/pages/`:
  - `network.html` loads `/ads/banner.js`, `/track/pixel.gif`, an iframe to `/ads/frame.html`
    → assert blocked (script never sets `window.__ad`), image `naturalWidth === 0`.
  - `cosmetic.html` has `.ad-banner`, `#sponsored`, and text‑based procedural cases →
    assert `getComputedStyle(el).display === 'none'` in `optimal` / `complete`.
  - `scriptlet.html` reads `window.adConfig` → `set-constant` must make it `false`.
  - `redirect.html` loads `/ads/gpt.js` → replaced by the surrogate (`window.googletag.cmd` exists).
  - `removeparam.html` navigates with `?utm_source=x` → URL cleaned.
  - `modes.html` verifies `off`/`basic` behaviour through the popup API (messages sent
    from the extension's own page via `page.evaluate` in the popup).
- The e2e list `e2e/fixtures/test-list.txt` targets `127.0.0.1` paths and is compiled
  into the `e2e-test` ruleset only when `IUB_E2E=1`.
- Popup/dashboard smoke tests open `chrome-extension://<id>/popup.html` and assert the
  mode selector round‑trips through storage.

## Manual checklist (release)

`docs/MANUAL-QA.md` (kept short): top 20 sites by region, YouTube (with/without
uBO filters), a news site with anti‑adblock, a site with cookie banners, and a
false‑positive check on a banking site with `basic` mode.
