import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'prevent-innerHTML',
  args: [
    {
      name: 'selector',
      optional: true,
      doc: 'Only guard elements matching this selector (a bare tag name works); empty means all.',
    },
    {
      name: 'pattern',
      optional: true,
      doc: 'Literal or /regex/ the assigned HTML must match; `!` negates. Empty matches everything.',
    },
  ],
  fn: function (selector?: string, pattern?: string) {
    try {
      const gt: any = globalThis;
      const El: any = gt.Element;
      if (typeof El !== 'function' || El.prototype === undefined) return;
      const desc = Object.getOwnPropertyDescriptor(El.prototype, 'innerHTML');
      if (desc === undefined || typeof desc.set !== 'function' || desc.configurable === false) return;
      const mark = Symbol.for('iub.preventInnerHTML');
      if ((El.prototype as any)[mark] === true) return;
      const sel = typeof selector === 'string' ? selector.trim() : '';
      let raw = typeof pattern === 'string' ? pattern.trim() : '';
      let negate = false;
      if (raw.startsWith('!')) {
        negate = true;
        raw = raw.slice(1);
      }
      let re: RegExp | null = null;
      if (raw !== '') {
        const m = /^\/(.+)\/([a-z]*)$/.exec(raw);
        if (m !== null) {
          try {
            re = new RegExp(m[1] ?? '', (m[2] ?? '').replace(/g/g, ''));
          } catch {
            re = null;
          }
        }
        if (re === null) re = new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      }
      const origSet = desc.set;
      const origGet = desc.get;
      const blocked = function (this: any, value: any): boolean {
        try {
          if (sel !== '') {
            if (typeof this.matches !== 'function') return false;
            if (this.matches(sel) === false) return false;
          }
          if (re === null) return negate === false;
          return re.test(String(value ?? '')) !== negate;
        } catch {
          return false;
        }
      };
      const next: PropertyDescriptor = {
        configurable: true,
        enumerable: desc.enumerable === true,
        set(this: any, value: any) {
          if (blocked.call(this, value)) return;
          origSet.call(this, value);
        },
      };
      if (typeof origGet === 'function') {
        next.get = function (this: any): any {
          return origGet.call(this);
        };
      }
      Object.defineProperty(El.prototype, 'innerHTML', next);
      try {
        Object.defineProperty(El.prototype, mark, { value: true, configurable: true });
      } catch {
        /* sealed prototype */
      }
    } catch {
      /* never throw into the page */
    }
  },
});
