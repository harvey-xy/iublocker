import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-replace-outbound-text',
  args: [
    {
      name: 'propChain',
      doc: 'Function whose *return value* is rewritten, e.g. `atob` or `JSON.stringify`.',
    },
    { name: 'pattern', doc: 'Literal or /regex/ to replace inside the returned string.' },
    { name: 'replacement', optional: true, doc: 'Replacement text; defaults to the empty string.' },
    { name: 'extra1', optional: true, doc: 'Trailing `name, value` extra argument (`condition`).' },
    { name: 'extra2', optional: true, doc: 'Value of `extra1`.' },
    { name: 'extra3', optional: true, doc: 'Second trailing extra argument name.' },
    { name: 'extra4', optional: true, doc: 'Value of `extra3`.' },
  ],
  trusted: true,
  fn: function (propChain: string, pattern: string, replacement?: string, ...extra: string[]) {
    try {
      const gt: any = globalThis;
      if (typeof propChain !== 'string' || propChain === '') return;
      const parts = propChain.split('.');
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
      const mark = Symbol.for('iub.replaceOutbound.' + propChain);
      if (owner[mark] === true) return;

      const opts: Record<string, string> = {};
      for (let i = 0; i + 1 < extra.length; i += 2) {
        const k = String(extra[i] ?? '').trim();
        if (k !== '') opts[k] = String(extra[i + 1] ?? '');
      }
      const unquote = (s: string): string => {
        if (s.length > 1 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
        if (s.length > 1 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
        return s;
      };
      const toRe = (s: string, defaultFlags: string): RegExp | null => {
        const text = unquote(s.trim());
        if (text === '') return null;
        const m = /^\/(.+)\/([a-z]*)$/.exec(text);
        if (m !== null) {
          try {
            return new RegExp(m[1] ?? '', m[2] === '' ? defaultFlags : (m[2] as string));
          } catch {
            /* not a regex after all, treat as a literal */
          }
        }
        return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), defaultFlags);
      };
      const rePattern = toRe(String(pattern ?? ''), 'g');
      if (rePattern === null) return;
      const condition = toRe(opts['condition'] ?? '', '');
      const repl = unquote(typeof replacement === 'string' ? replacement : '');

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
      const rewrite = (out: any): any => {
        if (typeof out !== 'string') return out;
        try {
          if (condition !== null && condition.test(out) === false) return out;
          rePattern.lastIndex = 0;
          return out.replace(rePattern, repl);
        } catch {
          return out;
        }
      };
      const patched = function (this: any, ...args: any[]): any {
        const out = orig.apply(this, args);
        if (out !== null && typeof out === 'object' && typeof out.then === 'function') {
          return out.then(rewrite);
        }
        return rewrite(out);
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
