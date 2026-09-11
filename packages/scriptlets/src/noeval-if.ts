import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'noeval-if',
  aliases: ['noeval', 'prevent-eval-if', 'silent-noeval'],
  args: [
    {
      name: 'needle',
      optional: true,
      doc: 'Literal or /regex/ matched against the evaluated source; `!` negates.',
    },
  ],
  fn: function (needle?: string) {
    try {
      const gt: any = globalThis;
      if (typeof gt.eval !== 'function') return;
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
      const orig = gt.eval;
      gt.eval = keep(orig, function (this: any, src: any, ...rest: any[]): any {
        let block = false;
        try {
          let m = re.test(typeof src === 'string' ? src : String(src ?? ''));
          if (negate) m = !m;
          block = m;
        } catch {
          /* matching must never break the page */
        }
        if (block) return undefined;
        return orig.call(this === undefined ? gt : this, src, ...rest);
      });
    } catch {
      /* never throw into the page */
    }
  },
});
