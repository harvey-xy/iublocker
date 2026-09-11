import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-replace-argument',
  args: [
    { name: 'propChain', doc: 'Function to wrap, e.g. `Element.prototype.setAttribute` or `JSON.parse`.' },
    { name: 'argpos', doc: 'Zero-based argument index, or the literal `this`.' },
    {
      name: 'value',
      doc: '`json:<literal>`, `repl:/pattern/replacement/`, `undefined`, `{"value": …}`, or a plain string.',
    },
    { name: 'extra1', optional: true, doc: 'Trailing `name, value` extra argument (`condition`).' },
    { name: 'extra2', optional: true, doc: 'Value of `extra1`.' },
    { name: 'extra3', optional: true, doc: 'Second trailing extra argument name.' },
    { name: 'extra4', optional: true, doc: 'Value of `extra3`.' },
    { name: 'extra5', optional: true, doc: 'Third trailing extra argument name.' },
    { name: 'extra6', optional: true, doc: 'Value of `extra5`.' },
    { name: 'extra7', optional: true, doc: 'Fourth trailing extra argument name.' },
  ],
  trusted: true,
  fn: function (propChain: string, argpos: string, value: string, ...extra: string[]) {
    try {
      const gt: any = globalThis;
      if (typeof propChain !== 'string' || propChain === '') return;
      const parts = propChain.split('.');
      const method = parts.pop() ?? '';
      if (method === '') return;
      let owner: any = gt;
      for (const part of parts) {
        if (owner === null || owner === undefined) return;
        owner = owner[part];
      }
      if (owner === null || owner === undefined) return;
      const orig = owner[method];
      if (typeof orig !== 'function') return;
      const mark = Symbol.for('iub.replaceArgument.' + propChain + '#' + String(argpos));
      if (owner[mark] === true) return;

      const opts: Record<string, string> = {};
      for (let i = 0; i + 1 < extra.length; i += 2) {
        const k = String(extra[i] ?? '').trim();
        if (k !== '') opts[k] = String(extra[i + 1] ?? '');
      }

      const toRe = (s: string): RegExp | null => {
        const text = s.trim();
        if (text === '') return null;
        const m = /^\/(.+)\/([a-z]*)$/.exec(text);
        if (m !== null) {
          try {
            return new RegExp(m[1] ?? '', (m[2] ?? '').replace(/g/g, ''));
          } catch {
            /* not a regex after all, treat as a literal */
          }
        }
        return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      };
      let conditionRaw = opts['condition'] ?? '';
      if (
        conditionRaw.length > 1 &&
        ((conditionRaw.startsWith("'") && conditionRaw.endsWith("'")) ||
          (conditionRaw.startsWith('"') && conditionRaw.endsWith('"')))
      ) {
        conditionRaw = conditionRaw.slice(1, -1);
      }
      const condition = toRe(conditionRaw);

      const targetThis = String(argpos).trim() === 'this';
      const index = targetThis ? -1 : parseInt(String(argpos), 10);
      if (targetThis === false && (isNaN(index) || index < 0)) return;

      // `repl:/pattern/replacement/` rewrites the original argument instead of replacing it.
      let replRe: RegExp | null = null;
      let replWith = '';
      const raw = typeof value === 'string' ? value : '';
      if (raw.startsWith('repl:')) {
        const body = raw.slice(5);
        const m = /^\/((?:[^/\\]|\\.)*)\/((?:[^/\\]|\\.)*)\/([a-z]*)$/.exec(body);
        if (m !== null) {
          try {
            replRe = new RegExp(m[1] ?? '', m[3] === '' ? 'g' : (m[3] as string));
            replWith = m[2] ?? '';
          } catch {
            replRe = null;
          }
        }
        if (replRe === null) return;
      }

      const NOT_SET = Symbol('unset');
      const decode = (): any => {
        if (replRe !== null) return NOT_SET;
        if (raw === 'undefined') return undefined;
        if (raw === '') return '';
        if (raw.startsWith('json:')) {
          try {
            return JSON.parse(raw.slice(5));
          } catch {
            return NOT_SET;
          }
        }
        if (raw.startsWith('{') && raw.endsWith('}')) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed !== null && typeof parsed === 'object' && 'value' in parsed) return parsed.value;
            return parsed;
          } catch {
            /* not JSON: fall through to the literal */
          }
        }
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        if (raw === 'null') return null;
        if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
        if (raw.length > 1 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
        if (raw.length > 1 && raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
        return raw;
      };
      const replacement = decode();
      if (replacement === NOT_SET && replRe === null) return;

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

      const patched = function (this: any, ...args: any[]): any {
        let self0: any = this;
        try {
          const subject = targetThis ? self0 : args[index];
          let matches = true;
          if (condition !== null) {
            let text = '';
            try {
              text = typeof subject === 'string' ? subject : String(subject);
            } catch {
              text = '';
            }
            matches = condition.test(text);
          }
          if (matches) {
            let next: any;
            if (replRe !== null) {
              let text = '';
              try {
                text = typeof subject === 'string' ? subject : String(subject);
              } catch {
                text = '';
              }
              replRe.lastIndex = 0;
              next = text.replace(replRe, replWith);
            } else {
              next = replacement;
            }
            if (targetThis) self0 = next;
            else args[index] = next;
          }
        } catch {
          /* leave the call untouched */
        }
        return orig.apply(self0, args);
      };
      nmap.set(patched, orig);
      try {
        Object.defineProperty(owner, method, { value: patched, configurable: true, writable: true });
        Object.defineProperty(owner, mark, { value: true, configurable: true });
      } catch {
        /* non-configurable */
      }
    } catch {
      /* never throw into the page */
    }
  },
});
