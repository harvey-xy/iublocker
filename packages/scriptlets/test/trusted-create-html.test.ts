import { describe, expect, it } from 'vitest';
import def from '../src/trusted-create-html';
import { inject, makeWindow, tick } from './_inject';

describe('trusted-create-html', () => {
  it('appends the fragment to the parent', () => {
    const win = makeWindow();
    inject(win, def, 'body', '<div id="decoy"></div>');
    expect(win.document.getElementById('decoy')).not.toBeNull();
  });

  it('inserts once per parent', () => {
    const win = makeWindow();
    inject(win, def, 'body', '<span class="x"></span>');
    inject(win, def, 'body', '<span class="x"></span>');
    expect(win.document.querySelectorAll('span.x').length).toBe(1);
  });

  it('waits for a parent that appears later', async () => {
    const win = makeWindow();
    inject(win, def, '#host', '<i id="in"></i>');
    win.document.body.insertAdjacentHTML('beforeend', '<div id="host"></div>');
    await tick(win, 20);
    expect(win.document.getElementById('in')).not.toBeNull();
  });

  it('removes the fragment again after `durationMs`', async () => {
    const win = makeWindow();
    inject(win, def, 'body', '<b id="temp"></b>', '10');
    expect(win.document.getElementById('temp')).not.toBeNull();
    await tick(win, 40);
    expect(win.document.getElementById('temp')).toBeNull();
  });

  it('ignores an empty fragment', () => {
    const win = makeWindow();
    inject(win, def, 'body', '');
    expect(win.document.body.children.length).toBe(0);
  });
});
