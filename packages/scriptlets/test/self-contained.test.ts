import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { serializeScriptletFn } from '../src/_define';
import { registry } from '../src/index';

/**
 * Every `fn` is serialised and injected into a page that knows nothing about this
 * package, so it must not reference a single identifier from module scope.
 *
 * The check builds each scriptlet inside an isolated jsdom realm whose scope chain is a
 * `with` over a Proxy: the `has` trap claims every name, so *all* free identifiers are
 * resolved through the `get` trap, which records the ones the page does not actually
 * have. Recording (rather than throwing) is what makes this work — the scriptlets wrap
 * themselves in `try {} catch {}`, which would swallow a ReferenceError.
 */
describe('scriptlet bodies are self-contained', () => {
  const moduleScope = ['defineScriptlet', 'serializeScriptletFn', 'registry', 'redirectResources'];
  const runnerLocals = ['__iubSandbox__', '__iubArgs__'];

  for (const def of Object.values(registry)) {
    it(`${def.name} reads no unknown globals`, () => {
      const source = serializeScriptletFn(def.fn, def.name);
      for (const name of moduleScope) {
        expect(source).not.toMatch(new RegExp(`\\b${name}\\b`));
      }
      const dom = new JSDOM(
        '<!doctype html><html><body><div id="a" class="b" data-x="1">text</div></body></html>',
        { url: 'https://example.com/page', runScripts: 'outside-only', pretendToBeVisual: true },
      );
      const win = dom.window as any;
      const unknown = new Set<string>();
      const sandbox = new Proxy(win, {
        has: (_target: any, key: string | symbol) => runnerLocals.includes(key as string) === false,
        get(target: any, key: string | symbol) {
          if (typeof key === 'string' && key in target === false) {
            unknown.add(key);
            return undefined;
          }
          return target[key];
        },
      });
      const runner = win.eval(
        `(function (__iubSandbox__, __iubArgs__) {
          with (__iubSandbox__) {
            return (${source}).apply(__iubSandbox__, __iubArgs__);
          }
        })`,
      );
      try {
        runner(sandbox, []);
        runner(
          sandbox,
          def.args.map(() => 'x'),
        );
        runner(
          sandbox,
          def.args.map(() => '/x/'),
        );
      } finally {
        dom.window.close();
      }
      expect([...unknown].sort()).toEqual([]);
    });
  }
});
