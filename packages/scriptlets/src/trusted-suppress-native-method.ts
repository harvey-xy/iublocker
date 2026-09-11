import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-suppress-native-method',
  args: [
    { name: 'methodPath', doc: 'Method to guard, e.g. `Document.prototype.createElement` or `eval`.' },
    {
      name: 'signature',
      doc: 'Comma-separated JSON argument matchers; a `"/re/"` string is a regex, `""` matches anything.',
    },
    { name: 'how', optional: true, doc: '`prevent` (default) returns undefined; `abort` throws.' },
    { name: 'stack', optional: true, doc: 'Only act when the call stack matches this literal or /regex/.' },
  ],
  trusted: true,
  fn: function (methodPath: string, signature: string, how?: string, stack?: string) {
    try {
      const gt: any = globalThis;
      if (typeof methodPath !== 'string' || methodPath === '') return;
      const parts = methodPath.split('.');
      const method = parts.pop() ?? '';
      if (method === '') return;
      let owner: any = gt;
      for (const part of parts) {
        if (owner === null || owner === undefined) return;
        owner = owner[part];
      }
      if (owner === null || owner === undefined) return;
      const orig = owner[method];
      if (typeof orig !== 'function') return;
      const mark = Symbol.for('iub.suppressNative.' + methodPath);
      if (owner[mark] === true) return;

      const unquote = (s: string): string => {
        const t = s.trim();
        if (t.length > 1 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
        return t;
      };
      const raw = unquote(String(signature ?? ''));
      if (raw === '') return;
      let spec: any[] = [];
      try {
        spec = JSON.parse('[' + raw + ']');
      } catch {
        spec = [raw];
      }
      if (Array.isArray(spec) === false || spec.length === 0) return;

      const toRe = (s: string): RegExp | null => {
        const text = s.trim();
        if (text === '') return null;
        const m = /^\/(.+)\/([a-z]*)$/.exec(text);
        if (m !== null) {
          try {
            return new RegExp(m[1] ?? '', (m[2] ?? '').replace(/g/g, ''));
          } catch {
            /* not a regex after all, treat as a literal */
          }
        }
        return null;
      };
      const matchers = spec.map((item: any) => {
        if (item === null || item === undefined || item === '') return null;
        if (typeof item === 'string') {
          const re = toRe(item);
          if (re !== null) return (v: any): boolean => re.test(String(v));
          return (v: any): boolean => String(v) === item;
        }
        return (v: any): boolean => v === item;
      });

      const reStack = (() => {
        const text = String(stack ?? '').trim();
        if (text === '') return null;
        const re = toRe(text);
        if (re !== null) return re;
        return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      })();
      const stackMatches = (): boolean => {
        if (reStack === null) return true;
        let s = '';
        try {
          s = String(new Error().stack ?? '');
        } catch {
          return false;
        }
        return reStack.test(s.split('\n').slice(1).join('\n'));
      };

      const aborts = String(how ?? '').trim() === 'abort';
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
      const patched = function (this: any, ...args: any[]): any {
        let hit = true;
        try {
          for (let i = 0; i < matchers.length; i++) {
            const m = matchers[i];
            if (m === null || m === undefined) continue;
            if (m(args[i]) === false) {
              hit = false;
              break;
            }
          }
          if (hit && stackMatches() === false) hit = false;
        } catch {
          hit = false;
        }
        if (hit === false) return orig.apply(this, args);
        if (aborts) throw new ReferenceError(method);
        return undefined;
      };
      nmap.set(patched, orig);
      try {
        Object.defineProperty(owner, method, { value: patched, configurable: true, writable: true });
        Object.defineProperty(owner, mark, { value: true, configurable: true });
      } catch {
        /* non-configurable */
      }
    } catch {
      /* never throw into the page */
    }
  },
});
