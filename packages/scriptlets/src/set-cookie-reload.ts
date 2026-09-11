import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'set-cookie-reload',
  args: [
    { name: 'name', doc: 'Cookie name.' },
    { name: 'value', doc: 'One of the uBO-approved consent values, or a number.' },
    { name: 'path', optional: true, doc: 'Cookie path, default "/".' },
  ],
  fn: function (name: string, value: string, path?: string) {
    try {
      const gt: any = globalThis;
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
      const raw = typeof value === 'string' ? value : '';
      const lower = raw.toLowerCase();
      let out: string | null = null;
      if (allowed.indexOf(lower) !== -1) out = lower === 'emptystr' ? '' : raw;
      else if (/^-?\d+$/.test(raw) && Math.abs(parseInt(raw, 10)) <= 32767) out = raw;
      if (out === null) return;
      const encName = encodeURIComponent(name);
      const encValue = encodeURIComponent(out);
      const already = String(doc.cookie ?? '')
        .split(';')
        .some(function (part: string) {
          const kv = part.trim();
          return kv.startsWith(encName + '=') && kv.slice(encName.length + 1) === encValue;
        });
      let p = typeof path === 'string' && path !== '' ? path : '/';
      if (p === 'none') p = '';
      let cookie = encName + '=' + encValue;
      if (p !== '') cookie += '; path=' + p;
      doc.cookie = cookie;
      if (already) return;
      // Reload at most once per document so a rejected cookie cannot loop.
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
