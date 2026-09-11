import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'jsonl-edit-xhr-response',
  args: [
    {
      name: 'path',
      doc: 'uBO json-edit expression: a path, optionally followed by `=<json>` or `+=<json>`.',
    },
    {
      name: 'extra1',
      optional: true,
      doc: 'Positional `propsToMatch`, or the first `name, value` extra argument.',
    },
    { name: 'extra2', optional: true, doc: 'Value of `extra1` when it names an extra argument.' },
    { name: 'extra3', optional: true, doc: 'Second extra argument name.' },
    { name: 'extra4', optional: true, doc: 'Value of `extra3`.' },
  ],
  fn: function (path: string, ...extra: string[]) {
    try {
      const gt: any = globalThis;
      // ---- uBO json-edit path expression engine (duplicated per scriptlet on purpose) ----
      const scanBlock = (text: string, start: number): number => {
        let depth = 0;
        let quote = '';
        for (let i = start; i < text.length; i++) {
          const c = text.charAt(i);
          if (quote !== '') {
            if (c === '\\') {
              i += 1;
              continue;
            }
            if (c === quote) quote = '';
            continue;
          }
          if (c === '"' || c === "'") {
            quote = c;
            continue;
          }
          if (c === '[') depth += 1;
          else if (c === ']') {
            depth -= 1;
            if (depth === 0) return i + 1;
          }
        }
        return -1;
      };
      const parseLiteral = (raw: string): any => {
        const text = raw.trim();
        if (text === '') return '';
        try {
          return JSON.parse(text);
        } catch {
          /* not JSON */
        }
        if (text.length > 1 && text.startsWith("'") && text.endsWith("'")) {
          const inner = text.slice(1, -1);
          try {
            return JSON.parse(inner);
          } catch {
            return inner;
          }
        }
        return text;
      };
      const OPS = ['==', '!=', '*=', '^=', '$=', '>=', '<='];
      const parseSteps = (text: string): any[] | null => {
        const steps: any[] = [];
        let i = 0;
        while (i < text.length) {
          const c = text.charAt(i);
          if (c === '[') {
            const end = scanBlock(text, i);
            if (end === -1) return null;
            const inner = text.slice(i + 1, end - 1);
            if (inner.startsWith('?') === false) return null;
            const filter = parseFilter(inner.slice(1));
            if (filter === null) return null;
            steps.push(filter);
            i = end;
            continue;
          }
          if (c !== '.') return null;
          i += 1;
          let deep = false;
          if (text.charAt(i) === '.') {
            deep = true;
            i += 1;
          }
          let name = '';
          while (i < text.length) {
            const d = text.charAt(i);
            if (d === '.' || d === '[') break;
            name += d;
            i += 1;
          }
          if (name === '') {
            if (deep) steps.push({ kind: 'any', name: '', deep: true, sub: [], op: '', value: undefined });
            continue;
          }
          if (name === '*') steps.push({ kind: 'any', name: '', deep, sub: [], op: '', value: undefined });
          else steps.push({ kind: 'key', name, deep, sub: [], op: '', value: undefined });
        }
        return steps;
      };
      function parseFilter(body: string): any {
        let depth = 0;
        let quote = '';
        let opIndex = -1;
        let opText = '';
        for (let i = 0; i < body.length; i++) {
          const c = body.charAt(i);
          if (quote !== '') {
            if (c === '\\') {
              i += 1;
              continue;
            }
            if (c === quote) quote = '';
            continue;
          }
          if (c === '"' || c === "'") {
            quote = c;
            continue;
          }
          if (c === '[') depth += 1;
          else if (c === ']') depth -= 1;
          if (depth !== 0) continue;
          const two = body.slice(i, i + 2);
          if (OPS.indexOf(two) !== -1) {
            opIndex = i;
            opText = two;
            break;
          }
          if (c === '>' || c === '<') {
            opIndex = i;
            opText = c;
            break;
          }
        }
        const subText = (opIndex === -1 ? body : body.slice(0, opIndex)).trim();
        const sub = parseSteps(subText);
        if (sub === null) return null;
        if (opIndex === -1) return { kind: 'filter', name: '', deep: false, sub, op: '', value: undefined };
        return {
          kind: 'filter',
          name: '',
          deep: false,
          sub,
          op: opText,
          value: parseLiteral(body.slice(opIndex + opText.length)),
        };
      }
      const splitAction = (raw: string): any => {
        let depth = 0;
        let quote = '';
        for (let i = 0; i < raw.length; i++) {
          const c = raw.charAt(i);
          if (quote !== '') {
            if (c === '\\') {
              i += 1;
              continue;
            }
            if (c === quote) quote = '';
            continue;
          }
          if (c === '"' || c === "'") {
            quote = c;
            continue;
          }
          if (c === '[') depth += 1;
          else if (c === ']') depth -= 1;
          if (depth !== 0) continue;
          if (c === '+' && raw.charAt(i + 1) === '=') {
            return { path: raw.slice(0, i), op: '+=', value: parseLiteral(raw.slice(i + 2)) };
          }
          if (c === '=') return { path: raw.slice(0, i), op: '=', value: parseLiteral(raw.slice(i + 1)) };
        }
        return { path: raw, op: '', value: undefined };
      };
      const compare = (a: any, op: string, b: any): boolean => {
        try {
          const equal = a === b || String(a) === String(b);
          if (op === '==') return equal;
          if (op === '!=') return equal === false;
          if (op === '*=') return String(a).indexOf(String(b)) !== -1;
          if (op === '^=') return String(a).startsWith(String(b));
          if (op === '$=') return String(a).endsWith(String(b));
          if (op === '>') return Number(a) > Number(b);
          if (op === '<') return Number(a) < Number(b);
          if (op === '>=') return Number(a) >= Number(b);
          if (op === '<=') return Number(a) <= Number(b);
          return false;
        } catch {
          return false;
        }
      };
      const descend = (value: any, out: any[], depth: number): void => {
        out.push(value);
        if (value === null || typeof value !== 'object' || depth > 64) return;
        for (const k of Object.keys(value)) descend(value[k], out, depth + 1);
      };
      const applySteps = (locs: any[], steps: any[]): any[] => {
        let current = locs;
        for (const step of steps) {
          const next: any[] = [];
          for (const loc of current) {
            let value: any;
            try {
              value = loc.obj[loc.key];
            } catch {
              continue;
            }
            if (step.kind === 'filter') {
              if (matchFilter(value, step)) next.push(loc);
              continue;
            }
            const roots: any[] = [];
            if (step.deep) descend(value, roots, 0);
            else roots.push(value);
            for (const root of roots) {
              if (root === null || typeof root !== 'object') continue;
              if (step.kind === 'any') {
                for (const k of Object.keys(root)) next.push({ obj: root, key: k });
              } else if (Object.prototype.hasOwnProperty.call(root, step.name)) {
                next.push({ obj: root, key: step.name });
              }
            }
          }
          current = next;
          if (current.length === 0) return current;
        }
        return current;
      };
      function matchFilter(value: any, step: any): boolean {
        const box: any = { v: value };
        let locs: any[] = [];
        try {
          locs = applySteps([{ obj: box, key: 'v' }], step.sub);
        } catch {
          return false;
        }
        for (const loc of locs) {
          let v: any;
          try {
            v = loc.obj[loc.key];
          } catch {
            continue;
          }
          if (step.op === '') {
            if (v !== undefined) return true;
            continue;
          }
          if (compare(v, step.op, step.value)) return true;
        }
        return false;
      }
      const parsed = splitAction(String(path ?? '').trim());
      const steps = parseSteps(parsed.path.trim());
      if (steps === null || steps.length === 0) return;
      // Untrusted variants may only remove values, never write them.
      if (parsed.op !== '') return;
      const clone = (value: any): any => {
        if (value === undefined) return undefined;
        try {
          return JSON.parse(JSON.stringify(value));
        } catch {
          return value;
        }
      };
      const edit = (root: any): boolean => {
        if (root === null || typeof root !== 'object') return false;
        const box: any = { v: root };
        let locs: any[] = [];
        try {
          locs = applySteps([{ obj: box, key: 'v' }], steps);
        } catch {
          return false;
        }
        let changed = false;
        if (parsed.op === '') {
          const arrays = new Map<any, number[]>();
          for (const loc of locs) {
            if (loc.obj === box) continue;
            if (Array.isArray(loc.obj)) {
              const list = arrays.get(loc.obj) ?? [];
              list.push(Number(loc.key));
              arrays.set(loc.obj, list);
              continue;
            }
            try {
              if (Object.prototype.hasOwnProperty.call(loc.obj, loc.key)) {
                delete loc.obj[loc.key];
                changed = true;
              }
            } catch {
              /* frozen object */
            }
          }
          for (const [arr, indices] of arrays) {
            indices.sort((a, b) => b - a);
            for (const index of indices) {
              try {
                arr.splice(index, 1);
                changed = true;
              } catch {
                /* frozen array */
              }
            }
          }
          return changed;
        }
        for (const loc of locs) {
          if (loc.obj === box) continue;
          try {
            const target = loc.obj[loc.key];
            if (
              parsed.op === '+=' &&
              target !== null &&
              typeof target === 'object' &&
              parsed.value !== null &&
              typeof parsed.value === 'object'
            ) {
              Object.assign(target, clone(parsed.value));
            } else {
              loc.obj[loc.key] = clone(parsed.value);
            }
            changed = true;
          } catch {
            /* frozen object */
          }
        }
        return changed;
      };
      const opts: Record<string, string> = {};
      let positional = '';
      const known = ['propsToMatch', 'stack', 'logLevel', 'dontOverwrite'];
      if (extra.length === 1) {
        positional = String(extra[0] ?? '');
      } else if (extra.length > 0 && known.indexOf(String(extra[0] ?? '').trim()) === -1) {
        positional = String(extra[0] ?? '');
        for (let i = 1; i + 1 < extra.length; i += 2) {
          const k = String(extra[i] ?? '').trim();
          if (k !== '') opts[k] = String(extra[i + 1] ?? '');
        }
      } else {
        for (let i = 0; i + 1 < extra.length; i += 2) {
          const k = String(extra[i] ?? '').trim();
          if (k !== '') opts[k] = String(extra[i + 1] ?? '');
        }
      }
      const propsToMatch = opts['propsToMatch'] ?? positional;
      const toRe = (s: string): RegExp => {
        if (s === '' || s === '*') return /^/;
        const m = /^\/(.+)\/([a-z]*)$/.exec(s);
        if (m !== null) {
          try {
            return new RegExp(m[1] ?? '', (m[2] ?? '').replace(/g/g, ''));
          } catch {
            /* not a regex after all, treat as a literal */
          }
        }
        return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      };
      const needles: { key: string; re: RegExp; negate: boolean }[] = [];
      for (const tok of String(propsToMatch ?? '')
        .split(/\s+/)
        .filter((t) => t !== '')) {
        if (tok === '*') continue;
        let key = 'url';
        let value = tok;
        const i = tok.indexOf(':');
        if (
          i > 0 &&
          /^[a-zA-Z_][\w-]*$/.test(tok.slice(0, i)) &&
          tok.slice(i + 1).startsWith('//') === false
        ) {
          key = tok.slice(0, i);
          value = tok.slice(i + 1);
        }
        let negate = false;
        if (value.startsWith('!')) {
          negate = true;
          value = value.slice(1);
        }
        needles.push({ key, re: toRe(value), negate });
      }
      const matches = (details: Record<string, any>): boolean => {
        for (const n of needles) {
          const v = details[n.key];
          const hit = v === undefined ? false : n.re.test(String(v));
          if (hit === n.negate) return false;
        }
        return true;
      };
      const transform = (text: string): string => {
        const out: string[] = [];
        let changed = false;
        for (const line of text.split('\n')) {
          if (line.trim() === '') {
            out.push(line);
            continue;
          }
          let obj: any;
          try {
            obj = JSON.parse(line);
          } catch {
            out.push(line);
            continue;
          }
          if (edit(obj)) {
            changed = true;
            out.push(JSON.stringify(obj));
          } else {
            out.push(line);
          }
        }
        return changed ? out.join('\n') : text;
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
      const XHR: any = gt.XMLHttpRequest;
      if (typeof XHR !== 'function' || XHR.prototype === undefined) return;
      const ctxKey = Symbol.for('iub.xhrCtx');
      const bypass = Symbol.for('iub.xhrBypass');
      const origOpen = XHR.prototype.open;
      const origSend = XHR.prototype.send;
      XHR.prototype.open = keep(origOpen, function (this: any, method: any, url: any, ...rest: any[]): any {
        try {
          this[ctxKey] = { method: String(method ?? 'GET'), url: String(url ?? '') };
        } catch {
          /* frozen instance */
        }
        return origOpen.call(this, method, url, ...rest);
      });
      const handleSend = (xhr: any, args: any[]): any => {
        const ctx = xhr[ctxKey];
        if (ctx === undefined || xhr[bypass] === true) return origSend.apply(xhr, args);
        if (matches(ctx) === false) return origSend.apply(xhr, args);
        const def = (prop: string, value: any): void => {
          try {
            Object.defineProperty(xhr, prop, { value, configurable: true, writable: false });
          } catch {
            /* not shadowable */
          }
        };
        const fire = (name: string): void => {
          try {
            xhr.dispatchEvent(new gt.Event(name));
          } catch {
            /* no Event constructor */
          }
        };
        const inner = new XHR();
        inner[bypass] = true;
        inner.addEventListener('load', function () {
          let text = '';
          try {
            text = transform(String(inner.responseText ?? ''));
          } catch {
            text = String(inner.responseText ?? '');
          }
          def('readyState', 4);
          def('status', inner.status);
          def('statusText', inner.statusText);
          def('responseURL', ctx.url);
          const type = String(xhr.responseType ?? '');
          if (type === '' || type === 'text') {
            def('responseText', text);
            def('response', text);
          } else if (type === 'json') {
            let value: any = null;
            try {
              value = JSON.parse(text);
            } catch {
              value = null;
            }
            def('response', value);
          } else {
            def('response', inner.response);
          }
          fire('readystatechange');
          fire('load');
          fire('loadend');
        });
        inner.addEventListener('error', function () {
          def('readyState', 4);
          def('status', 0);
          fire('readystatechange');
          fire('error');
          fire('loadend');
        });
        try {
          inner.open(ctx.method, ctx.url, true);
          inner.send(...args);
        } catch {
          return origSend.apply(xhr, args);
        }
        return undefined;
      };
      XHR.prototype.send = keep(origSend, function (this: any, ...args: any[]): any {
        return handleSend(this, args);
      });
    } catch {
      /* never throw into the page */
    }
  },
});
