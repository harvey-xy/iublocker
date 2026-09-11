import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'set-cookie',
  args: [
    { name: 'name', doc: 'Cookie name.' },
    { name: 'value', doc: 'One of the uBO-approved consent values, or a number.' },
    { name: 'path', optional: true, doc: 'Cookie path, default "/".' },
  ],
  fn: function (name: string, value: string, path?: string) {
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
      const raw = typeof value === 'string' ? value : '';
      const lower = raw.toLowerCase();
      let out: string | null = null;
      if (allowed.indexOf(lower) !== -1) out = lower === 'emptystr' ? '' : raw;
      else if (/^-?\d+$/.test(raw) && Math.abs(parseInt(raw, 10)) <= 32767) out = raw;
      if (out === null) return;
      let p = typeof path === 'string' && path !== '' ? path : '/';
      if (p === 'none') p = '';
      let cookie = encodeURIComponent(name) + '=' + encodeURIComponent(out);
      if (p !== '') cookie += '; path=' + p;
      doc.cookie = cookie;
    } catch {
      /* never throw into the page */
    }
  },
});
