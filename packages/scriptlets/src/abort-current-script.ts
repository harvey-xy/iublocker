import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'abort-current-script',
  aliases: ['acs', 'abort-current-inline-script', 'acis'],
  args: [
    { name: 'property', doc: 'Property chain whose read triggers the check.' },
    { name: 'needle', optional: true, doc: 'Literal or /regex/ matched against the script text (or src).' },
    {
      name: 'context',
      optional: true,
      doc: 'Literal or /regex/ matched against the script src / document URL.',
    },
  ],
  fn: function (property: string, needle?: string, context?: string) {
    try {
      if (typeof property !== 'string' || property === '') return;
      const toRe = (s: string | undefined): RegExp | null => {
        if (s === undefined || s === '') return null;
        if (s === '*') return /^/;
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
      let reNeedle = toRe(needle);
      let negate = false;
      if (typeof needle === 'string' && needle.startsWith('!')) {
        negate = true;
        reNeedle = toRe(needle.slice(1));
      }
      const reContext = toRe(context);
      const gt: any = globalThis;
      const tkey = Symbol.for('iub.abortToken');
      let tk: string = gt[tkey];
      if (typeof tk !== 'string') {
        tk = 'iub' + Math.random().toString(36).slice(2);
        gt[tkey] = tk;
        const prev = gt.onerror;
        gt.onerror = function (this: any, msg: any, ...rest: any[]): any {
          if (typeof msg === 'string' && msg.indexOf(tk) !== -1) return true;
          if (typeof prev === 'function') return prev.call(this, msg, ...rest);
          return undefined;
        };
      }
      const validate = (): void => {
        const doc: any = typeof document !== 'undefined' ? document : undefined;
        const e: any = doc && doc.currentScript;
        if (e === null || e === undefined) return;
        if (typeof e.tagName !== 'string' || e.tagName.toUpperCase() !== 'SCRIPT') return;
        const src: string = typeof e.src === 'string' ? e.src : '';
        const text: string = src !== '' ? src : String(e.textContent ?? '');
        if (reNeedle !== null) {
          const hit = reNeedle.test(text);
          if (hit === negate) return;
        } else if (negate) {
          return;
        }
        if (reContext !== null) {
          const href = doc && doc.location ? String(doc.location.href) : '';
          if (reContext.test(src) === false && reContext.test(href) === false) return;
        }
        throw new ReferenceError(tk);
      };
      const install = (owner: any, chain: string): void => {
        const pos = chain.indexOf('.');
        if (pos === -1) {
          const d = Object.getOwnPropertyDescriptor(owner, chain);
          if (d !== undefined && d.configurable === false) return;
          let cur: any = d === undefined ? undefined : owner[chain];
          const g: any = d !== undefined && typeof d.get === 'function' ? d.get : null;
          const s: any = d !== undefined && typeof d.set === 'function' ? d.set : null;
          Object.defineProperty(owner, chain, {
            configurable: true,
            enumerable: d === undefined ? false : d.enumerable,
            get(this: any) {
              validate();
              return g !== null ? g.call(this) : cur;
            },
            set(this: any, nv: any) {
              validate();
              if (s !== null) s.call(this, nv);
              else cur = nv;
            },
          });
          return;
        }
        const head = chain.slice(0, pos);
        const tail = chain.slice(pos + 1);
        let v: any = owner[head];
        if (v instanceof Object) {
          install(v, tail);
          return;
        }
        const d = Object.getOwnPropertyDescriptor(owner, head);
        if (d !== undefined && d.configurable === false) return;
        Object.defineProperty(owner, head, {
          configurable: true,
          enumerable: true,
          get() {
            return v;
          },
          set(nv: any) {
            v = nv;
            if (nv instanceof Object) install(nv, tail);
          },
        });
      };
      install(gt, property);
    } catch {
      /* never throw into the page */
    }
  },
});
