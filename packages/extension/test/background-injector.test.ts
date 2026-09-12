import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CosmeticDB, CosmeticLookup, ScriptletCall, ScriptletDB } from '@iublocker/shared';

vi.mock('@iublocker/compiler', () => ({
  lookupCosmetic: (dbs: CosmeticDB[], hostname: string): CosmeticLookup => ({
    selectors: dbs.flatMap((db) => db.specific[hostname] ?? []),
    styles: dbs.flatMap((db) => db.styles[hostname] ?? []),
    procedural: [],
    elemhide: hostname === 'noads.test',
    generichide: false,
    specifichide: false,
    excluded: [],
  }),
  lookupScriptlets: (dbs: ScriptletDB[], hostname: string): ScriptletCall[] =>
    dbs.flatMap((db) => db.byHost[hostname] ?? []),
  mergeCosmeticDB: (a: CosmeticDB) => a,
  mergeScriptletDB: (a: ScriptletDB) => a,
  compileUserFilters: () => ({ dnr: [], cosmetic: null, scriptlets: null, warnings: [] }),
}));

const { fakeScriptlet } = vi.hoisted(() => ({
  fakeScriptlet: function setConstant() {
    /* injected into the page MAIN world */
  },
}));

vi.mock('@iublocker/scriptlets', () => {
  const def = { name: 'set-constant', aliases: ['set'], args: [], trusted: false, fn: fakeScriptlet };
  return {
    registry: { 'set-constant': def },
    resolveScriptlet: (name: string) => (name === 'set-constant' || name === 'set' ? def : undefined),
    redirectResources: {},
  };
});

import * as injector from '../src/background/injector';
import * as store from '../src/background/storage/store';
import {
  makeCosmeticDB,
  makeListEntry,
  makeRulesetManifest,
  makeScriptletDB,
  resetBackground,
  stubFetch,
} from './background-utils';

const manifest = makeRulesetManifest({ lists: [makeListEntry('easylist')] });

let chromeMock: ReturnType<typeof resetBackground>;

function setup() {
  chromeMock = resetBackground();
  stubFetch({
    'rulesets/manifest.json': manifest,
    'rulesets/cosmetic/easylist.json': makeCosmeticDB('easylist', {
      specific: { 'example.com': ['.ad', '.banner'], 'frame.test': ['.frame-ad'] },
      styles: { 'example.com': [['.promo', 'opacity:0.1!important']] },
    }),
    'rulesets/scriptlets/easylist.json': makeScriptletDB('easylist'),
  });
  chromeMock._state.addTab({ id: 7, url: 'https://example.com/page' });
}

describe('injector: CSS building', () => {
  it('chunks selectors and groups :style rules', () => {
    const selectors = Array.from({ length: 2_500 }, (_, i) => `.ad${i}`);
    const chunks = injector.buildCssChunks(selectors, [
      ['.a', 'opacity:0'],
      ['.b', 'opacity:0'],
      ['.c', 'height:0'],
    ]);
    expect(chunks).toHaveLength(4); // 3 hiding chunks + 1 style chunk
    expect(chunks[0]?.split(',')).toHaveLength(injector.MAX_SELECTORS_PER_CHUNK);
    expect(chunks[0]?.endsWith('{display:none!important;}')).toBe(true);
    expect(chunks[3]).toBe('.a,.b{opacity:0}\n.c{height:0}');
  });

  it('dedupes and ignores empty input', () => {
    expect(injector.buildCssChunks([], [])).toEqual([]);
    expect(injector.buildCssChunks(['.a', '.a'], [])).toEqual(['.a{display:none!important;}']);
  });
});

