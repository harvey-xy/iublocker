import { describe, expect, it } from 'vitest';
import def from '../src/href-sanitizer';
import { inject, makeWindow, tick } from './_inject';

const page = (body: string): string => `<!doctype html><html><body>${body}</body></html>`;

describe('href-sanitizer', () => {
  it('lifts the real URL out of a query parameter', () => {
    const win = makeWindow(page('<a id="a" href="/r?url=https%3A%2F%2Fexample.org%2Fx">go</a>'));
    inject(win, def, 'a[href^="/r?"]', '?url');
    expect(win.document.getElementById('a').getAttribute('href')).toBe('https://example.org/x');
  });

  it('decodes a base64 parameter with `-base64`', () => {
    const encoded = Buffer.from('https://example.org/deep').toString('base64');
    const win = makeWindow(page(`<a id="a" href="/go?u=${encoded}">go</a>`));
    inject(win, def, 'a[href^="/go"]', '?u -base64');
    expect(win.document.getElementById('a').getAttribute('href')).toBe('https://example.org/deep');
  });

  it('reads an attribute with the `[attr]` form', () => {
    const win = makeWindow(page('<a id="a" href="/visit/1" title="https://example.org/t">go</a>'));
    inject(win, def, 'a[href^="/visit/"]', '[title]');
    expect(win.document.getElementById('a').getAttribute('href')).toBe('https://example.org/t');
  });

  it('reads the link text by default', () => {
    const win = makeWindow(page('<a id="a" href="/track">https://example.org/text</a>'));
    inject(win, def, 'a[href="/track"]');
    expect(win.document.getElementById('a').getAttribute('href')).toBe('https://example.org/text');
  });

  it('chains two parameters', () => {
    const inner = encodeURIComponent('https://cdn.example.org/?u=https%3A%2F%2Ffinal.example');
    const win = makeWindow(page(`<a id="a" href="/c?q=${inner}">go</a>`));
    inject(win, def, 'a[href^="/c"]', '?q?u');
    expect(win.document.getElementById('a').getAttribute('href')).toBe('https://final.example');
  });

  it('leaves a link alone when the value is not a URL', () => {
    const win = makeWindow(page('<a id="a" href="/r?url=notaurl">go</a>'));
    inject(win, def, 'a[href^="/r?"]', '?url');
    expect(win.document.getElementById('a').getAttribute('href')).toBe('/r?url=notaurl');
  });

  it('sanitizes links added later', async () => {
    const win = makeWindow(page(''));
    inject(win, def, 'a[href^="/r?"]', '?url');
    win.document.body.insertAdjacentHTML(
      'beforeend',
      '<a id="late" href="/r?url=https%3A%2F%2Flate.example">go</a>',
    );
    await tick(win, 20);
    expect(win.document.getElementById('late').getAttribute('href')).toBe('https://late.example');
  });
});
