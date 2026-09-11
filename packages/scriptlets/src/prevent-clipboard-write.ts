import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'prevent-clipboard-write',
  args: [
    {
      name: 'pattern',
      doc: 'Literal or /regex/ matched against the text being copied; `!` negates. Empty matches everything.',
    },
    { name: 'extra1', optional: true, doc: 'Trailing `name, value` extra argument; accepted and ignored.' },
    { name: 'extra2', optional: true, doc: 'Value of `extra1`.' },
    { name: 'extra3', optional: true, doc: 'Second trailing extra argument name.' },
    { name: 'extra4', optional: true, doc: 'Value of `extra3`.' },
  ],
  fn: function (pattern: string, ..._extra: string[]) {
    try {
      const gt: any = globalThis;
      const doc: any = gt.document;
      let raw = typeof pattern === 'string' ? pattern.trim() : '';
      let negate = false;
      if (raw.startsWith('!')) {
        negate = true;
        raw = raw.slice(1);
      }
      let re: RegExp = /^/;
      if (raw !== '' && raw !== '*') {
        const m = /^\/(.+)\/([a-z]*)$/.exec(raw);
        let built: RegExp | null = null;
        if (m !== null) {
          try {
            built = new RegExp(m[1] ?? '', (m[2] ?? '').replace(/g/g, ''));
          } catch {
            built = null;
          }
        }
        re = built ?? new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      }
      const blocked = (text: any): boolean => {
        try {
          return re.test(String(text ?? '')) !== negate;
        } catch {
          return false;
        }
      };

      const nk = Symbol.for('iub.nativeMap');
      let nmap: WeakMap<any, any> = gt[nk];
      if (nmap === undefined) {
        nmap = new WeakMap();
        gt[nk] = nmap;
        const ots = Function.prototype.toString;
        const pts = function (this: any): string {
          return ots.call(nmap.get(this) ?? this);
        };
        nmap.set(pts, ots);
        Function.prototype.toString = pts;
      }
      const keep = (o: any, p: any): any => {
        nmap.set(p, o);
        return p;
      };

      const clipboard: any = gt.navigator === undefined ? undefined : gt.navigator.clipboard;
      if (clipboard !== undefined && clipboard !== null && typeof clipboard.writeText === 'function') {
        const mark = Symbol.for('iub.preventClipboardWrite');
        if (clipboard[mark] !== true) {
          const origWriteText = clipboard.writeText;
          try {
            clipboard.writeText = keep(origWriteText, function (this: any, text: any): any {
              if (blocked(text)) return Promise.resolve();
              return origWriteText.call(this, text);
            });
            Object.defineProperty(clipboard, mark, { value: true, configurable: true });
          } catch {
            /* read-only clipboard object */
          }
        }
      }

      if (doc !== undefined && doc !== null && typeof doc.execCommand === 'function') {
        const mark = Symbol.for('iub.preventExecCopy');
        if ((doc as any)[mark] !== true) {
          const origExec = doc.execCommand;
          try {
            doc.execCommand = keep(origExec, function (this: any, command: any, ...rest: any[]): any {
              const name = String(command ?? '').toLowerCase();
              if (name === 'copy' || name === 'cut') {
                let text = '';
                try {
                  text = String(gt.getSelection === undefined ? '' : gt.getSelection());
                } catch {
                  text = '';
                }
                if (blocked(text)) return false;
              }
              return origExec.call(this, command, ...rest);
            });
            Object.defineProperty(doc, mark, { value: true, configurable: true });
          } catch {
            /* read-only document */
          }
        }
      }

      // A page can also write through the `copy` event's clipboardData.
      try {
        doc.addEventListener(
          'copy',
          function (ev: any) {
            try {
              const data = ev.clipboardData;
              if (data === null || data === undefined) return;
              const text = data.getData === undefined ? '' : data.getData('text/plain');
              if (blocked(text) === false) return;
              ev.preventDefault();
              ev.stopImmediatePropagation();
            } catch {
              /* nothing to inspect */
            }
          },
          true,
        );
      } catch {
        /* no event target */
      }
    } catch {
      /* never throw into the page */
    }
  },
});
