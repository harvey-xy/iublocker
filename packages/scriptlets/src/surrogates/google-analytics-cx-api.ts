import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'google-analytics_cx_api.js',
  args: [],
  redirectResource: 'google-analytics_cx_api.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      gt.cxApi = {
        chooseVariation: function () {
          return 0;
        },
        getChosenVariation: function () {
          return 0;
        },
        setChosenVariation: noop,
        setAllowHash: noop,
        setCookiePath: noop,
        setDomainName: noop,
        setExperimentStates: noop,
      };
    } catch {
      /* never throw into the page */
    }
  },
});
