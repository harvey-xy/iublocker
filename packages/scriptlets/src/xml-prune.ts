import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'xml-prune',
  args: [
    {
      name: 'selector',
      doc: 'CSS selector, or `xpath(<expression>)`, of the nodes/attributes to drop from the XML.',
    },
    {
      name: 'selectorCheck',
      optional: true,
      doc: 'Only prune when this selector (or xpath) also matches; empty means always.',
    },
    { name: 'urlPattern', optional: true, doc: 'Literal or /regex/ the request URL must contain.' },
  ],
  fn: function (selector: string, selectorCheck?: string, urlPattern?: string) {
    try {
      const gt: any = globalThis;
      if (typeof selector !== 'string' || selector.trim() === '') return;
      const DP: any = gt.DOMParser;
      const XS: any = gt.XMLSerializer;
      if (typeof DP !== 'function' || typeof XS !== 'function') return;

      const unquote = (s: string): string => {
        const t = s.trim();
        if (t.length > 1 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
        if (t.length > 1 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
        return t;
      };
      const toRe = (s: string | undefined): RegExp | null => {
        const text = String(s ?? '').trim();
        if (text === '' || text === '*') return null;
        const m = /^\/(.+)\/([a-z]*)$/.exec(text);
        if (m !== null) {
          try {
            return new RegExp(m[1] ?? '', (m[2] ?? '').replace(/g/g, ''));
          } catch {
            /* not a regex after all, treat as a literal */
          }
        }
        return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      };
      const reUrl = toRe(urlPattern);

      const asXpath = (raw: string): string | null => {
        const text = unquote(raw);
        const m = /^xpath\(([\s\S]+)\)$/.exec(text);
        return m === null ? null : (m[1] ?? '').trim();
      };
      const pruneSel = unquote(selector);
      const pruneXpath = asXpath(selector);
      const checkRaw = unquote(String(selectorCheck ?? ''));
      const checkXpath = checkRaw === '' ? null : asXpath(String(selectorCheck ?? ''));

      const matchesCheck = (doc: any): boolean => {
        if (checkRaw === '') return true;
        try {
          if (checkXpath !== null) {
            const r = doc.evaluate(checkXpath, doc, null, 7, null);
            return r.snapshotLength > 0;
          }
          return doc.querySelector(checkRaw) !== null;
        } catch {
          return false;
        }
      };
      const dropNode = (node: any): void => {
        try {
          if (node === null || node === undefined) return;
          // Attribute node (xpath `…/@attr`).
          if (node.nodeType === 2) {
            const el = node.ownerElement;
            if (el !== null && el !== undefined) el.removeAttribute(node.name);
            return;
          }
          if (node.parentNode !== null && node.parentNode !== undefined) node.parentNode.removeChild(node);
        } catch {
          /* already detached */
        }
      };
      const transform = (text: string): string => {
        if (text === '' || text.indexOf('<') === -1) return text;
        let doc: any;
        try {
          doc = new DP().parseFromString(text, 'text/xml');
        } catch {
          return text;
        }
        if (doc === null || doc === undefined) return text;
        try {
          if (doc.querySelector('parsererror') !== null) return text;
        } catch {
          /* some engines expose no parsererror element */
        }
        if (matchesCheck(doc) === false) return text;
        let changed = false;
        try {
          if (pruneXpath !== null) {
            const r = doc.evaluate(pruneXpath, doc, null, 7, null);
            const nodes: any[] = [];
            for (let i = 0; i < r.snapshotLength; i++) nodes.push(r.snapshotItem(i));
            for (const n of nodes) {
              dropNode(n);
              changed = true;
            }
          } else {
            const list = doc.querySelectorAll(pruneSel);
            for (let i = 0; i < list.length; i++) {
              dropNode(list[i]);
              changed = true;
            }
          }
        } catch {
          return text;
        }
        if (changed === false) return text;
        try {
          return new XS().serializeToString(doc);
        } catch {
          return text;
        }
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

      if (typeof gt.fetch === 'function' && typeof gt.Response === 'function') {
        const origFetch = gt.fetch;
        gt.fetch = keep(origFetch, function (this: any, input?: any, init?: any, ...rest: any[]): any {
          let url = '';
          try {
            url =
              typeof input === 'string'
                ? input
                : input !== null && input !== undefined && typeof input.url === 'string'
                  ? input.url
                  : String(input ?? '');
          } catch {
            url = '';
          }
          const promise = origFetch.call(this === undefined ? gt : this, input, init, ...rest);
          if (reUrl !== null && reUrl.test(url) === false) return promise;
          return promise.then((resp: any) => {
            if (resp === null || resp === undefined || typeof resp.text !== 'function') return resp;
            return resp
              .clone()
              .text()
              .then((text: string) => {
                const out = transform(text);
                if (out === text) return resp;
                const next = new gt.Response(out, {
                  status: resp.status,
                  statusText: resp.statusText,
                  headers: resp.headers,
                });
                try {
                  Object.defineProperty(next, 'url', { value: resp.url });
                } catch {
                  /* read-only in some engines */
                }
                return next;
              })
              .catch(() => resp);
          });
        });
      }

      const XHR: any = gt.XMLHttpRequest;
      if (typeof XHR === 'function' && XHR.prototype !== undefined) {
        const ctxKey = Symbol.for('iub.xhrCtx');
        const bypass = Symbol.for('iub.xhrBypass');
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
          if (ctx === undefined || xhr[bypass] === true) return origSend.apply(xhr, args);
          if (reUrl !== null && reUrl.test(String(ctx.url)) === false) return origSend.apply(xhr, args);
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
              text = transform(String(inner.responseText ?? ''));
            } catch {
              text = String(inner.responseText ?? '');
            }
            def('readyState', 4);
            def('status', inner.status);
            def('statusText', inner.statusText);
            def('responseURL', ctx.url);
            const type = String(xhr.responseType ?? '');
            if (type === '' || type === 'text') {
              def('responseText', text);
              def('response', text);
            } else if (type === 'document') {
              let parsed: any = null;
              try {
                parsed = new DP().parseFromString(text, 'text/xml');
              } catch {
                parsed = null;
              }
              def('response', parsed);
              def('responseXML', parsed);
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
      }
    } catch {
      /* never throw into the page */
    }
  },
});
