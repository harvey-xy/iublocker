/**
 * Content-script entry point (bundled as an IIFE to `content/cosmetic.js`).
 * Registered for every frame at `document_start`; see `src/manifest.ts`.
 */

import { startEngine } from './engine';
import type { CosmeticEngine } from './engine';

type EngineWindow = Window & { __iub_cs?: CosmeticEngine | true };

function main(): void {
  const win = window as EngineWindow;
  // The script can be injected twice (pre-registered + executeScript); run once.
  if (win.__iub_cs) return;
  win.__iub_cs = true;
  void startEngine(win)
    .then((engine) => {
      if (engine) win.__iub_cs = engine;
    })
    .catch(() => {
      /* never throw into the page */
    });
}

try {
  main();
} catch {
  /* never throw into the page */
}
