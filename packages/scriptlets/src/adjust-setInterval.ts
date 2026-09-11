import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'adjust-setInterval',
  args: [
    { name: 'needle', optional: true, doc: 'Literal or /regex/ matched against the callback source; `!` negates.' },
    { name: 'delay', optional: true, doc: 'Only boost this delay; `!` negates.' },
    { name: 'boost', optional: true, doc: 'Multiplier applied to the delay (0.001…50, default 0.05).' },
  ],
  fn: function (needle?: string, delay?: string, boost?: string) {
    try {
      const gt: any = globalThis;
      if (typeof gt.setInterval !== 'function') return;
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
      let factor = parseFloat(typeof boost === 'string' ? boost : '');
      if (isNaN(factor) || factor <= 0) factor = 0.05;
      if (factor < 0.001) factor = 0.001;
      if (factor > 50) factor = 50;
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
      const orig = gt.setInterval;
      gt.setInterval = keep(
        orig,
        function (this: any, cb: any, ms?: any, ...rest: any[]): any {
          let hit = false;
          let actual = 0;
          try {
            actual = parseInt(String(ms ?? 0), 10) || 0;
            const src = typeof cb === 'function' ? String(cb) : typeof cb === 'string' ? cb : '';
            let m = reNeedle.test(src);
            if (negateNeedle) m = !m;
            let d = true;
            if (wantDelay !== -1) d = negateDelay ? actual !== wantDelay : actual === wantDelay;
            hit = m && d;
          } catch {
            /* matching must never break the page */
          }
          const next = hit ? Math.max(0, Math.round(actual * factor)) : ms;
          return orig.call(this === undefined ? gt : this, cb, next, ...rest);
        },
      );
    } catch {
      /* never throw into the page */
    }
  },
});
