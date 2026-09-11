import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'popads.js',
  // uBO lists also invoke the surrogate by its long `$redirect` spelling.
  aliases: ['popads.net.js'],
  args: [],
  redirectResource: 'popads.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      // PopAds' loader checks for these; give it inert objects and swallow its calls.
      const popns: any = {
        cocde: noop,
        adblock: false,
        aggr: 0,
        ap: noop,
        cntr: 0,
        dbg: false,
        ecpm: 0,
        hasOwnProperty: function () {
          return true;
        },
        init: noop,
        ldr: noop,
        pop: noop,
        setup: noop,
        start: noop,
        stop: noop,
      };
      try {
        Object.defineProperty(gt, 'PopAds', { value: popns, writable: true, configurable: true });
      } catch {
        gt.PopAds = popns;
      }
      try {
        Object.defineProperty(gt, 'popns', { value: popns, writable: true, configurable: true });
      } catch {
        gt.popns = popns;
      }
      gt.popMagic = gt.popMagic ?? { init: noop, open: noop, createIframe: noop, hasAdblock: false };
      gt.popunder = gt.popunder ?? noop;
    } catch {
      /* never throw into the page */
    }
  },
});
