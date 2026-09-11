import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'google-analytics_ga.js',
  args: [],
  redirectResource: 'google-analytics_ga.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      // Classic ga.js: _gaq is a queue of command arrays.
      const gaq: any = {
        push: function (...args: any[]) {
          try {
            for (const cmd of args) {
              if (typeof cmd === 'function') cmd();
              else if (Array.isArray(cmd) && cmd[0] === '_link' && typeof cmd[1] === 'string') {
                if (gt.location !== undefined) gt.location.assign(cmd[1]);
              }
            }
          } catch {
            /* the page's own callback threw */
          }
          return 0;
        },
      };
      const existing: any = gt._gaq;
      gt._gaq = gaq;
      if (Array.isArray(existing)) gaq.push(...existing);
      const tracker: any = {
        _addIgnoredOrganic: noop,
        _addIgnoredRef: noop,
        _addItem: noop,
        _addOrganic: noop,
        _addTrans: noop,
        _clearIgnoredOrganic: noop,
        _clearIgnoredRef: noop,
        _clearOrganic: noop,
        _cookiePathCopy: noop,
        _deleteCustomVar: noop,
        _getName: function () {
          return '';
        },
        _setAccount: noop,
        _getAccount: function () {
          return '';
        },
        _getClientInfo: function () {
          return true;
        },
        _getDetectFlash: function () {
          return true;
        },
        _getDetectTitle: function () {
          return true;
        },
        _getLinkerUrl: function (url: string) {
          return url;
        },
        _getLocalGifPath: function () {
          return '';
        },
        _getServiceMode: function () {
          return 1;
        },
        _getVersion: function () {
          return '5.7.0';
        },
        _getVisitorCustomVar: noop,
        _initData: noop,
        _link: noop,
        _linkByPost: noop,
        _setAllowAnchor: noop,
        _setAllowHash: noop,
        _setAllowLinker: noop,
        _setCampContentKey: noop,
        _setCampMediumKey: noop,
        _setCampNameKey: noop,
        _setCampNOKey: noop,
        _setCampSourceKey: noop,
        _setCampTermKey: noop,
        _setCampaignCookieTimeout: noop,
        _setCampaignTrack: noop,
        _setClientInfo: noop,
        _setCookiePath: noop,
        _setCookiePersistence: noop,
        _setCookieTimeout: noop,
        _setCustomVar: noop,
        _setDetectFlash: noop,
        _setDetectTitle: noop,
        _setDomainName: noop,
        _setLocalGifPath: noop,
        _setLocalRemoteServerMode: noop,
        _setLocalServerMode: noop,
        _setReferrerOverride: noop,
        _setRemoteServerMode: noop,
        _setSampleRate: noop,
        _setSessionTimeout: noop,
        _setSiteSpeedSampleRate: noop,
        _setSessionCookieTimeout: noop,
        _setVar: noop,
        _setVisitorCookieTimeout: noop,
        _trackEvent: noop,
        _trackPageLoadTime: noop,
        _trackPageview: noop,
        _trackSocial: noop,
        _trackTiming: noop,
        _trackTrans: noop,
        _visitCode: function () {
          return '';
        },
      };
      gt._gat = {
        _anonymizeIP: noop,
        _createTracker: function () {
          return tracker;
        },
        _forceSSL: noop,
        _getTracker: function () {
          return tracker;
        },
        _getTrackerByName: function () {
          return tracker;
        },
        _getTrackers: function () {
            return [];
        },
        aa: noop,
        ab: noop,
        hb: noop,
        la: noop,
        oa: noop,
        pa: noop,
        u: noop,
      };
    } catch {
      /* never throw into the page */
    }
  },
});
