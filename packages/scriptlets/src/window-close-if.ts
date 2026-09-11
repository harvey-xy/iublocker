import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'window-close-if',
  args: [
    {
      name: 'pattern',
      optional: true,
      doc: 'Literal or /regex/ matched against the frame URL; `!` negates. Empty always closes.',
    },
  ],
  fn: function (pattern?: string) {
    try {
      const gt: any = globalThis;
      let raw = typeof pattern === 'string' ? pattern.trim() : '';
      let negate = false;
      if (raw.startsWith('!')) {
        negate = true;
        raw = raw.slice(1);
      }
      let matched: boolean;
      if (raw === '') {
        matched = true;
      } else {
        const m = /^\/(.+)\/([a-z]*)$/.exec(raw);
        let href = '';
        try {
          href = String(gt.location === undefined ? '' : gt.location.href);
        } catch {
          href = '';
        }
        if (m !== null) {
          let re: RegExp | null = null;
          try {
            re = new RegExp(m[1] ?? '', m[2]);
          } catch {
            re = null;
          }
          matched = re === null ? href.indexOf(raw) !== -1 : re.test(href);
        } else {
          matched = href.indexOf(raw) !== -1;
        }
      }
      if (matched === negate) return;
      try {
        if (typeof gt.close === 'function') gt.close();
      } catch {
        /* the browser may refuse to close a non-script-opened window */
      }
    } catch {
      /* never throw into the page */
    }
  },
});
