import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'href-sanitizer',
  args: [
    { name: 'selector', doc: 'CSS selector matching the links to rewrite.' },
    {
      name: 'source',
      optional: true,
      doc: '`text`, `?param` (chainable: `?a?b`), `[attr]`; add ` -base64` to decode, or a trailing `/re/` to extract group 1.',
    },
    { name: 'attr', optional: true, doc: 'Attribute to write; defaults to `href`.' },
  ],
  fn: function (selector: string, source?: string, attr?: string) {
    try {
      const gt: any = globalThis;
      const doc: any = gt.document;
      if (doc === undefined || doc === null) return;
      if (typeof selector !== 'string' || selector.trim() === '') return;
      const sel = selector.trim();
      const target = typeof attr === 'string' && attr.trim() !== '' ? attr.trim() : 'href';

      let spec = typeof source === 'string' ? source.trim() : 'text';
      if (spec === '') spec = 'text';
      // A trailing `/regex/flags` extracts capture group 1 from the value found so far.
      let extract: RegExp | null = null;
      const reTail = /\s(\/(?:[^/\\]|\\.)+\/[a-z]*)$/.exec(spec);
      if (reTail !== null) {
        const m = /^\/(.+)\/([a-z]*)$/.exec(reTail[1] ?? '');
        if (m !== null) {
          try {
            extract = new RegExp(m[1] ?? '', (m[2] ?? '').replace(/g/g, ''));
          } catch {
            extract = null;
          }
        }
        spec = spec.slice(0, reTail.index).trim();
      }
      let base64 = false;
      if (/\s-base64$/.test(spec)) {
        base64 = true;
        spec = spec.replace(/\s-base64$/, '').trim();
      }

      const decode = (value: string): string => {
        let out = value;
        if (extract !== null) {
          const m = extract.exec(out);
          if (m === null) return '';
          out = m[1] ?? m[0] ?? '';
        }
        if (base64) {
          try {
            out = gt.atob(out.replace(/-/g, '+').replace(/_/g, '/'));
          } catch {
            return '';
          }
        }
        return out;
      };

      const fromParams = (href: string, chain: string[]): string => {
        let current = href;
        for (const key of chain) {
          let query = '';
          const q = current.indexOf('?');
          if (q !== -1) query = current.slice(q + 1);
          else if (current.indexOf('=') !== -1) query = current;
          else return '';
          let found: string | null = null;
          for (const pair of query.split('&')) {
            const eq = pair.indexOf('=');
            const k = eq === -1 ? pair : pair.slice(0, eq);
            if (k !== key) continue;
            found = eq === -1 ? '' : pair.slice(eq + 1);
            break;
          }
          if (found === null) return '';
          try {
            current = decodeURIComponent(found.replace(/\+/g, ' '));
          } catch {
            current = found;
          }
        }
        return current;
      };

      const read = (el: any): string => {
        try {
          if (spec === 'text') return String(el.textContent ?? '').trim();
          if (spec.startsWith('[') && spec.endsWith(']')) {
            return String(el.getAttribute(spec.slice(1, -1)) ?? '').trim();
          }
          if (spec.startsWith('?') || spec.startsWith('&')) {
            const chain = spec
              .split(/[?&]/)
              .map((s) => s.trim())
              .filter((s) => s !== '');
            if (chain.length === 0) return '';
            return fromParams(String(el.getAttribute('href') ?? ''), chain);
          }
          return String(el.getAttribute(spec) ?? '').trim();
        } catch {
          return '';
        }
      };

      const usable = (value: string): boolean => {
        if (value === '') return false;
        if (value.startsWith('/') && value.startsWith('//') === false) return true;
        return /^https?:\/\/\S+$/i.test(value);
      };

      const MARK = 'data-iub-href';
      const sanitize = (el: any): void => {
        try {
          if (el.getAttribute(MARK) !== null) return;
          const raw = read(el);
          if (raw === '') return;
          const out = decode(raw).trim();
          if (usable(out) === false) return;
          if (String(el.getAttribute(target) ?? '') === out) return;
          el.setAttribute(target, out);
          el.setAttribute(MARK, '1');
        } catch {
          /* node went away */
        }
      };
      const apply = (): void => {
        try {
          const list = doc.querySelectorAll(sel);
          for (let i = 0; i < list.length; i++) sanitize(list[i]);
        } catch {
          /* invalid selector */
        }
      };
      const start = (): void => {
        apply();
        try {
          const mo = new gt.MutationObserver(function () {
            apply();
          });
          mo.observe(doc.documentElement ?? doc, { childList: true, subtree: true, attributes: true });
        } catch {
          /* no MutationObserver */
        }
      };
      if (doc.readyState === 'loading') {
        apply();
        doc.addEventListener('DOMContentLoaded', start, { once: true });
      } else {
        start();
      }
    } catch {
      /* never throw into the page */
    }
  },
});
