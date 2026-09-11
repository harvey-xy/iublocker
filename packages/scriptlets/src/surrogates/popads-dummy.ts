import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'popads-dummy.js',
  args: [],
  redirectResource: 'popads-dummy.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      // The dummy variant only needs the globals to exist; no behaviour at all.
      for (const name of ['PopAds', 'popns']) {
        try {
          Object.defineProperty(gt, name, { value: {}, writable: true, configurable: true });
        } catch {
          gt[name] = {};
        }
      }
    } catch {
      /* never throw into the page */
    }
  },
});
