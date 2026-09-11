import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'hd-main.js',
  args: [],
  redirectResource: 'hd-main.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      // hd-main.js is a pop/redirect loader: stub its entry points and keep
      // window.open from being hijacked by whatever is left of the page.
      gt.hd_main = noop;
      gt.hdMain = noop;
      gt.popunder = noop;
      gt.PopUnder = noop;
      gt.__hdMainLoaded = true;
      const nk = Symbol.for('iub.nativeMap');
      let nmap: WeakMap<any, any> = gt[nk];
      if (nmap === undefined) {
        nmap = new WeakMap();
        gt[nk] = nmap;
        const ots = Function.prototype.toString;
        const pts = function (this: any): string {
          return ots.call(nmap.get(this) ?? this);
        };
        nmap.set(pts, ots);
        Function.prototype.toString = pts;
      }
      const orig = gt.open;
      if (typeof orig === 'function') {
        const patched = function (this: any, url?: any, ...rest: any[]): any {
          try {
            const href = String(url ?? '');
            if (href === '' || href === 'about:blank') return null;
          } catch {
            /* fall through to the real open */
          }
          return orig.call(this === undefined ? gt : this, url, ...rest);
        };
        nmap.set(patched, orig);
        gt.open = patched;
      }
    } catch {
      /* never throw into the page */
    }
  },
});
