import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'amazon_ads.js',
  args: [],
  redirectResource: 'amazon_ads.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      const noopStr = function () {
        return '';
      };
      const noopArray = function () {
        return [];
      };
      gt.amznads = {
        appendScriptTag: noop,
        appendTargetingToAdServerUrl: noop,
        appendTargetingToQueryString: noop,
        clearTargetingFromGPTAsync: noop,
        doAllTasks: noop,
        doGetAdsAsync: noop,
        doTask: noop,
        detectIframeAndGetURL: noopStr,
        getAds: noop,
        getAdsAsync: noop,
        getAdForSlot: noop,
        getAdsCallback: noop,
        getDisplayAds: noop,
        getDisplayAdsAsync: noop,
        getDisplayAdsCallback: noop,
        getKeys: noopArray,
        getReferrerURL: noopStr,
        getScriptSource: noopStr,
        getTargeting: noopArray,
        getTokens: noopArray,
        getValidMilliseconds: function () {
          return 0;
        },
        getVideoAds: noop,
        getVideoAdsAsync: noop,
        getVideoAdsCallback: noop,
        handleCallBack: noop,
        hasAds: function () {
          return false;
        },
        renderAd: noop,
        saveAds: noop,
        setTargeting: noop,
        setTargetingForGPTAsync: noop,
        setTargetingForGPTSync: noop,
        tryGetAdsAsync: noop,
        updateAds: noop,
      };
      gt.amzn_ads = function () {
        /* noop */
      };
      gt.aax_write = noop;
      gt.aax_render_ad = noop;
      const apstag: any = {
        _Q: [],
        init: noop,
        fetchBids: function (_cfg: any, cb: any) {
          try {
            if (typeof cb === 'function') cb([]);
          } catch {
            /* the page's own callback threw */
          }
        },
        setDisplayBids: noop,
        targetingKeys: noopArray,
        renderImp: noop,
        rpa: noop,
        upa: noop,
        dpa: noop,
      };
      gt.apstag = apstag;
    } catch {
      /* never throw into the page */
    }
  },
});
