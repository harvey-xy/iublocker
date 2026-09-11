import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-set-constant',
  args: [
    { name: 'property', doc: 'Property chain to define.' },
    { name: 'value', doc: 'A value keyword, a JSON literal, or an arbitrary string.' },
    { name: 'stack', optional: true, doc: 'Only answer with the constant when the call stack matches.' },
  ],
  trusted: true,
  fn: function (property: string, value: string, stack?: string) {
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
      const toValue = (v: string): any => {
        switch (v) {
          case 'undefined':
            return undefined;
          case 'false':
            return false;
          case 'true':
            return true;
          case 'null':
            return null;
          case 'noopFunc':
            return function () {
              /* noop */
            };
          case 'trueFunc':
            return function () {
              return true;
            };
          case 'falseFunc':
            return function () {
              return false;
            };
          case 'throwFunc':
            return function () {
              throw new Error();
            };
          case 'noopPromiseResolve':
            return function () {
              return Promise.resolve(
                typeof Response === 'function'
                  ? new Response('', { status: 200, statusText: 'OK' })
                  : undefined,
              );
            };
          case 'noopPromiseReject':
            return function () {
              return Promise.reject(new Error());
            };
          case 'emptyObj':
            return {};
          case 'emptyArr':
            return [];
          case 'emptyStr':
          case "''":
          case '""':
          case '':
            return '';
          default:
            break;
        }
        if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
        try {
          return JSON.parse(v);
        } catch {
          /* not JSON: a plain string constant */
        }
        return v;
      };
      const constant = toValue(typeof value === 'string' ? value : '');
      const reStack = toRe(stack);
      const applies = (): boolean => {
        if (reStack === null) return true;
        let s = '';
        try {
          s = String(new Error().stack ?? '');
        } catch {
          /* no stack available */
        }
        return reStack.test(s.split('\n').slice(1).join('\n'));
      };
      const install = (owner: any, chain: string): void => {
        const pos = chain.indexOf('.');
        if (pos === -1) {
          const d = Object.getOwnPropertyDescriptor(owner, chain);
          if (d !== undefined && d.configurable === false) return;
          let fallback: any = d === undefined ? undefined : owner[chain];
          Object.defineProperty(owner, chain, {
            configurable: true,
            enumerable: d === undefined ? true : d.enumerable,
            get() {
              return applies() ? constant : fallback;
            },
            set(nv: any) {
              fallback = nv;
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
      install(globalThis as any, property);
    } catch {
      /* never throw into the page */
    }
  },
});
