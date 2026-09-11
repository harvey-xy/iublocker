import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'prevent-requestAnimationFrame',
  aliases: ['norafif', 'no-requestAnimationFrame-if'],
  args: [
    { name: 'needle', optional: true, doc: 'Literal or /regex/ matched against the callback source; `!` negates.' },
  ],
  fn: function (needle?: string) {
    try {
      const gt: any = globalThis;
      if (typeof gt.requestAnimationFrame !== 'function') return;
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
      let raw = typeof needle === 'string' ? needle : '';
      let negate = false;
      if (raw.startsWith('!')) {
        negate = true;
        raw = raw.slice(1);
      }
      const re = toRe(raw);
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
      const orig = gt.requestAnimationFrame;
      gt.requestAnimationFrame = keep(
        orig,
        function (this: any, cb: any, ...rest: any[]): any {
          let defuse = false;
          try {
            const src = typeof cb === 'function' ? String(cb) : String(cb ?? '');
            let m = re.test(src);
            if (negate) m = !m;
            defuse = m;
          } catch {
            /* matching must never break the page */
          }
          if (defuse) {
            return orig.call(this === undefined ? gt : this, function () {
              /* defused */
            });
          }
          return orig.call(this === undefined ? gt : this, cb, ...rest);
        },
      );
    } catch {
      /* never throw into the page */
    }
  },
});
