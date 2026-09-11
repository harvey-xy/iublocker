import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'googletagmanager_gtm.js',
  args: [],
  redirectResource: 'googletagmanager_gtm.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const doc: any = typeof document !== 'undefined' ? document : undefined;
      const noop = function () {
        /* noop */
      };
      // GTM hides the page behind `.async-hide` until it "loads"; undo that.
      const unhide = (): void => {
        try {
          if (doc === undefined) return;
          const el = doc.documentElement;
          if (el !== null && el !== undefined && el.classList !== undefined) el.classList.remove('async-hide');
          const style = doc.getElementById('gtm-hide');
          if (style !== null && style !== undefined && style.parentNode !== null) style.parentNode.removeChild(style);
        } catch {
          /* nothing to unhide */
        }
      };
      const dl: any = Array.isArray(gt.dataLayer) ? gt.dataLayer : [];
      const runCallbacks = (item: any): void => {
        try {
          if (item === null || typeof item !== 'object') return;
          if (typeof item.eventCallback === 'function') item.eventCallback();
          if (typeof item['gtm.start'] === 'number') unhide();
        } catch {
          /* the page's own callback threw */
        }
      };
      for (const item of dl) runCallbacks(item);
      const queue: any = {
        push: function (...items: any[]) {
          for (const item of items) {
            try {
              (dl as any[]).push(item);
            } catch {
              /* array grew unexpectedly */
            }
            runCallbacks(item);
          }
          return dl.length;
        },
      };
      // Keep array semantics the page may rely on (length, indexing, forEach…).
      try {
        Object.defineProperty(dl, 'push', { value: queue.push, writable: true, configurable: true });
        gt.dataLayer = dl;
      } catch {
        gt.dataLayer = queue;
      }
      gt.google_tag_manager = gt.google_tag_manager ?? {};
      gt.google_tag_data = gt.google_tag_data ?? {};
      gt.gtag =
        typeof gt.gtag === 'function'
          ? gt.gtag
          : function (...args: any[]) {
              try {
                const last = args[args.length - 1];
                if (last !== null && typeof last === 'object' && typeof last.event_callback === 'function') {
                  last.event_callback();
                }
              } catch {
                /* the page's own callback threw */
              }
            };
      if (typeof gt.gtm !== 'object') gt.gtm = { start: noop };
      unhide();
      if (doc !== undefined && doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', unhide, { once: true });
      }
    } catch {
      /* never throw into the page */
    }
  },
});
