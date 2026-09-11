import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'prevent-window-open',
  aliases: ['nowoif', 'window.open-defuser', 'no-window-open-if'],
  args: [
    { name: 'pattern', optional: true, doc: 'Literal or /regex/ matched against the URL; `!` negates.' },
    { name: 'delay', optional: true, doc: 'Auto-close a real popup after N ms instead of blocking it.' },
    { name: 'decoy', optional: true, doc: '"blank" | "object" — what to hand back to the page.' },
  ],
  fn: function (pattern?: string, delay?: string, decoy?: string) {
    try {
      const gt: any = globalThis;
      if (typeof gt.open !== 'function') return;
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
      let raw = typeof pattern === 'string' ? pattern : '';
      let negate = false;
      if (raw.startsWith('!')) {
        negate = true;
        raw = raw.slice(1);
      }
      const re = toRe(raw);
      const autoClose = parseInt(typeof delay === 'string' ? delay : '', 10);
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
      const makeDecoy = (): any => {
        const noop = function () {
          /* noop */
        };
        const self0: any = {
          blur: noop,
          close: noop,
          closed: false,
          focus: noop,
          opener: null,
          parent: null,
          postMessage: noop,
          print: noop,
          location: { href: 'about:blank', assign: noop, replace: noop, reload: noop, toString: () => 'about:blank' },
          document: {
            open: noop,
            close: noop,
            write: noop,
            writeln: noop,
            body: null,
            documentElement: null,
          },
        };
        self0.self = self0;
        self0.top = self0;
        self0.window = self0;
        return self0;
      };
      const orig = gt.open;
      gt.open = keep(
        orig,
        function (this: any, url?: any, ...rest: any[]): any {
          let block = false;
          try {
            let m = re.test(String(url ?? ''));
            if (negate) m = !m;
            block = m;
          } catch {
            /* matching must never break the page */
          }
          if (block === false) return orig.call(this === undefined ? gt : this, url, ...rest);
          if (isNaN(autoClose) === false && autoClose >= 0) {
            // Let the popup open, then close it shortly after (uBO's `delay` argument).
            const w = orig.call(this === undefined ? gt : this, url, ...rest);
            try {
              gt.setTimeout(function () {
                try {
                  if (w !== null && w !== undefined) w.close();
                } catch {
                  /* already gone */
                }
              }, autoClose);
            } catch {
              /* no timers available */
            }
            return w;
          }
          if (decoy === 'blank') {
            try {
              return orig.call(this === undefined ? gt : this, 'about:blank', ...rest.slice(0, 1));
            } catch {
              /* fall through to the object decoy */
            }
          }
          return makeDecoy();
        },
      );
      if (gt.window !== undefined && gt.window !== null) {
        try {
          gt.window.open = gt.open;
        } catch {
          /* window.open is not writable here */
        }
      }
    } catch {
      /* never throw into the page */
    }
  },
});
