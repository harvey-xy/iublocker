import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'abort-on-property-read',
  aliases: ['aopr'],
  args: [{ name: 'property', doc: 'Property chain to guard, e.g. "adblock" or "a.b.c".' }],
  fn: function (property: string) {
    try {
      if (typeof property !== 'string' || property === '') return;
      const gt: any = globalThis;
      // Shared exception token: thrown as a ReferenceError and swallowed by our onerror hook.
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
      const abort = function (): any {
        throw new ReferenceError(tk);
      };
      const install = (owner: any, chain: string): void => {
        const pos = chain.indexOf('.');
        if (pos === -1) {
          const d = Object.getOwnPropertyDescriptor(owner, chain);
          if (d !== undefined && d.configurable === false) return;
          if (d !== undefined && d.get === abort) return;
          Object.defineProperty(owner, chain, {
            configurable: true,
            enumerable: d === undefined ? false : d.enumerable,
            get: abort,
            set: function () {
              /* swallow writes so the page keeps running until it reads */
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
