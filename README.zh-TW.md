# iuBlocker

一個開源、原生 Manifest V3 的 Chrome 內容攔截器。目標是在 Google 目前實際發佈的 Chrome 上，提供
uBlock Origin 等級（甚至更好）的廣告與追蹤攔截效果。

[English README](README.md)

## 為什麼需要 iuBlocker？

Chrome 已經停止支援 Manifest V2 擴充功能，原版 uBlock Origin 在新版 Chrome 上無法再啟用。
iuBlocker 從零開始以 MV3 架構設計，保留 uBlock Origin 最重要的能力，並加入 MV3 才做得到的改進：

- **網路層攔截**：以 `declarativeNetRequest` 執行 EasyList、EasyPrivacy、uBO filters 等清單，
  編譯器會去重、合併網域，充分利用 330,000 條靜態規則的預算。
- **差異化更新**：不需重新發佈擴充功能即可更新過濾清單（動態規則 + `updateStaticRules`），
  這是 uBO Lite 做不到的。
- **特定 / 通用 / 程序式（procedural）外觀過濾**：`##`、`#@#`、`#?#`、`:has-text()`、`:matches-css()` 等。
- **Scriptlets**：`##+js(...)`，在 MAIN world、`document_start` 時機注入，預先依網域註冊。
- **`$redirect`、`$removeparam`、`$csp`、`$removeheader`、`$header`** 皆對應到 DNR 的能力。
- **自訂過濾規則**：在瀏覽器內編譯為動態規則與外觀過濾資料庫。
- **元素選取器（Element picker）**、**每站四種攔截模式**、**一鍵停用**。
- **零遙測、零遠端程式碼**：所有程式碼皆隨擴充功能打包，清單只是資料。

## 開發版安裝

需求：Node.js ≥ 22、pnpm ≥ 10、Chrome / Chromium ≥ 128。

```bash
git clone https://github.com/harvey-xy/iublocker.git
cd iublocker
pnpm install
pnpm rulesets:fetch      # 下載過濾清單到 .cache/lists
pnpm rulesets:build      # 編譯為 packages/extension/dist/rulesets
pnpm build               # 建置擴充功能到 packages/extension/dist
```

開啟 `chrome://extensions`，啟用「開發人員模式」，點「載入未封裝項目」，選擇 `packages/extension/dist`。

## 文件

所有設計文件在 [`docs/`](docs/)，請從 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 開始；
工作拆分請見 [`docs/TASKS.md`](docs/TASKS.md)。

## 授權

GPL‑3.0‑or‑later。過濾清單版權屬各清單維護者所有。
