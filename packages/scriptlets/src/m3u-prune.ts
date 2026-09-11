import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'm3u-prune',
  args: [
    {
      name: 'pattern',
      doc: 'Literal matched against a playlist line, or a /regex/ applied to the whole playlist.',
    },
    { name: 'urlPattern', optional: true, doc: 'Literal or /regex/ the request URL must contain.' },
  ],
  fn: function (pattern: string, urlPattern?: string) {
    try {
      const gt: any = globalThis;
      if (typeof pattern !== 'string' || pattern.trim() === '') return;
      const toRe = (s: string | undefined, defaultFlags: string): RegExp | null => {
        const text = String(s ?? '').trim();
        if (text === '' || text === '*') return null;
        const m = /^\/(.+)\/([a-z]*)$/.exec(text);
        if (m !== null) {
          try {
            return new RegExp(m[1] ?? '', m[2] === '' ? defaultFlags : (m[2] as string));
          } catch {
            /* not a regex after all, treat as a literal */
          }
        }
        return null;
      };
      const reUrl = toRe(urlPattern, '');
      const rePattern = toRe(pattern, 'g');
      const literal = rePattern === null ? pattern.trim() : '';

      /** Drops the `#EXTINF`/`#EXT-X-…` header that introduces a removed segment line. */
      const pruneLines = (text: string): string => {
        const lines = text.split('\n');
        const drop = new Array<boolean>(lines.length).fill(false);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] as string;
          if (line.indexOf(literal) === -1) continue;
          drop[i] = true;
          for (let j = i - 1; j >= 0; j--) {
            const prev = (lines[j] as string).trim();
            if (prev === '') continue;
            if (prev.startsWith('#EXTINF') || prev.startsWith('#EXT-X-DISCONTINUITY')) {
              drop[j] = true;
              continue;
            }
            break;
          }
        }
        const out: string[] = [];
        for (let i = 0; i < lines.length; i++) if (drop[i] === false) out.push(lines[i] as string);
        return out.join('\n');
      };
      const transform = (text: string): string => {
        if (typeof text !== 'string' || text === '') return text;
        if (text.startsWith('#EXTM3U') === false && text.indexOf('#EXT-X-') === -1) return text;
        try {
          if (rePattern !== null) {
            rePattern.lastIndex = 0;
            return text.replace(rePattern, '');
          }
          return pruneLines(text);
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
          if (reUrl === null && urlPattern !== undefined && String(urlPattern).trim() !== '') {
            if (url.indexOf(String(urlPattern).trim()) === -1) return promise;
          }
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
          const url = String(ctx.url);
          if (reUrl !== null && reUrl.test(url) === false) return origSend.apply(xhr, args);
          if (reUrl === null && urlPattern !== undefined && String(urlPattern).trim() !== '') {
            if (url.indexOf(String(urlPattern).trim()) === -1) return origSend.apply(xhr, args);
          }
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
            def('responseText', text);
            def('response', text);
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
