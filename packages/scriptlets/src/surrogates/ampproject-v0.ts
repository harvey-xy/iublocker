import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'ampproject_v0.js',
  args: [],
  redirectResource: 'ampproject_v0.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const doc: any = typeof document !== 'undefined' ? document : undefined;
      // Without the AMP runtime the boilerplate keeps the document invisible.
      const reveal = (): void => {
        try {
          if (doc === undefined) return;
          const html = doc.documentElement;
          if (html !== null && html !== undefined) {
            html.removeAttribute('amp-boilerplate');
            if (html.classList !== undefined) html.classList.remove('i-amphtml-no-boilerplate');
            html.style.visibility = 'visible';
            html.style.opacity = '1';
            html.style.animation = 'none';
          }
          const styles = doc.querySelectorAll('style[amp-boilerplate], noscript > style[amp-boilerplate]');
          for (let i = 0; i < styles.length; i++) {
            const el = styles[i];
            if (el.parentNode !== null) el.parentNode.removeChild(el);
          }
          if (doc.body !== null && doc.body !== undefined) {
            doc.body.style.visibility = 'visible';
            doc.body.style.opacity = '1';
            doc.body.style.animation = 'none';
          }
        } catch {
          /* nothing to reveal */
        }
      };
      const push = function (fn: any): number {
        try {
          if (typeof fn === 'function') fn();
        } catch {
          /* the page's own callback threw */
        }
        return 1;
      };
      const pending: any[] = Array.isArray(gt.AMP) ? gt.AMP.slice() : [];
      gt.AMP = { push, isExperimentOn: function () {
        return false;
      } };
      for (const fn of pending) push(fn);
      gt.ampUrl = gt.ampUrl ?? '';
      reveal();
      if (doc !== undefined && doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', reveal, { once: true });
      }
    } catch {
      /* never throw into the page */
    }
  },
});
