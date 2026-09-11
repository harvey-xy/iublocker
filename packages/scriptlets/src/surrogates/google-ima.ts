import { defineScriptlet } from '../_define';

/**
 * Stub of Google's Interactive Media Ads SDK (IMA3).
 *
 * Video players built on IMA stall on a black frame when `ima3.js` is merely blocked:
 * they wait for an `AdsManager` that never arrives. This stub answers the whole handshake
 * — container, loader, manager — and immediately reports "all ads completed" so the player
 * resumes the content stream.
 */
export default defineScriptlet({
  name: 'google-ima.js',
  aliases: ['google-ima3', 'google-ima'],
  args: [],
  redirectResource: 'google-ima.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      if (gt.google !== undefined && gt.google !== null && gt.google.ima !== undefined) return;
      const noop = function (): void {
        /* the SDK call is inert */
      };

      /** Minimal EventTarget the SDK exposes on loaders and managers. */
      const makeEmitter = (target: any): any => {
        const listeners: Record<string, any[]> = {};
        target.addEventListener = function (type: any, handler: any, _context?: any): void {
          const key = String(type);
          if (typeof handler !== 'function' && (handler === null || typeof handler !== 'object')) return;
          (listeners[key] = listeners[key] ?? []).push(handler);
        };
        target.removeEventListener = function (type: any, handler: any): void {
          const list = listeners[String(type)];
          if (list === undefined) return;
          const i = list.indexOf(handler);
          if (i !== -1) list.splice(i, 1);
        };
        target._dispatch = function (event: any): void {
          const list = listeners[String(event.type)];
          if (list === undefined) return;
          for (const handler of list.slice()) {
            try {
              if (typeof handler === 'function') handler.call(target, event);
              else if (typeof handler.handleEvent === 'function') handler.handleEvent(event);
            } catch {
              /* the page's own handler threw */
            }
          }
        };
        return target;
      };

      const AdEventType: Record<string, string> = {
        AD_BREAK_READY: 'adBreakReady',
        AD_BUFFERING: 'adBuffering',
        AD_CAN_PLAY: 'adCanPlay',
        AD_METADATA: 'adMetadata',
        AD_PROGRESS: 'adProgress',
        ALL_ADS_COMPLETED: 'allAdsCompleted',
        CLICK: 'click',
        COMPLETE: 'complete',
        CONTENT_PAUSE_REQUESTED: 'contentPauseRequested',
        CONTENT_RESUME_REQUESTED: 'contentResumeRequested',
        DURATION_CHANGE: 'durationChange',
        EXPANDED_CHANGED: 'expandedChanged',
        FIRST_QUARTILE: 'firstQuartile',
        IMPRESSION: 'impression',
        INTERACTION: 'interaction',
        LINEAR_CHANGE: 'linearChange',
        LINEAR_CHANGED: 'linearChanged',
        LOADED: 'loaded',
        LOG: 'log',
        MIDPOINT: 'midpoint',
        PAUSED: 'pause',
        RESUMED: 'resume',
        SKIPPABLE_STATE_CHANGED: 'skippableStateChanged',
        SKIPPED: 'skip',
        STARTED: 'start',
        THIRD_QUARTILE: 'thirdQuartile',
        USER_CLOSE: 'userClose',
        VIDEO_CLICKED: 'videoClicked',
        VIDEO_ICON_CLICKED: 'videoIconClicked',
        VIEWABLE_IMPRESSION: 'viewable_impression',
        VOLUME_CHANGED: 'volumeChange',
        VOLUME_MUTED: 'mute',
      };

      const AdPodInfo = function (this: any): void {
        this.getAdPosition = function (): number {
          return 1;
        };
        this.getIsBumper = function (): boolean {
          return false;
        };
        this.getMaxDuration = function (): number {
          return -1;
        };
        this.getPodIndex = function (): number {
          return 1;
        };
        this.getTimeOffset = function (): number {
          return 0;
        };
        this.getTotalAds = function (): number {
          return 1;
        };
      };

      const Ad = function (): any {
        const self: any = {};
        self.pi = new (AdPodInfo as any)();
        self.getAdId = function (): string {
          return '';
        };
        self.getAdPodInfo = function (): any {
          return self.pi;
        };
        self.getAdSystem = function (): string {
          return '';
        };
        self.getAdvertiserName = function (): string {
          return '';
        };
        self.getApiFramework = function (): any {
          return null;
        };
        self.getCompanionAds = function (): any[] {
          return [];
        };
        self.getContentType = function (): string {
          return '';
        };
        self.getCreativeAdId = function (): string {
          return '';
        };
        self.getDealId = function (): string {
          return '';
        };
        self.getDescription = function (): string {
          return '';
        };
        self.getDuration = function (): number {
          return 8.5;
        };
        self.getHeight = function (): number {
          return 0;
        };
        self.getMediaUrl = function (): any {
          return null;
        };
        self.getMinSuggestedDuration = function (): number {
          return -2;
        };
        self.getSkipTimeOffset = function (): number {
          return -1;
        };
        self.getSurveyUrl = function (): any {
          return null;
        };
        self.getTitle = function (): string {
          return '';
        };
        self.getTraffickingParameters = function (): any {
          return {};
        };
        self.getTraffickingParametersString = function (): string {
          return '';
        };
        self.getUiElements = function (): string[] {
          return [''];
        };
        self.getUniversalAdIdRegistry = function (): string {
          return 'unknown';
        };
        self.getUniversalAdIdValue = function (): string {
          return 'unknown';
        };
        self.getUniversalAdIds = function (): any[] {
          return [];
        };
        self.getVastMediaBitrate = function (): number {
          return 0;
        };
        self.getVastMediaHeight = function (): number {
          return 0;
        };
        self.getVastMediaWidth = function (): number {
          return 0;
        };
        self.getWidth = function (): number {
          return 0;
        };
        self.getWrapperAdIds = function (): string[] {
          return [''];
        };
        self.getWrapperAdSystems = function (): string[] {
          return [''];
        };
        self.getWrapperCreativeIds = function (): string[] {
          return [''];
        };
        self.isLinear = function (): boolean {
          return true;
        };
        self.isSkippable = function (): boolean {
          return true;
        };
        return self;
      };

      const AdError = function (this: any, type: any, code: any, vast: any, message: any): void {
        this.errorCode = code === undefined ? 900 : code;
        this.message = message === undefined ? 'The VAST response document is empty.' : message;
        this.type = type === undefined ? 'adPlayError' : type;
        this.vastErrorCode = vast === undefined ? 303 : vast;
        this.getErrorCode = (): any => this.errorCode;
        this.getInnerError = (): any => null;
        this.getMessage = (): any => this.message;
        this.getType = (): any => this.type;
        this.getVastErrorCode = (): any => this.vastErrorCode;
        this.toString = (): string => 'AdError ' + this.errorCode + ': ' + this.message;
      };
      (AdError as any).ErrorCode = {};
      (AdError as any).Type = {};

      const AdEvent = function (this: any, type: any): void {
        this.type = type;
        this.getAd = function (): any {
          return new (Ad as any)();
        };
        this.getAdData = function (): any {
          return {};
        };
      };
      (AdEvent as any).Type = AdEventType;

      const AdErrorEvent = function (this: any, error: any): void {
        this.type = 'adError';
        this.error = error;
        this.getError = function (): any {
          return error;
        };
        this.getUserRequestContext = function (): any {
          return {};
        };
      };
      (AdErrorEvent as any).Type = { AD_ERROR: 'adError' };

      const AdsManager = function (): any {
        const self: any = makeEmitter({});
        let volume = 1;
        self.collapse = noop;
        self.configureAdsManager = noop;
        self.destroy = noop;
        self.discardAdBreak = noop;
        self.expand = noop;
        self.focus = noop;
        self.getAdSkippableState = function (): boolean {
          return false;
        };
        self.getCuePoints = function (): number[] {
          return [0];
        };
        self.getCurrentAd = function (): any {
          return new (Ad as any)();
        };
        self.getCurrentAdCuePoints = function (): any[] {
          return [];
        };
        self.getRemainingTime = function (): number {
          return 0;
        };
        self.getVolume = function (): number {
          return volume;
        };
        self.init = noop;
        self.isCustomClickTrackingUsed = function (): boolean {
          return false;
        };
        self.isCustomPlaybackUsed = function (): boolean {
          return false;
        };
        self.pause = noop;
        self.requestNextAdBreak = noop;
        self.resize = noop;
        self.resume = noop;
        self.setVolume = function (v: any): void {
          volume = v;
        };
        self.skip = noop;
        self.stop = noop;
        self.updateAdsRenderingSettings = noop;
        // Report an empty ad break as soon as the player starts us.
        self.start = function (): void {
          for (const type of [
            AdEventType.LOADED,
            AdEventType.STARTED,
            AdEventType.CONTENT_RESUME_REQUESTED,
            AdEventType.AD_BUFFERING,
            AdEventType.ALL_ADS_COMPLETED,
          ]) {
            try {
              self._dispatch(new (AdEvent as any)(type));
            } catch {
              /* the page's own handler threw */
            }
          }
        };
        return self;
      };

      const AdsManagerLoadedEvent = function (this: any, type: any, manager: any): void {
        this.type = type;
        this.getAdsManager = function (): any {
          return manager;
        };
        this.getUserRequestContext = function (): any {
          return {};
        };
      };
      (AdsManagerLoadedEvent as any).Type = {
        ADS_MANAGER_LOADED: 'adsManagerLoaded',
      };

      const AdsLoader = function (): any {
        const self: any = makeEmitter({});
        self.contentComplete = noop;
        self.destroy = noop;
        self.getSettings = function (): any {
          return gt.google.ima.settings;
        };
        self.getVersion = function (): string {
          return '3.173.4';
        };
        self.requestAds = function (): void {
          const manager = new (AdsManager as any)();
          const event = new (AdsManagerLoadedEvent as any)('adsManagerLoaded', manager);
          const fire = function (): void {
            try {
              self._dispatch(event);
            } catch {
              /* the page's own handler threw */
            }
          };
          if (typeof gt.requestAnimationFrame === 'function') gt.requestAnimationFrame(fire);
          else gt.setTimeout(fire, 0);
        };
        self.requestStream = noop;
        return self;
      };
      (AdsLoader as any).prototype = {};

      const AdsRequest = function (this: any): void {
        this.setAdWillAutoPlay = noop;
        this.setAdWillPlayMuted = noop;
        this.setContinuousPlayback = noop;
      };
      const AdsRenderingSettings = function (this: any): void {
        this.restoreCustomPlaybackStateOnAdBreakComplete = false;
        this.enablePreloading = false;
        this.uiElements = [];
        this.loadVideoTimeout = -1;
        this.bitrate = -1;
        this.autoAlign = true;
        this.playAdsAfterTime = -1;
        this.useStyledLinearAds = false;
        this.useStyledNonLinearAds = false;
        this.disableCustomPlaybackForIOS10Plus = false;
        this.mimeTypes = null;
      };
      const AdDisplayContainer = function (this: any): void {
        this.initialize = noop;
        this.destroy = noop;
      };
      const ImaSdkSettings = function (): any {
        const self: any = {};
        self.c = true;
        self.f = {};
        self.i = false;
        self.l = '';
        self.p = '';
        self.r = 0;
        self.t = '';
        self.v = '';
        self.getCompanionBackfill = noop;
        self.getDisableCustomPlaybackForIOS10Plus = function (): boolean {
          return self.i;
        };
        self.getFeatureFlags = function (): any {
          return self.f;
        };
        self.getLocale = function (): string {
          return self.l;
        };
        self.getNumRedirects = function (): number {
          return self.r;
        };
        self.getPlayerType = function (): string {
          return self.t;
        };
        self.getPlayerVersion = function (): string {
          return self.v;
        };
        self.getPpid = function (): string {
          return self.p;
        };
        self.isCookiesEnabled = function (): boolean {
          return self.c;
        };
        self.isVpaidAdapter = function (): boolean {
          return false;
        };
        self.setAutoPlayAdBreaks = noop;
        self.setCompanionBackfill = noop;
        self.setCookiesEnabled = function (v: any): void {
          self.c = Boolean(v);
        };
        self.setDisableCustomPlaybackForIOS10Plus = function (v: any): void {
          self.i = Boolean(v);
        };
        self.setFeatureFlags = function (v: any): void {
          self.f = v;
        };
        self.setLocale = function (v: any): void {
          self.l = String(v);
        };
        self.setNumRedirects = function (v: any): void {
          self.r = Number(v);
        };
        self.setPlayerType = function (v: any): void {
          self.t = String(v);
        };
        self.setPlayerVersion = function (v: any): void {
          self.v = String(v);
        };
        self.setPpid = function (v: any): void {
          self.p = String(v);
        };
        self.setSessionId = noop;
        self.setVpaidAllowed = noop;
        self.setVpaidMode = noop;
        return self;
      };
      (ImaSdkSettings as any).CompanionBackfillMode = { ALWAYS: 'always', ON_MASTER_AD: 'on_master_ad' };
      (ImaSdkSettings as any).VpaidMode = { DISABLED: 0, ENABLED: 1, INSECURE: 2 };

      const ima: any = {
        AdCuePoints: function (this: any): void {
          this.start = 0;
          this.end = 0;
        },
        AdDisplayContainer,
        AdError,
        AdErrorEvent,
        AdEvent,
        AdPodInfo,
        AdsLoader,
        AdsManager: new (AdsManager as any)(),
        AdsManagerLoadedEvent,
        AdsRenderingSettings,
        AdsRequest,
        CompanionAdSelectionSettings: function (): void {
          /* no companion ads are ever selected */
        },
        CompanionAd: function (this: any): void {
          this.getAdSlotId = function (): string {
            return '';
          };
          this.getContent = function (): string {
            return '';
          };
          this.getContentType = function (): string {
            return '';
          };
          this.getHeight = function (): number {
            return 1;
          };
          this.getWidth = function (): number {
            return 1;
          };
        },
        ImaSdkSettings,
        OmidAccessMode: { DOMAIN: 'domain', FULL: 'full', LIMITED: 'limited' },
        OmidVerificationVendor: {
          1: 'OTHER',
          2: 'MOAT',
          3: 'DOUBLEVERIFY',
          4: 'INTEGRAL_AD_SCIENCE',
          5: 'PIXELATE',
          6: 'NIELSEN',
          7: 'COMSCORE',
          8: 'MEETRICS',
          9: 'GOOGLE',
          OTHER: 1,
          MOAT: 2,
          DOUBLEVERIFY: 3,
          INTEGRAL_AD_SCIENCE: 4,
          PIXELATE: 5,
          NIELSEN: 6,
          COMSCORE: 7,
          MEETRICS: 8,
          GOOGLE: 9,
        },
        UiElements: { AD_ATTRIBUTION: 'adAttribution', COUNTDOWN: 'countdown' },
        VERSION: '3.173.4',
        ViewMode: { FULLSCREEN: 'fullscreen', NORMAL: 'normal' },
        settings: new (ImaSdkSettings as any)(),
      };
      ima.dai = {
        AdBreakEvent: { Type: {} },
        StreamEvent: { Type: {} },
        StreamManager: function (): any {
          const self: any = makeEmitter({});
          self.contentTimeForStreamTime = noop;
          self.loadStreamMetadata = noop;
          self.onTimedMetadata = noop;
          self.previousCuePointForStreamTime = noop;
          self.processMetadata = noop;
          self.replaceAdTagParameters = noop;
          self.requestStream = noop;
          self.reset = noop;
          self.setClickElement = noop;
          self.streamTimeForContentTime = noop;
          return self;
        },
        StreamRequest: function (this: any): void {
          this.adTagParameters = {};
          this.apiKey = '';
          this.assetKey = '';
          this.authToken = '';
          this.contentSourceId = '';
          this.format = 'hls';
          this.streamActivityMonitorId = '';
          this.videoId = '';
        },
      };

      const google = gt.google ?? {};
      google.ima = ima;
      gt.google = google;
    } catch {
      /* never throw into the page */
    }
  },
});
