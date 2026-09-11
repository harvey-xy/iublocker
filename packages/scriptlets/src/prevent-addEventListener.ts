import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'prevent-addEventListener',
  aliases: ['aeld', 'addEventListener-defuser'],
  args: [
    { name: 'type', optional: true, doc: 'Literal or /regex/ matched against the event type; `!` negates.' },
    { name: 'pattern', optional: true, doc: 'Literal or /regex/ matched against the handler source; `!` negates.' },
  ],
  fn: function (type?: string, pattern?: string) {
    try {
      const gt: any = globalThis;
      const ET: any = gt.EventTarget;
      if (ET === undefined || typeof ET.prototype.addEventListener !== 'function') return;
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
      let rawType = typeof type === 'string' ? type : '';
      let negType = false;
      if (rawType.startsWith('!')) {
        negType = true;
        rawType = rawType.slice(1);
      }
      const reType = toRe(rawType);
      let rawPat = typeof pattern === 'string' ? pattern : '';
      let negPat = false;
      if (rawPat.startsWith('!')) {
        negPat = true;
        rawPat = rawPat.slice(1);
      }
      const rePat = toRe(rawPat);
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
      const orig = ET.prototype.addEventListener;
      ET.prototype.addEventListener = keep(
        orig,
        function (this: any, t: any, handler: any, ...rest: any[]): any {
          let defuse = false;
          try {
            let src = '';
            if (typeof handler === 'function') src = String(handler);
            else if (handler !== null && typeof handler === 'object') src = String(handler.handleEvent ?? '');
            else src = String(handler ?? '');
            let mt = reType.test(String(t ?? ''));
            if (negType) mt = !mt;
            let mp = rePat.test(src);
            if (negPat) mp = !mp;
            defuse = mt && mp;
          } catch {
            /* matching must never break the page */
          }
          if (defuse) return undefined;
          return orig.call(this, t, handler, ...rest);
        },
      );
    } catch {
      /* never throw into the page */
    }
  },
});
