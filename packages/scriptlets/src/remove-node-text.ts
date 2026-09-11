import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'remove-node-text',
  aliases: ['rmnt'],
  args: [
    {
      name: 'nodeName',
      doc: 'Literal or /regex/ matched against the element name (`#text` for text nodes).',
    },
    { name: 'includes', doc: 'Only empty nodes whose text matches this literal or /regex/.' },
    {
      name: 'excludes',
      optional: true,
      doc: 'Legacy positional form; also settable as a trailing `excludes, <value>` pair.',
    },
    {
      name: 'extra1',
      optional: true,
      doc: 'Trailing `name, value` extra argument (`excludes`, `condition`, `stay`).',
    },
    { name: 'extra2', optional: true, doc: 'Value of `extra1`.' },
    { name: 'extra3', optional: true, doc: 'Further extra argument name.' },
    { name: 'extra4', optional: true, doc: 'Value of `extra3`.' },
    { name: 'extra5', optional: true, doc: 'Further extra argument name.' },
  ],
  fn: function (nodeName: string, includes: string, ...extra: string[]) {
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
      const KNOWN = ['excludes', 'condition', 'stay', 'log'];
      const opts: Record<string, string> = {};
      if (extra.length === 1 && KNOWN.indexOf(String(extra[0] ?? '').trim()) === -1) {
        opts['excludes'] = String(extra[0] ?? '');
      } else {
        for (let i = 0; i + 1 < extra.length; i += 2) {
          const k = String(extra[i] ?? '').trim();
          if (k !== '') opts[k] = String(extra[i + 1] ?? '');
        }
      }
      const reIncludes = toRe(opts['condition'] ?? includes, '');
      const reExcludes = toRe(opts['excludes'], '');
      const handle = (node: any): void => {
        try {
          const text: string = String(node.textContent ?? '');
          if (text === '') return;
          if (reIncludes !== null && reIncludes.test(text) === false) return;
          if (reExcludes !== null && reExcludes.test(text)) return;
          node.textContent = '';
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
