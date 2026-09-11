import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'nobab.js',
  args: [],
  redirectResource: 'nobab.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const doc: any = typeof document !== 'undefined' ? document : undefined;
      const noop = function () {
        /* noop */
      };
      // BlockAdBlock (bab) builds its bait element from a signature; keep it happy.
      const babStub: any = {
        check: noop,
        on: noop,
        onDetected: noop,
        onNotDetected: function (cb: any) {
          try {
            if (typeof cb === 'function') cb();
          } catch {
            /* the page's own callback threw */
          }
          return babStub;
        },
        setOption: noop,
      };
      for (const name of ['babasbmsgs', 'babAsyncInit', 'bmak']) {
        try {
          gt[name] = gt[name] ?? noop;
        } catch {
          /* read-only global */
        }
      }
      gt.blockAdBlock = babStub;
      gt.BlockAdBlock = function () {
        return babStub;
      };
      // Remove the bait/overlay elements bab injects, now and on DOM ready.
      const clean = (): void => {
        try {
          if (doc === undefined) return;
          const list = doc.querySelectorAll('[id^="babasbmsgs"], [class^="babasbm"]');
          for (let i = 0; i < list.length; i++) {
            const el = list[i];
            if (el.parentNode !== null) el.parentNode.removeChild(el);
          }
        } catch {
          /* nothing to clean */
        }
      };
      clean();
      if (doc !== undefined && doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', clean, { once: true });
      }
    } catch {
      /* never throw into the page */
    }
  },
});
