/**
 * Element-picker entry point (bundled as an IIFE to `content/picker.js`).
 *
 * The worker injects this with `scripting.executeScript` into the ISOLATED world of
 * the top frame; injecting it again tears the previous instance down first.
 */

import { ElementPicker } from './picker-ui';

type PickerWindow = Window & { __iub_picker?: { destroy(): void } };

function main(): void {
  const win = window as PickerWindow;
  win.__iub_picker?.destroy();
  const picker = new ElementPicker(win);
  win.__iub_picker = { destroy: picker.boundDestroy };
  picker.start();
}

try {
  main();
} catch {
  /* never throw into the page */
}
