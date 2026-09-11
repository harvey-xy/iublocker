import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'chartbeat.js',
  args: [],
  redirectResource: 'chartbeat.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      const superfly: any = {
        activity: noop,
        virtualPage: noop,
        newPage: noop,
        stopVideo: noop,
        startVideo: noop,
        pauseVideo: noop,
        resumeVideo: noop,
        trackEvent: noop,
        config: {},
      };
      gt.pSUPERFLY = superfly;
      gt.pSUPERFLY_JS = superfly;
      gt._sf_async_config = gt._sf_async_config ?? {};
      gt._cbq = gt._cbq ?? [];
      if (typeof gt._cbq.push !== 'function') gt._cbq.push = noop;
      gt.pStat = gt.pStat ?? noop;
    } catch {
      /* never throw into the page */
    }
  },
});
