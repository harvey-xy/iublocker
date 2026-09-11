import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CosmeticGetResponse, Request, SiteMode } from '@iublocker/shared';
import { startEngine } from '../src/content/engine';
import type { CosmeticEngine } from '../src/content/engine';
import { Collapser } from '../src/content/collapse';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function response(patch: Partial<CosmeticGetResponse> = {}): CosmeticGetResponse {
  return {
    mode: 'complete',
    procedural: [],
    selectors: [],
    styles: [],
    generic: null,
    excluded: [],
    elemhide: false,
    ...patch,
  };
}

let sent: Request[] = [];

function mockWorker(handler: (msg: Request) => unknown): void {
  (globalThis as any).chrome.runtime.sendMessage = (msg: Request, cb?: (r: unknown) => void) => {
    sent.push(msg);
    cb?.({ ok: true, data: handler(msg) });
  };
}

let engine: CosmeticEngine | null = null;

beforeEach(() => {
  sent = [];
  document.documentElement.innerHTML = '<head></head><body></body>';
});

afterEach(() => {
  engine?.stop();
  engine = null;
});

describe('cosmetic engine start-up', () => {
  it('asks the worker for this frame and reports the hostname', async () => {
    mockWorker(() => response({ mode: 'optimal', selectors: ['.ad'] }));
    engine = await startEngine(window);
    expect(sent[0]).toMatchObject({ type: 'cosmetic:get', hostname: window.location.hostname, frameId: 0 });
  });

  it.each<SiteMode>(['off', 'basic'])('bails out in %s mode', async (mode) => {
    mockWorker(() => response({ mode, selectors: ['.ad'] }));
    engine = await startEngine(window);
    expect(engine).toBeNull();
    expect(document.getElementById('iub-cosmetic')).toBeNull();
  });

  it('bails out when $elemhide applies', async () => {
    mockWorker(() => response({ mode: 'complete', elemhide: true, selectors: ['.ad'] }));
    engine = await startEngine(window);
    expect(engine).toBeNull();
  });

  it('bails out when the worker is unreachable', async () => {
    (globalThis as any).chrome.runtime.sendMessage = (_msg: Request, cb?: (r: unknown) => void) => {
      (globalThis as any).chrome.runtime.lastError = { message: 'receiving end does not exist' };
      cb?.(undefined);
      (globalThis as any).chrome.runtime.lastError = undefined;
    };
    engine = await startEngine(window);
    expect(engine).toBeNull();
  });

  it('applies content-script selectors and :style() rules', async () => {
    mockWorker(() =>
      response({
        mode: 'optimal',
        selectors: ['.ad', '#promo'],
        styles: [['.sponsor', 'opacity:0.1!important']],
      }),
    );
    engine = await startEngine(window);
    expect(engine).not.toBeNull();
    const css = engine?.cssText ?? '';
    expect(css).toContain('.ad,#promo{display:none!important;}');
    expect(css).toContain('.sponsor{opacity:0.1!important}');
    expect(document.getElementById('iub-cosmetic')?.parentElement).toBe(document.head);
  });
});

describe('cosmetic engine generic hiding', () => {
  it('injects generic selectors for tokens present in the document', async () => {
    document.body.innerHTML = '<div class="ad"></div><div id="banner"></div>';
    mockWorker(() =>
      response({
        mode: 'complete',
        generic: {
          byId: { banner: ['#banner'] },
          byClass: { ad: ['.ad'], gone: ['.gone'] },
          complex: ['[data-ad]'],
        },
        excluded: ['#banner'],
      }),
    );
    engine = await startEngine(window);
    const css = engine?.cssText ?? '';
    expect(css).toContain('.ad');
    expect(css).toContain('[data-ad]');
    expect(css).not.toContain('.gone');
    expect(css).not.toContain('#banner');
  });

  it('harvests nodes added later', async () => {
    mockWorker(() =>
      response({ mode: 'complete', generic: { byId: {}, byClass: { late: ['.late'] }, complex: [] } }),
    );
    engine = await startEngine(window);
    expect(engine?.cssText).not.toContain('.late');
    const node = document.createElement('div');
    node.innerHTML = '<span class="late"></span>';
    document.body.appendChild(node);
    await tick();
    engine?.pass();
    expect(engine?.cssText).toContain('.late');
  });
});

describe('cosmetic engine procedural filters', () => {
  it('runs procedural filters on start and after mutations', async () => {
    document.body.innerHTML = '<div class="box">Sponsored</div>';
    mockWorker(() =>
      response({
        mode: 'complete',
        procedural: [
          {
            raw: '.box:has-text(Sponsored)',
            tasks: [
              ['css', '.box'],
              ['has-text', 'Sponsored'],
            ],
          },
        ],
      }),
    );
    engine = await startEngine(window);
    expect((document.querySelector('.box') as HTMLElement).style.display).toBe('none');

    const later = document.createElement('div');
    later.className = 'box';
    later.textContent = 'Sponsored too';
    document.body.appendChild(later);
    await tick();
    engine?.pass();
    expect(later.style.display).toBe('none');
  });

  it('defers work while the document is hidden and catches up on visibilitychange', async () => {
    document.body.innerHTML = '<div class="box">Sponsored</div>';
    mockWorker(() =>
      response({
        mode: 'complete',
        procedural: [
          {
            raw: '.box:has-text(Sponsored)',
            tasks: [
              ['css', '.box'],
              ['has-text', 'Sponsored'],
            ],
          },
        ],
      }),
    );
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    engine = await startEngine(window);
    expect((document.querySelector('.box') as HTMLElement).style.display).toBe('');
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect((document.querySelector('.box') as HTMLElement).style.display).toBe('none');
    hidden.mockRestore();
  });
});

describe('collapsing blocked elements', () => {
  it('hides only the elements whose URL the worker reports as blocked', async () => {
    document.body.innerHTML =
      '<img id="ad" src="https://cdn.example/ads/banner.png"><img id="real" src="https://cdn.example/logo.png">';
    mockWorker(() => ({ urls: ['https://cdn.example/ads/banner.png'] }));
    const collapser = new Collapser(window);
    collapser.start();
    for (const img of Array.from(document.images)) img.dispatchEvent(new Event('error'));
    expect(await collapser.flush()).toBe(1);
    expect((document.getElementById('ad') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('real') as HTMLElement).style.display).toBe('');
    collapser.stop();
  });

  it('hides nothing when the worker reports no blocked URLs', async () => {
    document.body.innerHTML = '<iframe id="f" src="https://cdn.example/frame.html"></iframe>';
    mockWorker(() => ({ urls: [] }));
    const collapser = new Collapser(window);
    collapser.start();
    document.getElementById('f')?.dispatchEvent(new Event('error'));
    expect(await collapser.flush()).toBe(0);
    expect((document.getElementById('f') as HTMLElement).style.display).toBe('');
    collapser.stop();
  });
});
