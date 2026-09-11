/**
 * Test harness: inject a scriptlet the way the extension does — by serialising the
 * function and evaluating it inside a fresh page realm (docs/TESTING.md, "scriptlets").
 */
import { JSDOM } from 'jsdom';
import type { ScriptletDefinition } from '../src/_define';
import { serializeScriptletFn } from '../src/_define';

export interface PageWindow {
  [key: string]: any;
}

export function makeWindow(
  html = '<!doctype html><html><head></head><body></body></html>',
  url = 'https://example.com/page',
): PageWindow {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  return dom.window as unknown as PageWindow;
}

/** Evaluate `def.fn` in the page realm and call it with `args`, exactly as the injector does. */
export function inject(win: PageWindow, def: ScriptletDefinition, ...args: (string | undefined)[]): void {
  const source = serializeScriptletFn(def.fn, def.name);
  const fn = win.eval(`(${source})`);
  fn.apply(win, args);
}

/** Let jsdom's timers, microtasks and MutationObserver callbacks run. */
export function tick(win: PageWindow, ms = 5): Promise<void> {
  return new Promise((resolve) => {
    win.setTimeout(resolve, ms);
  });
}
