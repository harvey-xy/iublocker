import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'set-cookie',
  args: [
    { name: 'name', doc: 'Cookie name.' },
    { name: 'value', doc: 'One of the uBO-approved consent values, or a number.' },
    { name: 'path', optional: true, doc: 'Cookie path, default "/".' },
    { name: 'extra1', optional: true, doc: 'Trailing `name, value` extra argument (`reload`, `domain`).' },
    { name: 'extra2', optional: true, doc: 'Value of `extra1`.' },
    { name: 'extra3', optional: true, doc: 'Second trailing extra argument name.' },
    { name: 'extra4', optional: true, doc: 'Value of `extra3`.' },
  ],
  fn: function (name: string, value: string, path?: string, ...extra: string[]) {
    try {
      const doc: any = typeof document !== 'undefined' ? document : undefined;
      if (doc === undefined) return;
      if (typeof name !== 'string' || name === '') return;
      const allowed = [
        'true',
        'false',
        'yes',
        'y',
        'no',
        'n',
        'ok',
        'on',
        'off',
        'accept',
        'accepted',
        'notaccepted',
        'reject',
        'rejected',
        'allow',
        'allowed',
        'deny',
        'denied',
        'refuse',
        'refused',
        'dismiss',
        'dismissed',
        'enable',
        'enabled',
        'disable',
        'disabled',
        'necessary',
        'required',
        'essential',
        'hide',
        'hidden',
        'forbidden',
        'none',
        'all',
        'consent',
        'granted',
        'emptystr',
      ];
      const opts: Record<string, string> = {};
      for (let i = 0; i + 1 < extra.length; i += 2) {
        const k = String(extra[i] ?? '').trim();
        if (k !== '') opts[k] = String(extra[i + 1] ?? '').trim();
      }
      const raw = typeof value === 'string' ? value : '';
      if (raw === '$remove$') {
        try {
          let gone = encodeURIComponent(name) + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
          const gp = typeof path === 'string' && path !== '' && path !== 'none' ? path : '/';
          gone += '; path=' + gp;
          if (opts['domain'] !== undefined && opts['domain'] !== '') gone += '; domain=' + opts['domain'];
          doc.cookie = gone;
        } catch {
          /* cookies disabled */
        }
        return;
      }
      const lower = raw.toLowerCase();
      let out: string | null = null;
      if (allowed.indexOf(lower) !== -1) out = lower === 'emptystr' ? '' : raw;
      else if (/^-?\d+$/.test(raw) && Math.abs(parseInt(raw, 10)) <= 32767) out = raw;
      if (out === null) return;
      let p = typeof path === 'string' && path !== '' ? path : '/';
      if (p === 'none') p = '';
      let cookie = encodeURIComponent(name) + '=' + encodeURIComponent(out);
      if (p !== '') cookie += '; path=' + p;
      if (opts['domain'] !== undefined && opts['domain'] !== '') cookie += '; domain=' + opts['domain'];
      const encName = encodeURIComponent(name);
      const already = String(doc.cookie ?? '')
        .split(';')
        .some(function (part: string) {
          const kv = part.trim();
          return kv.startsWith(encName + '=') && kv.slice(encName.length + 1) === encodeURIComponent(out);
        });
      doc.cookie = cookie;
      if (already || String(opts['reload'] ?? '') !== '1') return;
      // Reload at most once per document so a rejected cookie cannot loop.
      const gt: any = globalThis;
      const flag = Symbol.for('iub.setCookieReloaded');
      if (gt[flag] === true) return;
      gt[flag] = true;
      try {
        if (gt.location !== undefined && typeof gt.location.reload === 'function') gt.location.reload();
      } catch {
        /* navigation blocked */
      }
    } catch {
      /* never throw into the page */
    }
  },
});
