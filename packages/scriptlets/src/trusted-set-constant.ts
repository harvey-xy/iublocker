import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-set-constant',
  aliases: ['trusted-set'],
  args: [
    { name: 'property', doc: 'Property chain to define.' },
    { name: 'value', doc: 'A value keyword, a JSON literal, or an arbitrary string.' },
    { name: 'stack', optional: true, doc: 'Only answer with the constant when the call stack matches.' },
    { name: 'extra1', optional: true, doc: 'Trailing `name, value` extra argument (`runAt`).' },
    { name: 'extra2', optional: true, doc: 'Value of `extra1`.' },
  ],
  trusted: true,
  fn: function (property: string, value: string, stack?: string, ..._extra: string[]) {
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
        // uBO's explicit forms: `json:<literal>` and `{"value": <literal>}`.
        if (v.startsWith('json:')) {
          try {
            return JSON.parse(v.slice(5));
          } catch {
            return v.slice(5);
          }
        }
        if (v.startsWith('{') && v.endsWith('}')) {
          try {
            const parsed = JSON.parse(v);
            if (parsed !== null && typeof parsed === 'object' && 'value' in parsed) return parsed.value;
            return parsed;
          } catch {
            /* not JSON: fall through */
          }
        }
        try {
          return JSON.parse(v);
        } catch {
          /* not JSON: a plain string constant */
        }
        return v;
      };
      const unwrap = (raw: string): string => {
        const t = raw.trim();
        if (t.length > 1 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
        return t;
      };
      const constant = toValue(typeof value === 'string' ? unwrap(value) : '');
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
