import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'json-prune-xhr-response',
  args: [
    { name: 'propsToRemove', doc: 'Space-separated dot paths; `[]` and `*` match every key/index.' },
    {
      name: 'requiredProps',
      optional: true,
      doc: 'Space-separated paths that must (or, with `!`, must not) exist.',
    },
    { name: 'propsToMatch', optional: true, doc: 'Space-separated `key:pattern` pairs (url, method).' },
    { name: 'extra1', optional: true, doc: 'Second half of a `propsToMatch, <value>` pair, or `stack`.' },
    { name: 'extra2', optional: true, doc: 'Further trailing extra argument name.' },
    { name: 'extra3', optional: true, doc: 'Value of `extra2`.' },
  ],
  fn: function (propsToRemove: string, requiredProps?: string, propsToMatch?: string, ...extra: string[]) {
    try {
      const gt: any = globalThis;
      const XHR: any = gt.XMLHttpRequest;
      if (typeof XHR !== 'function' || XHR.prototype === undefined) return;
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
      const transform = (text: string): string => {
        const obj = JSON.parse(text);
        if (obj === null || typeof obj !== 'object') return text;
        for (const parts of needed) {
          const negated = (parts[0] ?? '').startsWith('!');
          const real = negated ? [(parts[0] ?? '').slice(1), ...parts.slice(1)] : parts;
          if (exists(obj, real, 0) === negated) return text;
        }
        for (const parts of toPrune) remove(obj, parts, 0);
        return JSON.stringify(obj);
      };
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
      const ctxKey = Symbol.for('iub.xhrCtx');
      const bypass = Symbol.for('iub.xhrBypass');
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
      const origOpen = XHR.prototype.open;
      const origSend = XHR.prototype.send;
      XHR.prototype.open = keep(origOpen, function (this: any, method: any, url: any, ...rest: any[]): any {
        try {
          this[ctxKey] = { method: String(method ?? 'GET'), url: String(url ?? '') };
        } catch {
          /* frozen instance */
        }
        return origOpen.call(this, method, url, ...rest);
      });
      const handleSend = (xhr: any, args: any[]): any => {
        const ctx = xhr[ctxKey];
        let matched = ctx !== undefined && ctx !== null && xhr[bypass] !== true;
        if (matched) {
          for (const n of needles) {
            const v = (ctx as any)[n.key];
            const hit = v === undefined ? false : n.re.test(String(v));
            if (hit === n.negate) {
              matched = false;
              break;
            }
          }
        }
        if (matched === false) return origSend.apply(xhr, args);
        const def = (prop: string, value: any): void => {
          try {
            Object.defineProperty(xhr, prop, { value, configurable: true, writable: false });
          } catch {
            /* not shadowable */
          }
        };
        const fire = (name: string): void => {
          try {
            xhr.dispatchEvent(new gt.Event(name));
          } catch {
            /* no Event constructor */
          }
        };
        const inner = new XHR();
        inner[bypass] = true;
        inner.addEventListener('load', function () {
          let text = '';
          try {
            text = String(inner.responseText ?? '');
            text = transform(text);
          } catch {
            /* not JSON: hand the body through untouched */
          }
          const type = String(xhr.responseType ?? '');
          def('readyState', 4);
          def('status', inner.status);
          def('statusText', inner.statusText);
          def('responseURL', ctx.url);
          if (type === '' || type === 'text') {
            def('responseText', text);
            def('response', text);
          } else if (type === 'json') {
            let parsed: any = null;
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = null;
            }
            def('response', parsed);
          } else {
            def('response', inner.response);
          }
          fire('readystatechange');
          fire('load');
          fire('loadend');
        });
        inner.addEventListener('error', function () {
          def('readyState', 4);
          def('status', 0);
          fire('readystatechange');
          fire('error');
          fire('loadend');
        });
        try {
          inner.open(ctx.method, ctx.url, true);
          inner.send(...args);
        } catch {
          return origSend.apply(xhr, args);
        }
        return undefined;
      };
      XHR.prototype.send = keep(origSend, function (this: any, ...args: any[]): any {
        return handleSend(this, args);
      });
    } catch {
      /* never throw into the page */
    }
  },
});
