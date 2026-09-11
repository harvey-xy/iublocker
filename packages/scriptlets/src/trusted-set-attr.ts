import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-set-attr',
  args: [
    { name: 'selector', doc: 'CSS selector of the elements to change.' },
    { name: 'attr', doc: 'Attribute name.' },
    { name: 'value', optional: true, doc: 'Any literal; `$now$` and `$currentURL$` expand.' },
  ],
  trusted: true,
  fn: function (selector: string, attr: string, value?: string) {
    try {
      const gt: any = globalThis;
      const doc: any = gt.document;
      if (doc === undefined || doc === null) return;
      if (typeof selector !== 'string' || selector === '') return;
      if (typeof attr !== 'string' || attr === '') return;
      let out = typeof value === 'string' ? value : '';
      if (out === 'emptyStr' || out === "''") out = '';
      else if (out === '$currentURL$') out = String(doc.location !== undefined ? doc.location.href : '');
      else if (out === '$now$') out = String(Date.now());
      const apply = (): void => {
        try {
          const list = doc.querySelectorAll(selector);
          for (let i = 0; i < list.length; i++) {
            if (list[i].getAttribute(attr) !== out) list[i].setAttribute(attr, out);
          }
        } catch {
          /* invalid selector */
        }
      };
      const start = (): void => {
        apply();
        try {
          const mo = new gt.MutationObserver(function () {
            apply();
          });
          mo.observe(doc.documentElement ?? doc, { childList: true, subtree: true });
        } catch {
          /* no MutationObserver */
        }
      };
      if (doc.readyState === 'loading') {
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
