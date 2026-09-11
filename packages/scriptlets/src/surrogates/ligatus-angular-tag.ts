import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'ligatus_angular-tag.js',
  args: [],
  redirectResource: 'ligatus_angular-tag.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      gt.ligatus = gt.ligatus ?? { init: noop, render: noop, load: noop };
      gt.lgt = gt.lgt ?? noop;
    } catch {
      /* never throw into the page */
    }
  },
});
