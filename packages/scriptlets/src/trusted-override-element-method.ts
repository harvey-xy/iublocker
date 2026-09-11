import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'trusted-override-element-method',
  args: [
    { name: 'methodPath', doc: 'Prototype method chain, e.g. `HTMLAnchorElement.prototype.click`.' },
    {
      name: 'selector',
      optional: true,
      doc: 'Only neutralise the call when `this` matches this selector; empty means always.',
    },
    { name: 'disposition', optional: true, doc: '`empty` (default) returns undefined; `throw` throws.' },
  ],
  trusted: true,
  fn: function (methodPath: string, selector?: string, disposition?: string) {
    try {
      const gt: any = globalThis;
      if (typeof methodPath !== 'string' || methodPath === '') return;
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
      const mark = Symbol.for('iub.overrideMethod.' + methodPath);
      if (owner[mark] === true) return;
      const sel = typeof selector === 'string' ? selector.trim() : '';
      const throws = String(disposition ?? '').trim() === 'throw';
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
        let hit = sel === '';
        if (hit === false) {
          try {
            hit = this !== null && this !== undefined && typeof this.matches === 'function' && this.matches(sel);
          } catch {
            hit = false;
          }
        }
        if (hit === false) return orig.apply(this, args);
        if (throws) throw new ReferenceError(method);
        return undefined;
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