describe('injector: onCommitted', () => {
  beforeEach(setup);

  it('injects specific CSS with origin USER for the committed frame', async () => {
    await injector.handleCommitted({ tabId: 7, frameId: 0, url: 'https://example.com/page' });
    const [call] = chromeMock._state.calls.insertCSS;
    expect(call).toMatchObject({ target: { tabId: 7, frameIds: [0] }, origin: 'USER' });
    expect(call.css).toContain('.ad,.banner');
    expect(chromeMock._state.calls.insertCSS[1].css).toContain('opacity:0.1!important');
    expect(injector.wasInjected(7, 0, 'example.com')).toBe(true);
  });

  it('does nothing below optimal', async () => {
    await store.set({ siteModes: { 'example.com': 'basic' } });
    await injector.handleCommitted({ tabId: 7, frameId: 0, url: 'https://example.com/page' });
    expect(chromeMock._state.calls.insertCSS).toHaveLength(0);
    expect(chromeMock._state.calls.executeScript).toHaveLength(0);
  });

  it('skips non-http frames', async () => {
    await injector.handleCommitted({ tabId: 7, frameId: 0, url: 'about:blank' });
    expect(chromeMock._state.calls.insertCSS).toHaveLength(0);
  });

  it('respects $elemhide', async () => {
    chromeMock._state.addTab({ id: 9, url: 'https://noads.test/' });
    await injector.handleCommitted({ tabId: 9, frameId: 0, url: 'https://noads.test/' });
    expect(chromeMock._state.calls.insertCSS).toHaveLength(0);
  });

  it('uses the top-level hostname mode for sub-frames', async () => {
    await store.set({ siteModes: { 'example.com': 'off' } });
    await injector.handleCommitted({ tabId: 7, frameId: 0, url: 'https://example.com/page' });
    await injector.handleCommitted({ tabId: 7, frameId: 3, url: 'https://frame.test/ad' });
    expect(chromeMock._state.calls.insertCSS).toHaveLength(0);

    await store.set({ siteModes: {} });
    await injector.handleCommitted({ tabId: 7, frameId: 0, url: 'https://example.com/page' });
    await injector.handleCommitted({ tabId: 7, frameId: 3, url: 'https://frame.test/ad' });
    const frameCall = chromeMock._state.calls.insertCSS.find(
      (c: { target: { frameIds: number[] } }) => c.target.frameIds[0] === 3,
    );
    expect(frameCall.css).toContain('.frame-ad');
  });

  it('resolves the top hostname from the tab when the session cache is cold', async () => {
    const hostname = await injector.resolveTopHostname(7, 4, 'https://frame.test/ad');
    expect(hostname).toBe('example.com');
  });

  it('injects dynamic scriptlets into the MAIN world with the bundled function', async () => {
    await store.set({
      userCompiled: {
        dnr: [],
        cosmetic: makeCosmeticDB('user'),
        scriptlets: makeScriptletDB('user', {
          byHost: { 'example.com': [{ name: 'set-constant', args: ['a', '1'] }] },
        }),
        warnings: [],
      },
    });
    await injector.handleCommitted({ tabId: 7, frameId: 0, url: 'https://example.com/page' });
    const [call] = chromeMock._state.calls.executeScript;
    expect(call).toMatchObject({
      target: { tabId: 7, frameIds: [0] },
      world: 'MAIN',
      injectImmediately: true,
      args: ['a', '1'],
    });
    expect(call.func).toBe(fakeScriptlet);
  });

  it('clears per-frame state when the tab navigates or closes', async () => {
    await injector.handleCommitted({ tabId: 7, frameId: 0, url: 'https://example.com/page' });
    expect(injector.wasInjected(7, 0, 'example.com')).toBe(true);
    injector.forgetTab(7);
    expect(injector.wasInjected(7, 0, 'example.com')).toBe(false);
  });

  it('never throws out of the synchronous listener', async () => {
    chromeMock.scripting.insertCSS = async () => {
      throw new Error('frame gone');
    };
    expect(() =>
      injector.onCommitted({ tabId: 7, frameId: 0, url: 'https://example.com/page' }),
    ).not.toThrow();
    await vi.waitFor(() => expect(injector.wasInjected(7, 0, 'example.com')).toBe(false));
  });
});

describe('buildCssChunks at-rules', () => {
  it('keeps @media style entries as standalone rules', () => {
    const chunks = injector.buildCssChunks(
      [],
      [
        ['@media (max-width: 600px)', '.a{display:none}'],
        ['@media (min-width: 900px)', '.a{display:none}'],
        ['.b', 'opacity:0.5'],
        ['.c', 'opacity:0.5'],
      ],
    );
    expect(chunks).toHaveLength(1);
    const css = chunks[0] ?? '';
    expect(css).toContain('@media (max-width: 600px){.a{display:none}}');
    expect(css).toContain('@media (min-width: 900px){.a{display:none}}');
    expect(css).toContain('.b,.c{opacity:0.5}');
    expect(css).not.toContain('@media (max-width: 600px),');
  });
});
