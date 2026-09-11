import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'doubleclick_instream_ad_status.js',
  args: [],
  redirectResource: 'doubleclick_instream_ad_status.js',
  fn: function () {
    try {
      const gt: any = globalThis;
      gt.google_ad_status = 1;
    } catch {
      /* never throw into the page */
    }
  },
});
