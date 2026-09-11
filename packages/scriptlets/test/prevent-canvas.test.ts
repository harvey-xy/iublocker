import { describe, expect, it } from 'vitest';
import def from '../src/prevent-canvas';
import { inject, makeWindow } from './_inject';

describe('prevent-canvas', () => {
  const install = (win: any): void => {
    win.eval('window.HTMLCanvasElement.prototype.getContext = function (t) { return { id: t }; };');
  };

  it('refuses the named context type', () => {
    const win = makeWindow();
    install(win);
    inject(win, def, '2d');
    expect(win.eval('document.createElement("canvas").getContext("2d")')).toBeNull();
    expect(win.eval('document.createElement("canvas").getContext("webgl").id')).toBe('webgl');
  });

  it('refuses every type when no argument is given', () => {
    const win = makeWindow();
    install(win);
    inject(win, def);
    expect(win.eval('document.createElement("canvas").getContext("webgl")')).toBeNull();
  });

  it('honours `!` negation', () => {
    const win = makeWindow();
    install(win);
    inject(win, def, '!2d');
    expect(win.eval('document.createElement("canvas").getContext("2d").id')).toBe('2d');
    expect(win.eval('document.createElement("canvas").getContext("webgl")')).toBeNull();
  });

  it('is idempotent', () => {
    const win = makeWindow();
    install(win);
    inject(win, def, '2d');
    const first = win.HTMLCanvasElement.prototype.getContext;
    inject(win, def, '2d');
    expect(win.HTMLCanvasElement.prototype.getContext).toBe(first);
  });
});
