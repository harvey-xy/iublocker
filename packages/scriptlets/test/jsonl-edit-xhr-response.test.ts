import { describe, expect, it } from 'vitest';
import def from '../src/jsonl-edit-xhr-response';
import { inject, installXhrStub, makeWindow, tick } from './_inject';

const request = (win: any, url: string): void => {
  win.eval(`
    window.out = null;
    var x = new XMLHttpRequest();
    x.open('GET', ${JSON.stringify(url)});
    x.onload = function () { window.out = x.responseText; };
    x.send();
  `);
};

describe('jsonl-edit-xhr-response', () => {
  it('edits each JSON line independently', async () => {
    const win = makeWindow();
    installXhrStub(win, '{"node":{"__typename":"Ad"}}\n{"node":{"__typename":"Post"}}');
    inject(win, def, '..node[?.__typename=="Ad"]', 'propsToMatch', '/graphql');
    request(win, 'https://example.com/graphql');
    await tick(win, 20);
    const lines = String(win.out).split('\n');
    expect(JSON.parse(lines[0] as string)).toEqual({});
    expect(JSON.parse(lines[1] as string)).toEqual({ node: { __typename: 'Post' } });
  });

  it('keeps lines that are not JSON', async () => {
    const win = makeWindow();
    installXhrStub(win, 'header\n{"a":1}');
    inject(win, def, '.a');
    request(win, 'https://example.com/x');
    await tick(win, 20);
    expect(String(win.out).split('\n')[0]).toBe('header');
  });

  it('leaves unmatched requests alone', async () => {
    const win = makeWindow();
    installXhrStub(win, '{"a":1}');
    inject(win, def, '.a', 'propsToMatch', '/never');
    request(win, 'https://example.com/x');
    await tick(win, 20);
    expect(JSON.parse(win.out)).toEqual({ a: 1 });
  });
});
