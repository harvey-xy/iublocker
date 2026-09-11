import { defineScriptlet } from '../_define';

/** Stub of fingerprintjs v2: always reports the same fixed fingerprint. */
export default defineScriptlet({
  name: 'fingerprint2.js',
  aliases: ['fingerprintjs2', 'fingerprint2'],
  args: [],
  redirectResource: 'fingerprint2.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const components = [
        { key: 'canvas', value: 'unsupported' },
        { key: 'webgl', value: 'unsupported' },
        { key: 'audio', value: 'unsupported' },
      ];
      const HASH = '00000000000000000000000000000000';
      const Fingerprint2: any = function (this: any): void {
        /* the constructor form is still used by older integrations */
      };
      Fingerprint2.get = function (options: any, callback?: any): any {
        const cb = typeof options === 'function' ? options : callback;
        if (typeof cb !== 'function') return undefined;
        try {
          cb(components);
        } catch {
          /* the page's own callback threw */
        }
        return undefined;
      };
      Fingerprint2.getPromise = function (): any {
        return Promise.resolve(components);
      };
      Fingerprint2.getV18 = function (options: any, callback?: any): any {
        const cb = typeof options === 'function' ? options : callback;
        if (typeof cb !== 'function') return undefined;
        try {
          cb(HASH, components);
        } catch {
          /* the page's own callback threw */
        }
        return undefined;
      };
      Fingerprint2.x64hash128 = function (): string {
        return HASH;
      };
      Fingerprint2.VERSION = '2.1.4';
      Fingerprint2.prototype = {
        get: Fingerprint2.get,
        getPromise: Fingerprint2.getPromise,
        getV18: Fingerprint2.getV18,
      };
      gt.Fingerprint2 = Fingerprint2;
      gt.Fingerprint = Fingerprint2;
    } catch {
      /* never throw into the page */
    }
  },
});
