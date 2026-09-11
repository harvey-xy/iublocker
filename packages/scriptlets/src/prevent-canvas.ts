import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'prevent-canvas',
  args: [
    {
      name: 'contextType',
      optional: true,
      doc: 'Literal or /regex/ context id to refuse ("2d"); `!` negates. Empty refuses every type.',
    },
  ],
  fn: function (contextType?: string) {
    try {
      const gt: any = globalThis;
      const Canvas: any = gt.HTMLCanvasElement;
      if (typeof Canvas !== 'function' || Canvas.prototype === undefined) return;
      const mark = Symbol.for('iub.preventCanvas');
      if ((Canvas.prototype as any)[mark] === true) return;
      let raw = typeof contextType === 'string' ? contextType.trim() : '';
      let negate = false;
      if (raw.startsWith('!')) {
        negate = true;
        raw = raw.slice(1);
      }
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
        return new RegExp('^' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
      };
      const re = toRe(raw);
      const orig = Canvas.prototype.getContext;
      if (typeof orig !== 'function') return;
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
      const patched = function (this: any, type?: any, ...rest: any[]): any {
        const id = String(type ?? '');
        if (re.test(id) !== negate) return null;
        return orig.call(this, type, ...rest);
      };
      nmap.set(patched, orig);
      Canvas.prototype.getContext = patched;
      try {
        Object.defineProperty(Canvas.prototype, mark, { value: true, configurable: true });
      } catch {
        /* sealed prototype */
      }
    } catch {
      /* never throw into the page */
    }
  },
});
