import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'json-prune',
  args: [
    { name: 'propsToRemove', doc: 'Space-separated dot paths; `[]` and `*` match every key/index.' },
    {
      name: 'requiredProps',
      optional: true,
      doc: 'Space-separated paths that must (or, with `!`, must not) exist.',
    },
    { name: 'stack', optional: true, doc: 'Only prune when the call stack matches this literal or /regex/.' },
  ],
  fn: function (propsToRemove: string, requiredProps?: string, stack?: string) {
    try {
      const gt: any = globalThis;
      const paths = (s: string | undefined): string[][] =>
        String(s ?? '')
          .split(/\s+/)
          .filter((p) => p !== '')
          .map((p) => p.split('.'));
      const toPrune = paths(propsToRemove);
      if (toPrune.length === 0) return;
      const needed = paths(requiredProps);
      const isWild = (k: string): boolean => k === '*' || k === '[]';
      const exists = (o: any, parts: string[], i: number): boolean => {
        if (o === null || typeof o !== 'object') return false;
        const key = parts[i] ?? '';
        const last = i === parts.length - 1;
        if (isWild(key)) {
          for (const k of Object.keys(o)) {
            if (last) return true;
            if (exists(o[k], parts, i + 1)) return true;
          }
          return false;
        }
        if (Object.prototype.hasOwnProperty.call(o, key) === false) return false;
        return last ? true : exists(o[key], parts, i + 1);
      };
      const remove = (o: any, parts: string[], i: number): void => {
        if (o === null || typeof o !== 'object') return;
        const key = parts[i] ?? '';
        const last = i === parts.length - 1;
        if (isWild(key)) {
          for (const k of Object.keys(o)) {
            if (last) delete o[k];
            else remove(o[k], parts, i + 1);
          }
          return;
        }
        if (Object.prototype.hasOwnProperty.call(o, key) === false) return;
        if (last) delete o[key];
        else remove(o[key], parts, i + 1);
      };
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
      const reStack = toRe(stack);
      const stackOk = (): boolean => {
        if (reStack === null) return true;
        let s = '';
        try {
          s = String(new Error().stack ?? '');
        } catch {
          /* no stack available */
        }
        return reStack.test(s.split('\n').slice(1).join('\n'));
      };
      const prune = (root: any): any => {
        try {
          if (root === null || typeof root !== 'object') return root;
          if (stackOk() === false) return root;
          for (const parts of needed) {
            const negated = (parts[0] ?? '').startsWith('!');
            const real = negated ? [(parts[0] ?? '').slice(1), ...parts.slice(1)] : parts;
            if (exists(root, real, 0) === negated) return root;
          }
          for (const parts of toPrune) remove(root, parts, 0);
        } catch {
          /* leave the payload untouched on any failure */
        }
        return root;
      };
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
      const origParse = JSON.parse;
      JSON.parse = keep(origParse, function (this: any, ...args: any[]): any {
        return prune(origParse.apply(this, args as [string]));
      });
      const R: any = gt.Response;
      if (R !== undefined && typeof R.prototype.json === 'function') {
        const origJson = R.prototype.json;
        R.prototype.json = keep(origJson, function (this: any, ...args: any[]): any {
          return origJson.apply(this, args).then((o: any) => prune(o));
        });
      }
    } catch {
      /* never throw into the page */
    }
  },
});
