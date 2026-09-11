import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-create-html',
  args: [
    { name: 'parentSelector', doc: 'CSS selector (or bare tag name) of the element to append to.' },
    { name: 'html', doc: 'HTML fragment to insert.' },
    { name: 'durationMs', optional: true, doc: 'Remove the fragment again after this many ms.' },
    { name: 'extra', optional: true, doc: 'Accepted for uBO compatibility; ignored.' },
  ],
  trusted: true,
  fn: function (parentSelector: string, html: string, durationMs?: string, _extra?: string) {
    try {
      const gt: any = globalThis;
      const doc: any = gt.document;
      if (doc === undefined || doc === null) return;
      if (typeof parentSelector !== 'string' || parentSelector.trim() === '') return;
      if (typeof html !== 'string' || html === '') return;
      const sel = parentSelector.trim();
      const duration = (() => {
        const n = parseInt(String(durationMs ?? ''), 10);
        return isNaN(n) || n <= 0 ? 0 : n;
      })();
      const MARK = 'data-iub-created';
      const insert = (parent: any): void => {
        try {
          if (parent === null || parent === undefined) return;
          if (parent.getAttribute !== undefined && parent.getAttribute(MARK) !== null) return;
          const template = doc.createElement('template');
          template.innerHTML = html;
          const fragment = template.content;
          if (fragment === undefined || fragment === null) return;
          // Import first: `importNode` copies, so the nodes to remove later are the copies.
          const imported = doc.importNode(fragment, true);
          const added: any[] = [];
          for (let i = 0; i < imported.childNodes.length; i++) added.push(imported.childNodes[i]);
          parent.appendChild(imported);
          if (parent.setAttribute !== undefined) parent.setAttribute(MARK, '1');
          if (duration > 0) {
            gt.setTimeout(function () {
              for (const node of added) {
                try {
                  if (node.remove !== undefined) node.remove();
                } catch {
                  /* already gone */
                }
              }
            }, duration);
          }
        } catch {
          /* malformed HTML */
        }
      };
      const apply = (): boolean => {
        try {
          const list = doc.querySelectorAll(sel);
          if (list.length === 0) return false;
          for (let i = 0; i < list.length; i++) insert(list[i]);
          return true;
        } catch {
          return false;
        }
      };
      if (apply() === false) {
        try {
          const mo = new gt.MutationObserver(function () {
            if (apply()) mo.disconnect();
          });
          mo.observe(doc.documentElement ?? doc, { childList: true, subtree: true });
        } catch {
          /* no MutationObserver */
        }
        if (doc.readyState === 'loading') {
          doc.addEventListener(
            'DOMContentLoaded',
            function () {
              apply();
            },
            { once: true },
          );
        }
      }
    } catch {
      /* never throw into the page */
    }
  },
});
