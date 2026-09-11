import { defineScriptlet } from '../_define';

/** Stub of AT Internet's SmartTag analytics library. */
export default defineScriptlet({
  name: 'ati-smarttag.js',
  aliases: ['ati-smarttag'],
  args: [],
  redirectResource: 'ati-smarttag.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function (): void {
        /* the tracker call is inert */
      };
      const makeTag = function (): any {
        const self: any = {};
        const section: any = {
          set: noop,
          send: noop,
          add: noop,
          remove: noop,
          removeAll: noop,
          get: function (): any {
            return {};
          },
          list: function (): any[] {
            return [];
          },
        };
        for (const name of [
          'article',
          'aisle',
          'avInsights',
          'campaign',
          'cart',
          'click',
          'clickListener',
          'customObjects',
          'customVars',
          'dispatch',
          'ecommerce',
          'event',
          'events',
          'identifiedVisitor',
          'internalSearch',
          'ilv',
          'link',
          'mvTesting',
          'newCustomerId',
          'order',
          'page',
          'pageBoard',
          'panel',
          'privacy',
          'product',
          'productImpression',
          'publisher',
          'richMedia',
          'selfPromotion',
          'setEnv',
          'tandem',
          'utils',
        ]) {
          self[name] = section;
        }
        self.setConfig = noop;
        self.getConfig = function (): any {
          return {};
        };
        self.delConfig = noop;
        self.dispatch = noop;
        self.setProps = noop;
        self.types = {};
        return self;
      };
      const ATInternet: any = {
        Tracker: { Tag: makeTag, addPlugin: noop, Plugins: {} },
        Utils: {
          addEvtListener: noop,
          consumeCookie: noop,
          getCookie: function (): any {
            return null;
          },
          setCookie: noop,
          jsonSerialize: function (): string {
            return '{}';
          },
        },
        Callbacks: { register: noop },
        Version: '5.24.0',
      };
      gt.ATInternet = ATInternet;
      const existing = gt.tag;
      if (existing === undefined || existing === null) gt.tag = new (makeTag as any)();
      gt.ATTag = makeTag;
    } catch {
      /* never throw into the page */
    }
  },
});
