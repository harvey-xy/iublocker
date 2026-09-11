import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'disable-newtab-links',
  args: [],
  fn: function () {
    try {
      const gt: any = globalThis;
      const doc: any = typeof document !== 'undefined' ? document : undefined;
      if (doc === undefined) return;
      const flag = Symbol.for('iub.disableNewtabLinks');
      if (gt[flag] === true) return;
      gt[flag] = true;
      doc.addEventListener(
        'click',
        function (ev: any) {
          try {
            let node: any = ev.target;
            while (node !== null && node !== undefined) {
              if (
                typeof node.localName === 'string' &&
                node.localName === 'a' &&
                node.hasAttribute('target')
              ) {
                ev.stopPropagation();
                ev.preventDefault();
                break;
              }
              node = node.parentNode;
            }
          } catch {
            /* never break the page's click handling */
          }
        },
        true,
      );
    } catch {
      /* never throw into the page */
    }
  },
});
