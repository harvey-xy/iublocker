import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-set-cookie',
  args: [
    { name: 'name', doc: 'Cookie name.' },
    { name: 'value', doc: 'Any value; `$now$` and `$currentDate$` expand to the current time.' },
    { name: 'offsetExpiresSec', optional: true, doc: 'Lifetime in seconds, or "1year" / "1day".' },
    { name: 'path', optional: true, doc: 'Cookie path, default "/".' },
    { name: 'extra1', optional: true, doc: 'Trailing `name, value` extra argument (`reload`, `domain`).' },
    { name: 'extra2', optional: true, doc: 'Value of `extra1`.' },
    { name: 'extra3', optional: true, doc: 'Second trailing extra argument name.' },
    { name: 'extra4', optional: true, doc: 'Value of `extra3`.' },
  ],
  trusted: true,
  fn: function (
    name: string,
    value: string,
    offsetExpiresSec?: string,
    path?: string,
    ...extra: string[]
  ) {
    try {
      const doc: any = typeof document !== 'undefined' ? document : undefined;
      if (doc === undefined) return;
      if (typeof name !== 'string' || name === '') return;
      const opts: Record<string, string> = {};
      for (let i = 0; i + 1 < extra.length; i += 2) {
        const k = String(extra[i] ?? '').trim();
        if (k !== '') opts[k] = String(extra[i + 1] ?? '').trim();
      }
      let out = typeof value === 'string' ? value : '';
      const remove = out === '$remove$';
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
      let cookie = encodeURIComponent(name) + '=' + encodeURIComponent(remove ? '' : out);
      if (p !== '') cookie += '; path=' + p;
      if (opts['domain'] !== undefined && opts['domain'] !== '') cookie += '; domain=' + opts['domain'];
      if (remove) cookie += '; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      else if (seconds > 0) cookie += '; expires=' + new Date(Date.now() + seconds * 1000).toUTCString();
      doc.cookie = cookie;
      if (String(opts['reload'] ?? '') !== '1') return;
      const gt: any = globalThis;
      const flag = Symbol.for('iub.trustedSetCookieReloaded');
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
