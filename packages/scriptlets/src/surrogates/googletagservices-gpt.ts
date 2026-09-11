import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'googletagservices_gpt.js',
  args: [],
  redirectResource: 'googletagservices_gpt.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      const noopThis = function (this: any) {
        return this;
      };
      const noopNull = function () {
        return null;
      };
      const noopArray = function () {
        return [];
      };
      const noopStr = function () {
        return '';
      };
      const gts: any = gt.googletag ?? {};
      const pendingCmds: any[] = Array.isArray(gts.cmd) ? gts.cmd.slice() : [];
      const makeSizeMappingBuilder = (): any => {
        const b: any = {};
        b.addSize = function () {
          return b;
        };
        b.build = function () {
          return [];
        };
        return b;
      };
      const makeSlot = (path: string, id?: string): any => {
        const slot: any = {};
        const self0 = function () {
          return slot;
        };
        slot.addService = self0;
        slot.clearCategoryExclusions = self0;
        slot.clearTargeting = self0;
        slot.defineSizeMapping = self0;
        slot.setCategoryExclusion = self0;
        slot.setClickUrl = self0;
        slot.setCollapseEmptyDiv = self0;
        slot.setConfig = noop;
        slot.setForceSafeFrame = self0;
        slot.setSafeFrameConfig = self0;
        slot.setTargeting = self0;
        slot.updateTargetingFromMap = self0;
        slot.get = noopNull;
        slot.getAdUnitPath = function () {
          return path;
        };
        slot.getAttributeKeys = noopArray;
        slot.getCategoryExclusions = noopArray;
        slot.getClickUrl = noopStr;
        slot.getCollapseEmptyDiv = function () {
          return false;
        };
        slot.getContentUrl = noopStr;
        slot.getDivId = function () {
          return id ?? '';
        };
        slot.getDomId = function () {
          return id ?? '';
        };
        slot.getEscapedQemQueryId = noopStr;
        slot.getFirstLook = function () {
          return 0;
        };
        slot.getHtml = noopStr;
        slot.getName = function () {
          return path;
        };
        slot.getOutOfPage = function () {
          return false;
        };
        slot.getResponseInformation = noopNull;
        slot.getServices = noopArray;
        slot.getSizes = noopArray;
        slot.getSlotElementId = function () {
          return id ?? '';
        };
        slot.getSlotId = self0;
        slot.getTargeting = noopArray;
        slot.getTargetingKeys = noopArray;
        slot.getTargetingMap = function () {
          return {};
        };
        return slot;
      };
      const pubads: any = {};
      pubads.addEventListener = noopThis;
      pubads.removeEventListener = noopThis;
      pubads.clear = noop;
      pubads.clearCategoryExclusions = noopThis;
      pubads.clearTagForChildDirectedTreatment = noopThis;
      pubads.clearTargeting = noopThis;
      pubads.collapseEmptyDivs = function () {
        return false;
      };
      pubads.defineOutOfPagePassback = function () {
        return makeSlot('');
      };
      pubads.definePassback = function () {
        return makeSlot('');
      };
      pubads.disableInitialLoad = noop;
      pubads.display = noop;
      pubads.enableAsyncRendering = noop;
      pubads.enableLazyLoad = noop;
      pubads.enableSingleRequest = noop;
      pubads.enableSyncRendering = noop;
      pubads.enableVideoAds = noop;
      pubads.get = noopNull;
      pubads.getAttributeKeys = noopArray;
      pubads.getCorrelator = function () {
        return '';
      };
      pubads.getImaContent = function () {
        return {};
      };
      pubads.getSlotIdMap = function () {
        return {};
      };
      pubads.getSlots = noopArray;
      pubads.getTagSessionCorrelator = function () {
        return 0;
      };
      pubads.getTargeting = noopArray;
      pubads.getTargetingKeys = noopArray;
      pubads.getVideoContent = function () {
        return {};
      };
      pubads.isInitialLoadDisabled = function () {
        return true;
      };
      pubads.isSRA = function () {
        return false;
      };
      pubads.refresh = noop;
      pubads.set = noopThis;
      pubads.setCategoryExclusion = noopThis;
      pubads.setCentering = noop;
      pubads.setConfig = noop;
      pubads.setCookieOptions = noopThis;
      pubads.setForceSafeFrame = noopThis;
      pubads.setImaContent = noopThis;
      pubads.setLocation = noopThis;
      pubads.setPrivacySettings = noopThis;
      pubads.setPublisherProvidedId = noopThis;
      pubads.setRequestNonPersonalizedAds = noopThis;
      pubads.setSafeFrameConfig = noopThis;
      pubads.setTagForChildDirectedTreatment = noopThis;
      pubads.setTargeting = noopThis;
      pubads.setVideoContent = noopThis;
      pubads.updateCorrelator = noop;
      const companion: any = {
        addEventListener: noopThis,
        removeEventListener: noopThis,
        enableSyncLoading: noop,
        setRefreshUnfilledSlots: noop,
        getDisplayAdsCorrelator: noopStr,
      };
      const content: any = { addEventListener: noopThis, removeEventListener: noopThis, setContent: noop };
      const api: any = gts;
      api.apiReady = true;
      api.pubadsReady = true;
      api.cmd = pendingCmds;
      api.defineSlot = function (path: string, _sizes?: any, id?: string) {
        return makeSlot(String(path ?? ''), id);
      };
      api.defineOutOfPageSlot = function (path: string, id?: string) {
        return makeSlot(String(path ?? ''), typeof id === 'string' ? id : '');
      };
      api.defineUnit = api.defineSlot;
      api.destroySlots = noop;
      api.disablePublisherConsole = noop;
      api.display = function (arg: any) {
        try {
          const doc: any = typeof document !== 'undefined' ? document : undefined;
          if (doc === undefined) return;
          const id =
            typeof arg === 'string' ? arg : arg && arg.getSlotElementId ? arg.getSlotElementId() : '';
          const el = id === '' ? null : doc.getElementById(id);
          if (el !== null && el !== undefined) el.innerHTML = '';
        } catch {
          /* nothing to clear */
        }
      };
      api.enableServices = noop;
      api.getVersion = function () {
        return '0';
      };
      api.pubads = function () {
        return pubads;
      };
      api.companionAds = function () {
        return companion;
      };
      api.content = function () {
        return content;
      };
      api.setAdIframeTitle = noop;
      api.setConfig = noop;
      api.sizeMapping = makeSizeMappingBuilder;
      api.secureSignalProviders = api.secureSignalProviders ?? [];
      api.enums = { OutOfPageFormat: {}, TrafficSource: {} };
      gt.googletag = api;
      // Run whatever the page queued, then make cmd execute immediately.
      const run = (fn: any): number => {
        try {
          if (typeof fn === 'function') fn.call(api);
        } catch {
          /* the page's own callback threw */
        }
        return 1;
      };
      for (const fn of pendingCmds) run(fn);
      api.cmd = { push: run };
      (api.cmd as any).length = 0;
    } catch {
      /* never throw into the page */
    }
  },
});
