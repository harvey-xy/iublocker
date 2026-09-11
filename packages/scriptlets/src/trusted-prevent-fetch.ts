import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-prevent-fetch',
  args: [
    {
      name: 'propsToMatch',
      optional: true,
      doc: 'Space-separated `key:pattern` pairs; a bare token matches the URL.',
    },
    { name: 'responseBody', optional: true, doc: 'Any literal body, or one of the uBO keywords.' },
    {
      name: 'responseProps',
      optional: true,
      doc: 'JSON object of extra response properties, e.g. `{"type": "cors"}`.',
    },
  ],
  trusted: true,
  fn: function (propsToMatch?: string, responseBody?: string, responseProps?: string) {
    try {
      const gt: any = globalThis;
      if (typeof gt.fetch !== 'function') return;
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
        // `https://host/path` must stay a URL pattern, `method:HEAD` must not.
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
      switch (responseBody) {
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
        default: {
          const raw = String(responseBody);
          const m = /^length:(\d+)$/.exec(raw);
          body = m === null ? raw : ' '.repeat(Math.min(parseInt(m[1] ?? '0', 10), 65536));
          break;
        }
      }
      let props: Record<string, any> = {};
      try {
        const raw = String(responseProps ?? '').trim();
        if (raw !== '') {
          const parsed = JSON.parse(raw);
          if (parsed !== null && typeof parsed === 'object') props = parsed;
        }
      } catch {
        /* not JSON: ignore the extra properties */
      }
      const makeResponse = (url: string): any => {
        if (typeof gt.Response === 'function') {
          const r = new gt.Response(body, {
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Length': String(body.length) },
          });
          try {
            Object.defineProperty(r, 'url', { value: url });
          } catch {
            /* read-only in some engines */
          }
          for (const k of Object.keys(props)) {
            try {
              Object.defineProperty(r, k, { value: props[k], configurable: true });
            } catch {
              /* read-only in some engines */
            }
          }
          return r;
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          url,
          type: 'basic',
          headers: { get: () => null },
          text: () => Promise.resolve(body),
          json: () => Promise.resolve(body === '' ? null : JSON.parse(body)),
          clone() {
            return this;
          },
        };
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
      const orig = gt.fetch;
      gt.fetch = keep(orig, function (this: any, input?: any, init?: any, ...rest: any[]): any {
        let url = '';
        const details: any = { method: 'GET' };
        try {
          if (typeof input === 'string') {
            url = input;
          } else if (input !== null && input !== undefined && typeof input.url === 'string') {
            url = input.url;
            if (typeof input.method === 'string') details.method = input.method;
          } else {
            url = String(input ?? '');
          }
          if (init !== null && typeof init === 'object') {
            for (const k of Object.keys(init)) details[k] = (init as any)[k];
          }
          details.url = url;
          details.method = String(details.method ?? 'GET');
        } catch {
          /* matching must never break the page */
        }
        // No needles (empty or `*`) means "every request", as in uBO.
        let matched = true;
        for (const n of needles) {
          const v = n.key === 'url' ? url : details[n.key];
          const hit = v === undefined ? false : n.re.test(String(v));
          if (hit === n.negate) {
            matched = false;
            break;
          }
        }
        if (matched) return Promise.resolve(makeResponse(url));
        return orig.call(this === undefined ? gt : this, input, init, ...rest);
      });
    } catch {
      /* never throw into the page */
    }
  },
});
