import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'abort-on-stack-trace',
  aliases: ['aost'],
  args: [
    { name: 'property', doc: 'Property chain whose read triggers the stack check.' },
    { name: 'needle', doc: 'Literal or /regex/ matched against the call stack.' },
  ],
  fn: function (property: string, needle: string) {
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
      let negate = false;
      let raw = typeof needle === 'string' ? needle : '';
      if (raw.startsWith('!')) {
        negate = true;
        raw = raw.slice(1);
      }
      const reStack = toRe(raw);
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
      const matches = (): boolean => {
        if (reStack === null) return !negate;
        let stack = '';
        try {
          stack = String(new Error().stack ?? '');
        } catch {
          /* no stack available */
        }
        // Drop the frames belonging to this scriptlet itself.
        const lines = stack.split('\n').slice(1);
        const hit = reStack.test(lines.join('\n'));
        return hit !== negate;
      };
      const install = (owner: any, chain: string): void => {
        const pos = chain.indexOf('.');
        if (pos === -1) {
          const d = Object.getOwnPropertyDescriptor(owner, chain);
          if (d !== undefined && d.configurable === false) return;
          let cur: any = d === undefined ? undefined : owner[chain];
          Object.defineProperty(owner, chain, {
            configurable: true,
            enumerable: d === undefined ? false : d.enumerable,
            get() {
              if (matches()) throw new ReferenceError(tk);
              return cur;
            },
            set(nv: any) {
              cur = nv;
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
