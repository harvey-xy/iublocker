import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-replace-xhr-response',
  args: [
    { name: 'pattern', doc: '`*` for the whole body, otherwise a literal or /regex/ to replace.' },
    { name: 'replacement', optional: true, doc: 'Replacement text ($1… supported for regex patterns).' },
    { name: 'propsToMatch', optional: true, doc: 'Space-separated `key:pattern` pairs (url, method).' },
  ],
  trusted: true,
  fn: function (pattern: string, replacement?: string, propsToMatch?: string) {
    try {
      const gt: any = globalThis;
      const XHR: any = gt.XMLHttpRequest;
      if (typeof XHR !== 'function' || XHR.prototype === undefined) return;
      const reOf = (s: string, flags: string): RegExp => {
        if (s === '' || s === '*') return /^/;
        const m = /^\/(.+)\/([a-z]*)$/.exec(s);
        if (m !== null) {
          try {
            return new RegExp(m[1] ?? '', m[2] === '' ? flags : (m[2] as string));
          } catch {
            /* not a regex after all, treat as a literal */
          }
        }
        return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      };
      const whole = pattern === '*' || pattern === '';
      const rePattern = whole ? null : reOf(pattern, 'g');
      const repl = typeof replacement === 'string' ? replacement : '';
      const transform = (text: string): string =>
        whole || rePattern === null ? repl : text.replace(rePattern, repl);
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
      const needles: { key: string; re: RegExp; negate: boolean }[] = [];
      for (const tok of String(propsToMatch ?? '')
        .split(/\s+/)
        .filter((t) => t !== '')) {
        if (tok === '*') continue;
        let key = 'url';
        let value = tok;
        const i = tok.indexOf(':');
        if (i > 0 && /^[a-zA-Z_][\w-]*$/.test(tok.slice(0, i)) && tok.slice(i + 1).startsWith('//') === false) {
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
            /* leave the body untouched on any failure */
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
