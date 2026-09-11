import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'remove-cookie',
  aliases: ['cookie-remover'],
  args: [
    { name: 'name', optional: true, doc: 'Literal or /regex/ matched against cookie names.' },
    { name: 'extra1', optional: true, doc: 'Trailing `name, value` extra argument (`when`).' },
    { name: 'extra2', optional: true, doc: 'Value of `extra1`.' },
    { name: 'extra3', optional: true, doc: 'Further extra argument name.' },
    { name: 'extra4', optional: true, doc: 'Value of `extra3`.' },
  ],
  fn: function (name: string, ...extra: string[]) {
    try {
      const gt: any = globalThis;
      const doc: any = typeof document !== 'undefined' ? document : undefined;
      if (doc === undefined) return;
      const toRe = (s: string): RegExp | null => {
        if (typeof s !== 'string' || s === '') return null;
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
      const re = toRe(name);
      if (re === null) return;
      const opts: Record<string, string> = {};
      for (let i = 0; i + 1 < extra.length; i += 2) {
        const k = String(extra[i] ?? '').trim();
        if (k !== '') opts[k] = String(extra[i + 1] ?? '');
      }
      const expire = (key: string): void => {
        const host = String(gt.location !== undefined ? (gt.location.hostname ?? '') : '');
        const domains: string[] = [''];
        if (host !== '') {
          domains.push(host);
          const parts = host.split('.');
          for (let i = 1; i < parts.length - 1; i++) domains.push('.' + parts.slice(i).join('.'));
        }
        const paths = ['/', ''];
        for (const d of domains) {
          for (const p of paths) {
            let c = key + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
            if (p !== '') c += '; path=' + p;
            if (d !== '') c += '; domain=' + d;
            try {
              doc.cookie = c;
            } catch {
              /* cookies disabled */
            }
          }
        }
      };
      const sweep = (): void => {
        try {
          for (const part of String(doc.cookie ?? '').split(';')) {
            const kv = part.trim();
            if (kv === '') continue;
            const eq = kv.indexOf('=');
            const key = eq === -1 ? kv : kv.slice(0, eq);
            let plain = key;
            try {
              plain = decodeURIComponent(key);
            } catch {
              /* keep the raw name */
            }
            if (re.test(key) || re.test(plain)) expire(key);
          }
        } catch {
          /* cookies unavailable */
        }
      };
      sweep();
      try {
        gt.addEventListener('beforeunload', sweep);
      } catch {
        /* no event target */
      }
      // `when` re-sweeps on the named DOM events, e.g. `when, scroll keydown`.
      for (const type of String(opts['when'] ?? '')
        .split(/\s+/)
        .filter((t) => t !== '')) {
        try {
          gt.addEventListener(type, sweep, { passive: true });
        } catch {
          /* no event target */
        }
      }
    } catch {
      /* never throw into the page */
    }
  },
});
