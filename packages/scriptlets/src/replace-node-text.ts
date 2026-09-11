import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'replace-node-text',
  aliases: ['rpnt'],
  args: [
    {
      name: 'nodeName',
      doc: 'Literal or /regex/ matched against the element name (`#text` for text nodes).',
    },
    { name: 'pattern', doc: 'Literal or /regex/ to replace inside the node text.' },
    { name: 'replacement', optional: true, doc: 'Replacement text; defaults to the empty string.' },
    {
      name: 'condition',
      optional: true,
      doc: 'Only touch nodes whose text also matches this literal or /regex/.',
    },
  ],
  fn: function (nodeName: string, pattern: string, replacement?: string, condition?: string) {
    try {
      const gt: any = globalThis;
      const doc: any = typeof document !== 'undefined' ? document : undefined;
      if (doc === undefined) return;
      const toRe = (s: string | undefined, flags: string): RegExp | null => {
        if (s === undefined || s === '') return null;
        if (s === '*') return /^/;
        const m = /^\/(.+)\/([a-z]*)$/.exec(s);
        if (m !== null) {
          try {
            return new RegExp(m[1] ?? '', m[2] === '' ? flags : (m[2] as string));
          } catch {
            /* not a regex after all, treat as a literal */
          }
        }
        return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      };
      const reName = toRe(nodeName, '');
      if (reName === null) return;
      const rePattern = toRe(pattern, 'g');
      const reCondition = toRe(condition, '');
      const repl = typeof replacement === 'string' ? replacement : '';
      const handle = (node: any): void => {
        try {
          const text: string = String(node.textContent ?? '');
          if (text === '') return;
          if (reCondition !== null && reCondition.test(text) === false) return;
          let out: string;
          if (rePattern === null) {
            out = repl;
          } else {
            rePattern.lastIndex = 0;
            if (rePattern.test(text) === false) return;
            rePattern.lastIndex = 0;
            out = text.replace(rePattern, repl);
          }
          if (out !== text) node.textContent = out;
        } catch {
          /* node went away */
        }
      };
      const matchesName = (node: any): boolean => {
        if (node.nodeType === 3) return reName.test('#text');
        if (node.nodeType !== 1) return false;
        return reName.test(String(node.localName ?? ''));
      };
      const scan = (root: any): void => {
        try {
          if (root === null || root === undefined) return;
          if (matchesName(root)) handle(root);
          if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
          if (reName.test('#text')) {
            const walker = doc.createTreeWalker(root, 4);
            let n = walker.nextNode();
            while (n !== null) {
              handle(n);
              n = walker.nextNode();
            }
          }
          const els = root.querySelectorAll === undefined ? [] : root.querySelectorAll('*');
          for (let i = 0; i < els.length; i++) {
            if (matchesName(els[i])) handle(els[i]);
          }
        } catch {
          /* malformed subtree */
        }
      };
      const start = (): void => {
        scan(doc.documentElement ?? doc);
      };
      try {
        const mo = new gt.MutationObserver(function (records: any[]) {
          for (const r of records) {
            if (r.type === 'characterData') {
              if (matchesName(r.target)) handle(r.target);
              else if (r.target.parentNode !== null && matchesName(r.target.parentNode))
                handle(r.target.parentNode);
              continue;
            }
            const added = r.addedNodes;
            for (let i = 0; i < added.length; i++) scan(added[i]);
          }
        });
        mo.observe(doc.documentElement ?? doc, { childList: true, subtree: true, characterData: true });
      } catch {
        /* no MutationObserver */
      }
      start();
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
    } catch {
      /* never throw into the page */
    }
  },
});
