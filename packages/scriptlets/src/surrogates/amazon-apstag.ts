import { defineScriptlet } from '../_define';

/** Stub of Amazon's Publisher Services header-bidding tag (`apstag.js`). */
export default defineScriptlet({
  name: 'amazon_apstag.js',
  aliases: ['amazon-apstag.js'],
  args: [],
  redirectResource: 'amazon_apstag.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function (): void {
        /* the bidder call is inert */
      };
      const callBack = function (callback: any, value: any): void {
        if (typeof callback !== 'function') return;
        try {
          callback(value);
        } catch {
          /* the page's own callback threw */
        }
      };
      gt.apstag = {
        _Q: [],
        init: function (_config: any, callback?: any): void {
          callBack(callback, undefined);
        },
        fetchBids: function (_config: any, callback?: any): void {
          callBack(callback, []);
        },
        setDisplayBids: noop,
        targetingKeys: function (): any[] {
          return [];
        },
        thirdPartyData: {},
        punt: noop,
        rpa: noop,
        upa: noop,
        dpa: noop,
      };
    } catch {
      /* never throw into the page */
    }
  },
});
