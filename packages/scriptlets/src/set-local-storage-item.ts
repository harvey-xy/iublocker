import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'set-local-storage-item',
  args: [
    { name: 'key', doc: 'Storage key to write.' },
    { name: 'value', doc: 'A uBO value keyword, a number, or `$remove$` to delete the key.' },
  ],
  fn: function (key: string, value: string) {
    try {
      const gt: any = globalThis;
      if (typeof key !== 'string' || key === '') return;
      const store: any = gt.localStorage;
      if (store === undefined || store === null) return;
      if (value === '$remove$') {
        try {
          store.removeItem(key);
        } catch {
          /* storage unavailable */
        }
        return;
      }
      let out: string | null = null;
      switch (value) {
        case 'undefined':
        case 'false':
        case 'true':
        case 'null':
        case 'yes':
        case 'no':
        case 'on':
        case 'off':
        case 'accept':
        case 'accepted':
        case 'reject':
        case 'rejected':
        case 'allow':
        case 'allowed':
        case 'deny':
        case 'denied':
          out = value;
          break;
        case 'emptyObj':
          out = '{}';
          break;
        case 'emptyArr':
          out = '[]';
          break;
        case 'emptyStr':
        case "''":
        case '':
          out = '';
          break;
        default:
          if (/^-?\d+$/.test(value)) {
            const n = parseInt(value, 10);
            if (isNaN(n) === false && Math.abs(n) <= 32767) out = String(n);
          }
          break;
      }
      if (out === null) return;
      try {
        store.setItem(key, out);
      } catch {
        /* quota exceeded or storage disabled */
      }
    } catch {
      /* never throw into the page */
    }
  },
});
