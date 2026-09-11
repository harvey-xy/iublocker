import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'scorecardresearch_beacon.js',
  args: [],
  redirectResource: 'scorecardresearch_beacon.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      gt._comscore = gt._comscore ?? [];
      if (typeof gt._comscore.push !== 'function') gt._comscore.push = noop;
      const comscore: any = {
        purge: function () {
          try {
            gt._comscore = [];
          } catch {
            /* already gone */
          }
        },
        beacon: noop,
      };
      gt.COMSCORE = comscore;
      gt.__comscore = comscore;
      gt.ns_ = gt.ns_ ?? { _default: noop };
    } catch {
      /* never throw into the page */
    }
  },
});
