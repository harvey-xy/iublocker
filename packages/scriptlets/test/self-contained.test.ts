import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { serializeScriptletFn } from '../src/_define';
import { registry } from '../src/index';

/**
 * Every `fn` is serialised and injected into a page that knows nothing about this
 * package, so it must not reference a single identifier from module scope. The check
 * runs each scriptlet inside an isolated jsdom realm whose global object is a Proxy
 * that records reads of names the page does not have — a `try {} catch {}` inside the
 * scriptlet cannot hide those, unlike a thrown ReferenceError.
 */
describe('scriptlet bodies are self-contained', () => {
  const moduleScope = ['defineScriptlet', 'serializeScriptletFn', 'registry', 'redirectResources', 'definitions'];

  for (const def of Object.values(registry)) {
    it(`${def.name} reads no unknown globals`, () => {
      const source = serializeScriptletFn(def.fn, def.name);
      for (const name of moduleScope) {
        expect(source).not.toMatch(new RegExp(`\\b${name}\\b`));
      }
      const dom = new JSDOM('<!doctype html><html><body><div id="a" class="b" data-x="1"></div></body></html>', {
        url: 'https://example.com/page',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
      });
      const win = dom.window as any;
      const unknown = new Set<string>();
      const sandbox = new Proxy(win, {
        has: () => true,
        get(target: any, key: string | symbol) {
          if (typeof key === 'string' && key in target === false) {
            unknown.add(key);
            return undefined;
          }
          return target[key];
        },
      });
      const runner = win.eval(
        '(function (sandbox, src, args) { with (sandbox) { return eval(src).apply(sandbox, args); } })',
      );
      try {
        runner(sandbox, `(${source})`, []);
        runner(sandbox, `(${source})`, def.args.map(() => 'x'));
        runner(sandbox, `(${source})`, def.args.map(() => '/x/'));
      } finally {
        dom.window.close();
      }
      expect([...unknown]).toEqual([]);
    });
  }
});
