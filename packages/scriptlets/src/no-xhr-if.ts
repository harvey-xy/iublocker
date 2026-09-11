import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'no-xhr-if',
  aliases: ['prevent-xhr'],
  args: [
    {
      name: 'propsToMatch',
      optional: true,
      doc: 'Space-separated `key:pattern` pairs (url, method); bare token matches the URL.',
    },
    {
      name: 'directive',
      optional: true,
      doc: "'' | emptyObj | emptyArr | emptyStr | throw | a literal body.",
    },
    { name: 'responseType', optional: true, doc: 'Accepted for uBO compatibility; ignored.' },
    { name: 'extra1', optional: true, doc: 'Trailing `name, value` extra argument (`throttle`).' },
    { name: 'extra2', optional: true, doc: 'Value of `extra1`.' },
  ],
  fn: function (propsToMatch?: string, directive?: string, _responseType?: string, ..._extra: string[]) {
    try {
      const gt: any = globalThis;
      const XHR: any = gt.XMLHttpRequest;
      if (typeof XHR !== 'function' || XHR.prototype === undefined) return;
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
      let body = '';
      let fail = false;
      switch (directive) {
        case undefined:
        case '':
        case 'emptyStr':
          body = '';
          break;
        case 'emptyObj':
          body = '{}';
          break;
        case 'emptyArr':
          body = '[]';
          break;
        case 'throw':
          fail = true;
          break;
        default:
          body = String(directive);
          break;
      }
      const ctxKey = Symbol.for('iub.xhrCtx');
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
        let matched = ctx !== undefined && ctx !== null;
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
        const fire = (name: string): void => {
          try {
            xhr.dispatchEvent(new gt.Event(name));
          } catch {
            /* no Event constructor */
          }
        };
        gt.setTimeout(function () {
          try {
            const def = (prop: string, value: any): void => {
              try {
                Object.defineProperty(xhr, prop, { value, configurable: true, writable: false });
              } catch {
                /* not shadowable */
              }
            };
            if (fail) {
              def('readyState', 4);
              def('status', 0);
              def('statusText', '');
              def('response', '');
              def('responseText', '');
              fire('readystatechange');
              fire('error');
              fire('loadend');
              return;
            }
            const type = String(xhr.responseType ?? '');
            def('readyState', 4);
            def('status', 200);
            def('statusText', 'OK');
            def('responseURL', ctx.url);
            if (type === '' || type === 'text') {
              def('responseText', body);
              def('response', body);
            } else if (type === 'json') {
              let parsed: any = null;
              try {
                parsed = body === '' ? null : JSON.parse(body);
              } catch {
                parsed = null;
              }
              def('response', parsed);
            } else {
              def('response', null);
            }
            fire('readystatechange');
            fire('load');
            fire('loadend');
          } catch {
            /* never throw into the page */
          }
        }, 1);
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
