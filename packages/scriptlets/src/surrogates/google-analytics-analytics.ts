import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'google-analytics_analytics.js',
  args: [],
  redirectResource: 'google-analytics_analytics.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      const tracker: any = {
        get: noop,
        set: noop,
        send: noop,
        ga: noop,
      };
      const name = typeof gt.GoogleAnalyticsObject === 'string' ? gt.GoogleAnalyticsObject : 'ga';
      const previous: any = gt[name];
      const ga: any = function (...args: any[]) {
        try {
          const a0 = args[0];
          if (typeof a0 === 'function') {
            a0(ga);
            return;
          }
          // ga('send', ..., { hitCallback }) must still call back or pages stall.
          for (const a of args) {
            if (a !== null && typeof a === 'object' && typeof a.hitCallback === 'function') {
              a.hitCallback();
              return;
            }
          }
          if (typeof args[args.length - 1] === 'function') {
            (args[args.length - 1] as any)();
          }
        } catch {
          /* the page's own callback threw */
        }
      };
      ga.create = function () {
        return tracker;
      };
      ga.getByName = function () {
        return tracker;
      };
      ga.getAll = function () {
        return [tracker];
      };
      ga.remove = noop;
      ga.loaded = true;
      ga.q = [];
      gt.GoogleAnalyticsObject = name;
      gt[name] = ga;
      // Drain whatever the page queued before the surrogate loaded.
      if (previous !== undefined && previous !== null && Array.isArray(previous.q)) {
        for (const call of previous.q) {
          try {
            ga(...call);
          } catch {
            /* the page's own callback threw */
          }
        }
      }
      gt.dataLayer = gt.dataLayer ?? [];
      if (typeof gt.dataLayer.push !== 'function') gt.dataLayer.push = noop;
    } catch {
      /* never throw into the page */
    }
  },
});
