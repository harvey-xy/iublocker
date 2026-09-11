import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'json-prune-fetch-response',
  args: [
    { name: 'propsToRemove', doc: 'Space-separated dot paths; `[]` and `*` match every key/index.' },
    {
      name: 'requiredProps',
      optional: true,
      doc: 'Space-separated paths that must (or, with `!`, must not) exist.',
    },
    {
      name: 'propsToMatch',
      optional: true,
      doc: 'Space-separated `key:pattern` pairs selecting the requests to prune.',
    },
    { name: 'extra1', optional: true, doc: 'Second half of a `propsToMatch, <value>` pair, or `stack`.' },
    { name: 'extra2', optional: true, doc: 'Further trailing extra argument name.' },
    { name: 'extra3', optional: true, doc: 'Value of `extra2`.' },
  ],
  fn: function (
    propsToRemove: string,
    requiredProps?: string,
    propsToMatch?: string,
    ...extra: string[]
  ) {
    try {
      const gt: any = globalThis;
      if (typeof gt.fetch !== 'function' || typeof gt.Response !== 'function') return;
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
      const prune = (root: any): any => {
        if (root === null || typeof root !== 'object') return root;
        for (const parts of needed) {
          const negated = (parts[0] ?? '').startsWith('!');
          const real = negated ? [(parts[0] ?? '').slice(1), ...parts.slice(1)] : parts;
          if (exists(root, real, 0) === negated) return root;
        }
        for (const parts of toPrune) remove(root, parts, 0);
        return root;
      };
      const KNOWN = ['propsToMatch', 'stack', 'logLevel', 'dontOverwrite'];
      let match = String(propsToMatch ?? '');
      if (KNOWN.indexOf(match.trim()) !== -1) {
        const opts: Record<string, string> = {};
        const all = [match, ...extra];
        for (let i = 0; i + 1 < all.length; i += 2) {
          const k = String(all[i] ?? '').trim();
          if (k !== '') opts[k] = String(all[i + 1] ?? '');
        }
        match = opts['propsToMatch'] ?? '';
      }
      const needles: { key: string; re: RegExp; negate: boolean }[] = [];
      for (const tok of String(match)
        .split(/\s+/)
        .filter((t) => t !== '')) {
        if (tok === '*') continue;
        let key = 'url';
        let value = tok;
        const i = tok.indexOf(':');
        if (
          i > 0 &&
          /^[a-zA-Z_][\w-]*$/.test(tok.slice(0, i)) &&
          tok.slice(i + 1).startsWith('//') === false
        ) {
          key = tok.slice(0, i);
          value = tok.slice(i + 1);
        }
        let negate = false;
        if (value.startsWith('!')) {
          negate = true;
          value = value.slice(1);
        }
        needles.push({ key, re: toRe(value), negate });
      }
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
      const orig = gt.fetch;
      gt.fetch = keep(orig, function (this: any, input?: any, init?: any, ...rest: any[]): any {
        const self0 = this === undefined ? gt : this;
        let url = '';
        const details: any = { method: 'GET' };
        try {
          if (typeof input === 'string') url = input;
          else if (input !== null && input !== undefined && typeof input.url === 'string') {
            url = input.url;
            if (typeof input.method === 'string') details.method = input.method;
          } else url = String(input ?? '');
          if (init !== null && typeof init === 'object') {
            for (const k of Object.keys(init)) details[k] = (init as any)[k];
          }
          details.url = url;
        } catch {
          /* matching must never break the page */
        }
        let matched = true;
        for (const n of needles) {
          const v = n.key === 'url' ? url : details[n.key];
          const hit = v === undefined ? false : n.re.test(String(v));
          if (hit === n.negate) {
            matched = false;
            break;
          }
        }
        const promise = orig.call(self0, input, init, ...rest);
        if (matched === false) return promise;
        return promise.then((resp: any) => {
          if (resp === null || resp === undefined || typeof resp.text !== 'function') return resp;
          return resp
            .clone()
            .text()
            .then((text: string) => {
              try {
                const obj = JSON.parse(text);
                const pruned = JSON.stringify(prune(obj));
                const out = new gt.Response(pruned, {
                  status: resp.status,
                  statusText: resp.statusText,
                  headers: resp.headers,
                });
                try {
                  Object.defineProperty(out, 'url', { value: resp.url });
                } catch {
                  /* read-only in some engines */
                }
                return out;
              } catch {
                return resp;
              }
            })
            .catch(() => resp);
        });
      });
    } catch {
      /* never throw into the page */
    }
  },
});
