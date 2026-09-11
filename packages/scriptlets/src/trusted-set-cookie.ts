import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-set-cookie',
  args: [
    { name: 'name', doc: 'Cookie name.' },
    { name: 'value', doc: 'Any value; `$now$` and `$currentDate$` expand to the current time.' },
    { name: 'offsetExpiresSec', optional: true, doc: 'Lifetime in seconds, or "1year" / "1day".' },
    { name: 'path', optional: true, doc: 'Cookie path, default "/".' },
  ],
  trusted: true,
  fn: function (name: string, value: string, offsetExpiresSec?: string, path?: string) {
    try {
      const doc: any = typeof document !== 'undefined' ? document : undefined;
      if (doc === undefined) return;
      if (typeof name !== 'string' || name === '') return;
      let out = typeof value === 'string' ? value : '';
      if (out === '$now$') out = String(Date.now());
      else if (out === '$currentDate$') out = new Date().toUTCString();
      else if (out === '$currentISODate$') out = new Date().toISOString();
      let seconds = 0;
      const off = typeof offsetExpiresSec === 'string' ? offsetExpiresSec.trim() : '';
      if (off === '1year') seconds = 31536000;
      else if (off === '1day') seconds = 86400;
      else if (off !== '') {
        const n = parseInt(off, 10);
        if (isNaN(n) === false) seconds = n;
      }
      let p = typeof path === 'string' && path !== '' ? path : '/';
      if (p === 'none') p = '';
      let cookie = encodeURIComponent(name) + '=' + encodeURIComponent(out);
      if (p !== '') cookie += '; path=' + p;
      if (seconds > 0) cookie += '; expires=' + new Date(Date.now() + seconds * 1000).toUTCString();
      doc.cookie = cookie;
    } catch {
      /* never throw into the page */
    }
  },
});
