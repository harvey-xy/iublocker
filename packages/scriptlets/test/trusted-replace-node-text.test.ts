import { describe, expect, it } from 'vitest';
import def from '../src/trusted-replace-node-text';
import { inject, makeWindow, tick } from './_inject';

const page = (body: string): string => `<!doctype html><html><body>${body}</body></html>`;

describe('trusted-replace-node-text', () => {
  it('replaces arbitrary text in a matching element', () => {
    const win = makeWindow(page('<script id="s">openNewTab("ad")</script>'));
    inject(win, def, 'script', '/openNewTab\\(".*?"\\)/g', 'null');
    expect(win.document.getElementById('s').textContent).toBe('null');
  });

  it('honours a trailing `condition` extra argument', () => {
    const win = makeWindow(page('<script id="a">keep me</script><script id="b">drop ad here</script>'));
    inject(win, def, 'script', 'drop', 'kept', 'condition', 'ad');
    expect(win.document.getElementById('a').textContent).toBe('keep me');
    expect(win.document.getElementById('b').textContent).toBe('kept ad here');
  });

  it('honours the legacy positional condition', () => {
    const win = makeWindow(page('<script id="s">x ad y</script>'));
    inject(win, def, 'script', 'ad', 'no', 'zzz');
    expect(win.document.getElementById('s').textContent).toBe('x ad y');
  });

  it('caps the number of edits with `sedCount`', async () => {
    const win = makeWindow(page('<script id="a">ad</script>'));
    inject(win, def, 'script', 'ad', 'no', 'sedCount', '1');
    expect(win.document.getElementById('a').textContent).toBe('no');
    win.document.body.insertAdjacentHTML('beforeend', '<script id="b">ad</script>');
    await tick(win, 20);
    expect(win.document.getElementById('b').textContent).toBe('ad');
  });

  it('is marked trusted and answers to `trusted-rpnt`', () => {
    expect(def.trusted).toBe(true);
    expect(def.aliases).toContain('trusted-rpnt');
  });
});
