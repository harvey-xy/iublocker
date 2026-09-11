import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'remove-attr',
  aliases: ['ra'],
  args: [
    { name: 'attrs', doc: '`|`-separated attribute names.' },
    { name: 'selector', optional: true, doc: 'CSS selector; defaults to `[attr]` for each attribute.' },
    { name: 'behaviour', optional: true, doc: '`stay` keeps watching the DOM, `complete` waits for load.' },
  ],
  fn: function (attrs: string, selector?: string, behaviour?: string) {
    try {
      const gt: any = globalThis;
      const doc: any = typeof document !== 'undefined' ? document : undefined;
      if (doc === undefined) return;
      const names = String(attrs ?? '')
        .split(/[|,\s]+/)
        .map((a) => a.trim())
        .filter((a) => a !== '');
      if (names.length === 0) return;
      const sel =
        typeof selector === 'string' && selector !== ''
          ? selector
          : names.map((a) => '[' + a + ']').join(',');
      const flags = String(behaviour ?? '').split(/\s+/);
      const stay = flags.indexOf('stay') !== -1;
      const complete = flags.indexOf('complete') !== -1;
      const apply = (): void => {
        try {
          const list = doc.querySelectorAll(sel);
          for (let i = 0; i < list.length; i++) {
            for (const a of names) list[i].removeAttribute(a);
          }
        } catch {
          /* invalid selector */
        }
      };
      const observe = (): void => {
        if (stay === false) return;
        try {
          const mo = new gt.MutationObserver(function () {
            apply();
          });
          mo.observe(doc.documentElement ?? doc, { childList: true, subtree: true, attributes: true });
        } catch {
          /* no MutationObserver */
        }
      };
      const start = (): void => {
        apply();
        observe();
      };
      if (complete) {
        if (doc.readyState === 'complete') start();
        else gt.addEventListener('load', start, { once: true });
      } else if (doc.readyState === 'loading') {
        apply();
        doc.addEventListener('DOMContentLoaded', start, { once: true });
      } else {
        start();
      }
    } catch {
      /* never throw into the page */
    }
  },
});
