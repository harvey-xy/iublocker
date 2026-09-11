import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-set-local-storage-item',
  args: [
    { name: 'key', doc: 'Storage key to write.' },
    { name: 'value', doc: 'Any string; `$remove$` deletes the key, `$currentDate$` writes an ISO timestamp.' },
  ],
  trusted: true,
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
      let out = typeof value === 'string' ? value : '';
      if (out === '$currentDate$') out = new Date().toISOString();
      else if (out === '$now$') out = String(Date.now());
      else if (out === 'emptyObj') out = '{}';
      else if (out === 'emptyArr') out = '[]';
      else if (out === 'emptyStr' || out === "''") out = '';
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
