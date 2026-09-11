import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'prebid-ads.js',
  args: [],
  redirectResource: 'prebid-ads.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      const noopArray = function () {
        return [];
      };
      const pbjs: any = gt.pbjs ?? {};
      const pending: any[] = Array.isArray(pbjs.que) ? pbjs.que.slice() : [];
      pbjs.addAdUnits = noop;
      pbjs.adServers = { dfp: { buildVideoUrl: function () {
        return '';
      } } };
      pbjs.adUnits = [];
      pbjs.aliasBidder = noop;
      pbjs.bidderSettings = {};
      pbjs.clearAllAuctions = noop;
      pbjs.enableAnalytics = noop;
      pbjs.getAdserverTargeting = function () {
        return {};
      };
      pbjs.getAdserverTargetingForAdUnitCode = function () {
        return {};
      };
      pbjs.getAllPrebidWinningBids = noopArray;
      pbjs.getAllWinningBids = noopArray;
      pbjs.getBidResponses = function () {
        return {};
      };
      pbjs.getBidResponsesForAdUnitCode = function () {
        return { bids: [] };
      };
      pbjs.getConfig = function () {
        return {};
      };
      pbjs.getHighestCpmBids = noopArray;
      pbjs.getNoBids = noopArray;
      pbjs.getUserIds = function () {
        return {};
      };
      pbjs.getUserIdsAsEids = noopArray;
      pbjs.libLoaded = true;
      pbjs.markWinningBidAsUsed = noop;
      pbjs.onEvent = noop;
      pbjs.offEvent = noop;
      pbjs.removeAdUnit = noop;
      pbjs.renderAd = noop;
      pbjs.requestBids = function (req: any) {
        try {
          if (req !== null && typeof req === 'object' && typeof req.bidsBackHandler === 'function') {
            req.bidsBackHandler({}, true);
          }
        } catch {
          /* the page's own callback threw */
        }
      };
      pbjs.setBidderConfig = noop;
      pbjs.setConfig = noop;
      pbjs.setTargetingForGPTAsync = noop;
      pbjs.triggerUserSyncs = noop;
      pbjs.version = 'v0.0.0';
      const run = (fn: any): number => {
        try {
          if (typeof fn === 'function') fn();
        } catch {
          /* the page's own callback threw */
        }
        return 1;
      };
      pbjs.que = { push: run };
      pbjs.cmd = pbjs.que;
      gt.pbjs = pbjs;
      for (const fn of pending) run(fn);
    } catch {
      /* never throw into the page */
    }
  },
});
