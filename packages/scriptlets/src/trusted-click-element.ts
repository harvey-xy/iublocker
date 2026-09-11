import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-click-element',
  args: [
    {
      name: 'selectors',
      doc: 'Comma-separated selectors clicked in order; a bare number is a pause in ms before the next one.',
    },
    {
      name: 'extraMatch',
      optional: true,
      doc: 'Comma-separated `cookie:name` / `localStorage:key` guards; `!` negates.',
    },
    { name: 'delay', optional: true, doc: 'Milliseconds to wait before the first click (default 0).' },
    { name: 'reload', optional: true, doc: 'Accepted for uBO compatibility; ignored.' },
  ],
  trusted: true,
  fn: function (selectors: string, extraMatch?: string, delay?: string, _reload?: string) {
    try {
      const gt: any = globalThis;
      const doc: any = gt.document;
      if (doc === undefined || doc === null) return;
      if (typeof selectors !== 'string' || selectors.trim() === '') return;

      // Split on commas that are not inside brackets, parentheses or quotes.
      const split = (text: string): string[] => {
        const out: string[] = [];
        let depth = 0;
        let quote = '';
        let current = '';
        for (let i = 0; i < text.length; i++) {
          const c = text.charAt(i);
          if (quote !== '') {
            current += c;
            if (c === '\\') {
              current += text.charAt(i + 1);
              i += 1;
            } else if (c === quote) quote = '';
            continue;
          }
          if (c === '"' || c === "'") {
            quote = c;
            current += c;
            continue;
          }
          if (c === '[' || c === '(') depth += 1;
          else if (c === ']' || c === ')') depth -= 1;
          if (c === ',' && depth <= 0) {
            out.push(current.trim());
            current = '';
            continue;
          }
          current += c;
        }
        out.push(current.trim());
        return out.filter((s) => s !== '');
      };

      const guards = split(String(extraMatch ?? ''));
      for (const guard of guards) {
        let raw = guard;
        let negate = false;
        if (raw.startsWith('!')) {
          negate = true;
          raw = raw.slice(1);
        }
        const colon = raw.indexOf(':');
        if (colon === -1) continue;
        const kind = raw.slice(0, colon).trim();
        const key = raw.slice(colon + 1).trim();
        let present = false;
        try {
          if (kind === 'cookie') {
            present = String(doc.cookie ?? '')
              .split(';')
              .some(function (p: string) {
                return p.trim().startsWith(encodeURIComponent(key) + '=') || p.trim().startsWith(key + '=');
              });
          } else if (kind === 'localStorage') {
            present = gt.localStorage !== undefined && gt.localStorage.getItem(key) !== null;
          } else {
            continue;
          }
        } catch {
          present = false;
        }
        if (present === negate) return;
      }

      const steps = split(selectors);
      if (steps.length === 0) return;
      const start = (() => {
        const n = parseInt(String(delay ?? ''), 10);
        return isNaN(n) || n < 0 ? 0 : n;
      })();

      const clicked = new Set<string>();
      const run = (index: number): void => {
        if (index >= steps.length) return;
        const step = steps[index] ?? '';
        if (/^\d+$/.test(step)) {
          gt.setTimeout(
            function () {
              run(index + 1);
            },
            parseInt(step, 10),
          );
          return;
        }
        const deadline = Date.now() + 10000;
        const attempt = (): void => {
          let el: any = null;
          try {
            el = doc.querySelector(step);
          } catch {
            return;
          }
          if (el !== null && clicked.has(step) === false) {
            clicked.add(step);
            try {
              el.click();
            } catch {
              /* not clickable */
            }
            run(index + 1);
            return;
          }
          if (Date.now() >= deadline) return;
          gt.setTimeout(attempt, 100);
        };
        attempt();
      };
      gt.setTimeout(function () {
        run(0);
      }, start);
    } catch {
      /* never throw into the page */
    }
  },
});
