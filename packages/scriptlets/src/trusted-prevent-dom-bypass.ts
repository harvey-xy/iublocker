import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-prevent-dom-bypass',
  args: [
    {
      name: 'methodPath',
      doc: 'DOM insertion method to hook, e.g. `Node.prototype.appendChild` or `Element.prototype.append`.',
    },
    {
      name: 'propToBypass',
      doc: 'Property chain copied from this window into a freshly inserted same-origin frame.',
    },
  ],
  trusted: true,
  fn: function (methodPath: string, propToBypass: string) {
    try {
      const gt: any = globalThis;
      if (typeof methodPath !== 'string' || methodPath === '') return;
      if (typeof propToBypass !== 'string' || propToBypass === '') return;
      const parts = methodPath.split('.');
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

      // Several calls may hook the same method for different properties: keep a list.
      const listKey = '__iub_dombypass';
      let props: string[] = gt[listKey];
      if (props === undefined) {
        props = [];
        gt[listKey] = props;
      }
      if (props.indexOf(propToBypass) === -1) props.push(propToBypass);
      const mark = Symbol.for('iub.domBypass.' + methodPath);
      if (owner[mark] === true) return;

      const seed = (frameWindow: any): void => {
        for (const chain of props) {
          try {
            const segments = chain.split('.');
            const last = segments.pop() ?? '';
            if (last === '') continue;
            let source: any = gt;
            let target: any = frameWindow;
            let ok = true;
            for (const segment of segments) {
              source = source === null || source === undefined ? undefined : source[segment];
              target = target === null || target === undefined ? undefined : target[segment];
              if (source === undefined || target === undefined) {
                ok = false;
                break;
              }
            }
            if (ok === false || target === null || target === undefined) continue;
            const value = source === null || source === undefined ? undefined : source[last];
            if (value === undefined) continue;
            if (typeof value === 'function') {
              Object.defineProperty(target, last, { value, configurable: true, writable: true });
              continue;
            }
            // A non-function (e.g. `XMLHttpRequest.prototype`): copy its own properties over.
            const current = target[last];
            if (current === null || typeof current !== 'object') {
              Object.defineProperty(target, last, { value, configurable: true, writable: true });
              continue;
            }
            for (const key of Object.getOwnPropertyNames(value)) {
              if (key === 'constructor') continue;
              const desc = Object.getOwnPropertyDescriptor(value, key);
              if (desc === undefined) continue;
              try {
                Object.defineProperty(current, key, desc);
              } catch {
                /* non-configurable on the frame side */
              }
            }
          } catch {
            /* cross-origin frame or frozen target */
          }
        }
      };
      const handle = (node: any): void => {
        try {
          if (node === null || node === undefined) return;
          if (String(node.tagName ?? '').toUpperCase() !== 'IFRAME') return;
          const frameWindow = node.contentWindow;
          if (frameWindow === null || frameWindow === undefined) return;
          seed(frameWindow);
        } catch {
          /* cross-origin frame */
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
      const patched = function (this: any, ...args: any[]): any {
        const out = orig.apply(this, args);
        for (const arg of args) handle(arg);
        return out;
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
