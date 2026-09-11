import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'googlesyndication_adsbygoogle.js',
  args: [],
  redirectResource: 'googlesyndication_adsbygoogle.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const doc: any = typeof document !== 'undefined' ? document : undefined;
      const markSlots = (): void => {
        try {
          if (doc === undefined) return;
          const list = doc.querySelectorAll('.adsbygoogle');
          for (let i = 0; i < list.length; i++) {
            const el = list[i];
            if (el.getAttribute('data-adsbygoogle-status') === 'done') continue;
            el.setAttribute('data-adsbygoogle-status', 'done');
            el.setAttribute('data-ad-status', 'unfilled');
            const frame = doc.createElement('iframe');
            frame.style.cssText = 'display:none!important;';
            frame.setAttribute('aria-hidden', 'true');
            el.appendChild(frame);
          }
        } catch {
          /* DOM not ready */
        }
      };
      const existing: any = gt.adsbygoogle;
      const queue: any = {
        loaded: true,
        push: function (item: any) {
          try {
            markSlots();
            if (item !== null && typeof item === 'object') {
              if (typeof item.onload === 'function') item.onload();
              if (typeof item.google_ad_client === 'string') gt.google_ad_client = item.google_ad_client;
            }
          } catch {
            /* the page's own callback threw */
          }
          return 1;
        },
      };
      gt.adsbygoogle = queue;
      if (Array.isArray(existing)) {
        for (const item of existing) queue.push(item);
      }
      gt.google_ad_status = 1;
      markSlots();
      if (doc !== undefined && doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', markSlots, { once: true });
      }
    } catch {
      /* never throw into the page */
    }
  },
});
