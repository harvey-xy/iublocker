import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'prevent-refresh',
  aliases: ['refresh-defuser'],
  args: [
    {
      name: 'delay',
      optional: true,
      doc: 'New delay in seconds for `<meta http-equiv="refresh">`; absent removes the refresh entirely.',
    },
  ],
  fn: function (delay?: string) {
    try {
      const gt: any = globalThis;
      const doc: any = gt.document;
      if (doc === undefined || doc === null) return;
      const raw = typeof delay === 'string' ? delay.trim() : '';
      const seconds = raw === '' ? -1 : parseInt(raw, 10);
      const rewrite = isNaN(seconds) === false && seconds >= 0;
      const MARK = 'data-iub-refresh';
      const defuse = (meta: any): void => {
        try {
          // Marking first keeps the MutationObserver below from re-entering forever.
          if (meta.getAttribute(MARK) !== null) return;
          meta.setAttribute(MARK, '1');
          const content = String(meta.getAttribute('content') ?? '');
          if (content === '') return;
          const m = /^\s*(\d+(?:\.\d+)?)\s*(?:;(.*))?$/.exec(content);
          if (m === null) return;
          const target = (m[2] ?? '').trim();
          if (rewrite === false) {
            meta.setAttribute('content', target === '' ? '0' : String(seconds));
            meta.removeAttribute('http-equiv');
            return;
          }
          meta.setAttribute('content', target === '' ? String(seconds) : String(seconds) + ';' + target);
        } catch {
          /* node went away */
        }
      };
      const scan = (): void => {
        try {
          const list = doc.querySelectorAll('meta[http-equiv]');
          for (let i = 0; i < list.length; i++) {
            const el = list[i];
            if (String(el.getAttribute('http-equiv') ?? '').toLowerCase() !== 'refresh') continue;
            defuse(el);
          }
        } catch {
          /* no querySelectorAll */
        }
      };
      scan();
      try {
        const mo = new gt.MutationObserver(function () {
          scan();
        });
        mo.observe(doc.documentElement ?? doc, { childList: true, subtree: true, attributes: true });
      } catch {
        /* no MutationObserver */
      }
      if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', scan, { once: true });
      }
    } catch {
      /* never throw into the page */
    }
  },
});
