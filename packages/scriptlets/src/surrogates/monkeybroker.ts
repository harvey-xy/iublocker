import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'monkeybroker.js',
  args: [],
  redirectResource: 'monkeybroker.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      // The real script injects overlay ads; a callable no-op is all pages need.
      gt.mbr = gt.mbr ?? { init: noop, start: noop, stop: noop };
      gt.monkeyBroker = gt.monkeyBroker ?? noop;
      gt.MonkeyBroker = gt.MonkeyBroker ?? noop;
    } catch {
      /* never throw into the page */
    }
  },
});
