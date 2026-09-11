import { defineScriptlet } from '../_define';

export default defineScriptlet({
  name: 'fuckadblock.js-3.2.0',
  args: [],
  redirectResource: 'fuckadblock.js-3.2.0',
  fn: function () {
    try {
      const gt: any = globalThis;
      const noop = function () {
        /* noop */
      };
      const makeFab = (): any => {
        const fab: any = {};
        const self0 = function () {
          return fab;
        };
        fab.check = function () {
          // The page asked whether an ad blocker is present: answer "no".
          try {
            for (const cb of fab.onNotDetectedCallbacks) cb();
          } catch {
            /* the page's own callback threw */
          }
          return fab;
        };
        fab.onNotDetectedCallbacks = [];
        fab.clearEvent = self0;
        fab.emitEvent = function () {
          return fab.check();
        };
        fab.on = function (detected: any, cb: any) {
          if (detected === false && typeof cb === 'function') fab.onNotDetectedCallbacks.push(cb);
          return fab;
        };
        fab.onDetected = self0;
        fab.onNotDetected = function (cb: any) {
          if (typeof cb === 'function') fab.onNotDetectedCallbacks.push(cb);
          return fab.check();
        };
        fab.setOption = self0;
        fab.options = { set: self0 };
        return fab;
      };
      const Ctor: any = function (this: any) {
        return makeFab();
      };
      Ctor.prototype = { check: noop, on: noop, onDetected: noop, onNotDetected: noop, setOption: noop };
      const instance = makeFab();
      for (const name of ['FuckAdBlock', 'BlockAdBlock', 'SniffAdBlock']) {
        try {
          Object.defineProperty(gt, name, { value: Ctor, writable: true, configurable: true });
        } catch {
          gt[name] = Ctor;
        }
      }
      for (const name of ['fuckAdBlock', 'blockAdBlock', 'sniffAdBlock']) {
        try {
          Object.defineProperty(gt, name, { value: instance, writable: true, configurable: true });
        } catch {
          gt[name] = instance;
        }
      }
    } catch {
      /* never throw into the page */
    }
  },
});
