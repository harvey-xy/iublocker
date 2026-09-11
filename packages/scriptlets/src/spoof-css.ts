import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'spoof-css',
  args: [
    { name: 'selector', doc: 'CSS selector of the elements whose computed style is faked.' },
    { name: 'property', doc: 'CSS property to spoof.' },
    { name: 'value', doc: 'Value `getComputedStyle()` should report.' },
    { name: 'property2', optional: true, doc: 'Second property to spoof.' },
    { name: 'value2', optional: true, doc: 'Value of `property2`.' },
    { name: 'property3', optional: true, doc: 'Third property to spoof.' },
    { name: 'value3', optional: true, doc: 'Value of `property3`.' },
  ],
  fn: function (selector: string, ...rest: string[]) {
    try {
      const gt: any = globalThis;
      if (typeof selector !== 'string' || selector.trim() === '') return;
      const sel = selector.trim();
      const spoofed: Record<string, string> = {};
      for (let i = 0; i + 1 < rest.length; i += 2) {
        const key = String(rest[i] ?? '')
          .trim()
          .toLowerCase();
        if (key === '') continue;
        spoofed[key] = String(rest[i + 1] ?? '').trim();
      }
      if (Object.keys(spoofed).length === 0) return;
      const orig = gt.getComputedStyle;
      if (typeof orig !== 'function') return;
      let table: { sel: string; props: Record<string, string> }[] = gt['__iub_spoofcss'];
      if (table === undefined) {
        table = [];
        gt['__iub_spoofcss'] = table;
      }
      const key = sel + ' ' + JSON.stringify(spoofed);
      if (table.some((e) => e.sel + ' ' + JSON.stringify(e.props) === key)) return;
      table.push({ sel, props: spoofed });
      if (gt['__iub_spoofcss_hooked'] === true) return;
      gt['__iub_spoofcss_hooked'] = true;

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
      const lookup = (el: any): Record<string, string> | null => {
        const out: Record<string, string> = {};
        let any = false;
        for (const entry of table) {
          try {
            if (typeof el.matches !== 'function' || el.matches(entry.sel) === false) continue;
          } catch {
            continue;
          }
          for (const k of Object.keys(entry.props)) {
            out[k] = entry.props[k] as string;
            any = true;
          }
        }
        return any ? out : null;
      };
      const patched = function (this: any, el: any, pseudo?: any): any {
        const style = orig.call(this === undefined ? gt : this, el, pseudo);
        let props: Record<string, string> | null = null;
        try {
          props = pseudo === undefined || pseudo === null ? lookup(el) : null;
        } catch {
          props = null;
        }
        if (props === null || style === null || style === undefined) return style;
        const spoof = props;
        try {
          return new Proxy(style, {
            get(target: any, prop: any, receiver: any): any {
              if (prop === 'getPropertyValue') {
                return function (name: any): any {
                  const n = String(name ?? '').toLowerCase();
                  if (Object.prototype.hasOwnProperty.call(spoof, n)) return spoof[n];
                  return target.getPropertyValue(n);
                };
              }
              if (typeof prop === 'string') {
                const dashed = prop.replace(/[A-Z]/g, function (c: string) {
                  return '-' + c.toLowerCase();
                });
                if (Object.prototype.hasOwnProperty.call(spoof, dashed)) return spoof[dashed];
                if (Object.prototype.hasOwnProperty.call(spoof, prop)) return spoof[prop];
              }
              const value = Reflect.get(target, prop, receiver);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
        } catch {
          return style;
        }
      };
      nmap.set(patched, orig);
      try {
        Object.defineProperty(gt, 'getComputedStyle', {
          value: patched,
          configurable: true,
          writable: true,
        });
      } catch {
        /* non-configurable */
      }
    } catch {
      /* never throw into the page */
    }
  },
});
