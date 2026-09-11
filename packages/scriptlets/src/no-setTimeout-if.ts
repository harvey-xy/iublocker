import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'no-setTimeout-if',
  aliases: ['nostif', 'setTimeout-defuser', 'prevent-setTimeout'],
  args: [
    { name: 'needle', optional: true, doc: 'Literal or /regex/ matched against the callback source; `!` negates.' },
    { name: 'delay', optional: true, doc: 'Only defuse this delay; `!` negates.' },
  ],
  fn: function (needle?: string, delay?: string) {
    try {
      const gt: any = globalThis;
      if (typeof gt.setTimeout !== 'function') return;
      const toRe = (s: string): RegExp => {
        if (s === '' || s === '*') return /^/;
        const m = /^\/(.+)\/([a-z]*)$/.exec(s);
        if (m !== null) {
          try {
            return new RegExp(m[1] ?? '', m[2]);
          } catch {
            /* not a regex after all, treat as a literal */
          }
        }
        return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      };
      let rawNeedle = typeof needle === 'string' ? needle : '';
      let negateNeedle = false;
      if (rawNeedle.startsWith('!')) {
        negateNeedle = true;
        rawNeedle = rawNeedle.slice(1);
      }
      const reNeedle = toRe(rawNeedle);
      let rawDelay = typeof delay === 'string' ? delay.trim() : '';
      let negateDelay = false;
      if (rawDelay.startsWith('!')) {
        negateDelay = true;
        rawDelay = rawDelay.slice(1);
      }
      let wantDelay = parseInt(rawDelay, 10);
      if (isNaN(wantDelay)) wantDelay = -1;
      // Preserve toString() of every native we patch.
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
      const orig = gt.setTimeout;
      gt.setTimeout = keep(
        orig,
        function (this: any, cb: any, ms?: any, ...rest: any[]): any {
          let defuse = false;
          try {
            const src = typeof cb === 'function' ? String(cb) : typeof cb === 'string' ? cb : '';
            let m = reNeedle.test(src);
            if (negateNeedle) m = !m;
            let d = true;
            if (wantDelay !== -1) {
              const actual = parseInt(String(ms ?? 0), 10) || 0;
              d = negateDelay ? actual !== wantDelay : actual === wantDelay;
            }
            defuse = m && d;
          } catch {
            /* matching must never break the page */
          }
          if (defuse) {
            return orig.call(this === undefined ? gt : this, function () {
              /* defused */
            }, ms);
          }
          return orig.call(this === undefined ? gt : this, cb, ms, ...rest);
        },
      );
    } catch {
      /* never throw into the page */
    }
  },
});
