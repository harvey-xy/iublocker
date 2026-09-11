import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'addthis_widget.js',
  args: [],
  redirectResource: 'addthis_widget.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      const layers: any = { refresh: noop, Share: function () {
        /* noop */
      } };
      gt.addthis = {
        addEventListener: noop,
        button: noop,
        counter: noop,
        init: noop,
        layers,
        ready: noop,
        toolbox: noop,
        update: noop,
        url: '',
        user: { ready: noop },
      };
      gt.addthis_share = gt.addthis_share ?? {};
      gt.addthis_config = gt.addthis_config ?? {};
    } catch {
      /* never throw into the page */
    }
  },
});
