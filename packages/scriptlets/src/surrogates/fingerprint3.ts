import { defineScriptlet } from '../_define';

/** Stub of fingerprintjs v3 (`FingerprintJS.load().get()`): one fixed visitor id. */
export default defineScriptlet({
  name: 'fingerprint3.js',
  aliases: ['fingerprintjs3', 'fingerprint3'],
  args: [],
  redirectResource: 'fingerprint3.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      const VISITOR_ID = '00000000000000000000000000000000';
      const result = {
        visitorId: VISITOR_ID,
        confidence: { score: 0.99, comment: '' },
        version: '3.4.2',
        components: {
          canvas: { value: { winding: false, geometry: '', text: '' }, duration: 0 },
          audio: { value: 0, duration: 0 },
          fonts: { value: [], duration: 0 },
        },
      };
      const agent = {
        get: function (): any {
          return Promise.resolve(result);
        },
      };
      const FingerprintJS: any = {
        defaultEndpoint: '',
        defaultScriptUrlPattern: '',
        hashComponents: function (): string {
          return VISITOR_ID;
        },
        componentsToDebugString: function (): string {
          return '{}';
        },
        load: function (): any {
          return Promise.resolve(agent);
        },
      };
      gt.FingerprintJS = FingerprintJS;
    } catch {
      /* never throw into the page */
    }
  },
});
