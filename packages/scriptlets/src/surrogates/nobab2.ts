import { defineScriptlet } from '../_define';

/**
 * Neutralises the second generation of BlockAdBlock/FuckAdBlock bundles, which hide
 * behind a generated global name and call their "not detected" branch from a timer.
 */
export default defineScriptlet({
  name: 'nobab2.js',
  aliases: ['bab-defuser2.js', 'prevent-bab2.js'],
  args: [],
  redirectResource: 'nobab2.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const signatures = [
        'blockadblock',
        'babasbm',
        'fuckadblock',
        'getItem(',
        'detectAdBlock',
        'adsBlocked',
      ];
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
      const keep = (o: any, p: any): any => {
        nmap.set(p, o);
        return p;
      };
      const looksLikeBab = (handler: any): boolean => {
        try {
          const src = typeof handler === 'function' ? String(handler) : String(handler ?? '');
          const lower = src.toLowerCase();
          for (const needle of signatures) if (lower.indexOf(needle) !== -1) return true;
          return false;
        } catch {
          return false;
        }
      };
      const origTimeout = gt.setTimeout;
      if (typeof origTimeout === 'function') {
        gt.setTimeout = keep(origTimeout, function (this: any, handler: any, ...rest: any[]): any {
          if (looksLikeBab(handler)) return 0;
          return origTimeout.call(this === undefined ? gt : this, handler, ...rest);
        });
      }
      const origInterval = gt.setInterval;
      if (typeof origInterval === 'function') {
        gt.setInterval = keep(origInterval, function (this: any, handler: any, ...rest: any[]): any {
          if (looksLikeBab(handler)) return 0;
          return origInterval.call(this === undefined ? gt : this, handler, ...rest);
        });
      }
      const origEval = gt.eval;
      if (typeof origEval === 'function') {
        gt.eval = keep(origEval, function (this: any, code: any, ...rest: any[]): any {
          if (looksLikeBab(code)) return undefined;
          return origEval.call(this === undefined ? gt : this, code, ...rest);
        });
      }
    } catch {
      /* never throw into the page */
    }
  },
});
