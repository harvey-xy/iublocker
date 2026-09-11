import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'alert-buster',
  args: [],
  fn: function () {
    try {
      const gt: any = globalThis;
      const flag = '__iub_alertbuster';
      if (gt[flag] === true) return;
      gt[flag] = true;
      const noop = function (): void {
        /* swallow the dialog */
      };
      try {
        Object.defineProperty(gt, 'alert', { value: noop, configurable: true, writable: true });
      } catch {
        /* non-configurable */
      }
    } catch {
      /* never throw into the page */
    }
  },
});
