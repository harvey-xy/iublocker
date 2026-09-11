import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'outbrain-widget.js',
  args: [],
  redirectResource: 'outbrain-widget.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      const obr: any = gt.OBR ?? {};
      obr.extern = {
        callClick: noop,
        callRecs: noop,
        callLoadMore: noop,
        callWhenServerLoaded: function (cb: any) {
          try {
            if (typeof cb === 'function') cb();
          } catch {
            /* the page's own callback threw */
          }
        },
        callUserZoneData: noop,
        researchWidget: noop,
        reloadWidget: noop,
        returnedError: noop,
        returnedHtml: noop,
        returnedIrdWidgetData: noop,
        returnedJsonpData: noop,
      };
      obr.viewedWidgets = {};
      obr.widgetRendered = noop;
      gt.OBR = obr;
      gt.OBRvi = gt.OBRvi ?? {};
      gt.outbrain = gt.outbrain ?? { reloadWidget: noop };
    } catch {
      /* never throw into the page */
    }
  },
});
