import { describe, it, expect, beforeEach } from 'vitest';
import type { ProceduralFilter } from '@iublocker/shared';
import { ProceduralExecutor, envFromWindow, MARKER_ATTR } from '../src/content/procedural';
import type { ProceduralEnv } from '../src/content/procedural';

function env(overrides: Partial<ProceduralEnv> = {}): ProceduralEnv {
  return { ...envFromWindow(window), ...overrides };
}

function filter(...tasks: ProceduralFilter['tasks']): ProceduralFilter {
  return { raw: 'test', tasks };
}

function html(markup: string): void {
  document.body.innerHTML = markup;
}

function ids(elements: Element[]): string[] {
  return elements.map((el) => el.id || el.localName);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('ProceduralExecutor — selection tasks', () => {
  it('css starts from the document and chains scoped', () => {
    html('<div class="box" id="a"><p id="p1">x</p></div><div class="box" id="b"></div>');
    const x = new ProceduralExecutor(env());
    expect(ids(x.select(filter(['css', '.box'])))).toEqual(['a', 'b']);
    expect(ids(x.select(filter(['css', '.box'], ['css', 'p'])))).toEqual(['p1']);
    expect(ids(x.select(filter(['css', '.box'], ['css', '> p'])))).toEqual(['p1']);
  });

  it('has-text matches literals and /regex/flags', () => {
    html('<div id="a">Sponsored content</div><div id="b">News</div>');
    const x = new ProceduralExecutor(env());
    expect(ids(x.select(filter(['css', 'div'], ['has-text', 'Sponsored'])))).toEqual(['a']);
    expect(ids(x.select(filter(['css', 'div'], ['has-text', '/spons\\w+/i'])))).toEqual(['a']);
    expect(x.select(filter(['css', 'div'], ['has-text', '/^nope$/']))).toEqual([]);
    // An invalid regex must not throw and must match nothing.
    expect(x.select(filter(['css', 'div'], ['has-text', '/([/']))).toEqual([]);
  });

  it('min-text-length filters by textContent length', () => {
    html('<div id="a">0123456789</div><div id="b">ab</div>');
    const x = new ProceduralExecutor(env());
    expect(ids(x.select(filter(['css', 'div'], ['min-text-length', 5])))).toEqual(['a']);
  });

  it('matches-css reads the computed style', () => {
    html('<div id="a" style="display:block"></div><div id="b" style="display:inline"></div>');
    const x = new ProceduralExecutor(env());
    expect(ids(x.select(filter(['css', 'div'], ['matches-css', 'display: block'])))).toEqual(['a']);
    expect(ids(x.select(filter(['css', 'div'], ['matches-css', 'display: /^inl/'])))).toEqual(['b']);
    expect(x.select(filter(['css', 'div'], ['matches-css', 'display: none']))).toEqual([]);
  });

  it('matches-css-before / -after pass the pseudo element through', () => {
    html('<div id="a"></div>');
    const seen: (string | null | undefined)[] = [];
    const x = new ProceduralExecutor(
      env({
        getComputedStyle: (_el, pseudo) => {
          seen.push(pseudo);
          return { getPropertyValue: () => 'ad' } as unknown as CSSStyleDeclaration;
        },
      }),
    );
    expect(ids(x.select(filter(['css', 'div'], ['matches-css-before', 'content: ad'])))).toEqual(['a']);
    expect(ids(x.select(filter(['css', 'div'], ['matches-css-after', 'content: ad'])))).toEqual(['a']);
    expect(seen).toEqual(['::before', '::after']);
  });

  it('matches-attr matches names and values, including regex and presence-only', () => {
    html('<div id="a" data-ad="banner-top"></div><div id="b" data-ad="content"></div><div id="c"></div>');
    const x = new ProceduralExecutor(env());
    expect(ids(x.select(filter(['css', 'div'], ['matches-attr', 'data-ad: /^banner/'])))).toEqual(['a']);
    expect(ids(x.select(filter(['css', 'div'], ['matches-attr', 'data-ad'])))).toEqual(['a', 'b']);
    expect(ids(x.select(filter(['css', 'div'], ['matches-attr', '/^data-/: content'])))).toEqual(['b']);
  });

  it('matches-path tests pathname + search', () => {
    html('<div id="a"></div>');
    const x = new ProceduralExecutor(env({ path: () => '/news/article?utm_source=x' }));
    expect(ids(x.select(filter(['css', 'div'], ['matches-path', '/news/'])))).toEqual(['a']);
    expect(x.select(filter(['css', 'div'], ['matches-path', '/shop/']))).toEqual([]);
    expect(ids(x.select(filter(['css', 'div'], ['matches-path', '/utm_source=/'])))).toEqual(['a']);
  });

  it('matches-media consults matchMedia', () => {
    html('<div id="a"></div>');
    const on = new ProceduralExecutor(env({ matchMedia: () => ({ matches: true }) }));
    const off = new ProceduralExecutor(env({ matchMedia: () => ({ matches: false }) }));
    expect(ids(on.select(filter(['css', 'div'], ['matches-media', '(min-width: 1px)'])))).toEqual(['a']);
    expect(off.select(filter(['css', 'div'], ['matches-media', '(min-width: 1px)']))).toEqual([]);
  });

  it('upward walks N levels or to the closest matching ancestor', () => {
    html('<section id="s"><div id="wrap"><p id="p">Sponsored</p></div></section>');
    const x = new ProceduralExecutor(env());
    expect(ids(x.select(filter(['css', 'p'], ['upward', 1])))).toEqual(['wrap']);
    expect(ids(x.select(filter(['css', 'p'], ['upward', 2])))).toEqual(['s']);
    expect(ids(x.select(filter(['css', 'p'], ['upward', 'section'])))).toEqual(['s']);
    expect(x.select(filter(['css', 'p'], ['upward', 0]))).toEqual([]);
  });

  it('xpath evaluates from the document and from the current set', () => {
    html('<div id="a"><span class="t">x</span></div><div id="b"></div>');
    const x = new ProceduralExecutor(env());
    expect(ids(x.select(filter(['xpath', '//div[@id="b"]'])))).toEqual(['b']);
    expect(ids(x.select(filter(['css', '#a'], ['xpath', './span'])))).toEqual(['span']);
    // A broken expression must not throw.
    expect(x.select(filter(['xpath', '//]][']))).toEqual([]);
  });

  it('others returns the minimal set hiding everything but the match and its ancestors', () => {
    html('<div id="keep"><p id="inner">x</p></div><div id="other"></div><span id="sib"></span>');
    const x = new ProceduralExecutor(env());
    const out = ids(x.select(filter(['css', '#inner'], ['others'])));
    expect(out).toContain('other');
    expect(out).toContain('sib');
    expect(out).toContain('head');
    expect(out).not.toContain('keep');
    expect(out).not.toContain('inner');
  });

  it('has / not accept nested procedural filters', () => {
    html('<div id="a"><span>Sponsored</span></div><div id="b"><span>News</span></div>');
    const x = new ProceduralExecutor(env());
    const nested: ProceduralFilter = filter(['css', 'span'], ['has-text', 'Sponsored']);
    expect(ids(x.select(filter(['css', 'div'], ['has', nested])))).toEqual(['a']);
    expect(ids(x.select(filter(['css', 'div'], ['not', nested])))).toEqual(['b']);
  });

  it('watch-attr is transparent for selection and is reported to the engine', () => {
    html('<div id="a" data-state="on"></div>');
    const x = new ProceduralExecutor(env(), [filter(['css', 'div'], ['watch-attr', 'data-state, class'])]);
    expect(x.watchedAttributes).toEqual(['data-state', 'class']);
    expect(x.watchesAllAttributes).toBe(false);
    expect(
      new ProceduralExecutor(env(), [filter(['css', 'div'], ['watch-attr', ''])]).watchesAllAttributes,
    ).toBe(true);
  });
});

describe('ProceduralExecutor — actions', () => {
  it('hides matched elements with an important display:none and a marker', () => {
    html('<div id="a" class="box">Sponsored</div><div id="b" class="box">News</div>');
    const x = new ProceduralExecutor(env(), [filter(['css', '.box'], ['has-text', 'Sponsored'])]);
    expect(x.run().hidden).toBe(1);
    const a = document.getElementById('a') as HTMLElement;
    expect(a.style.display).toBe('none');
    expect(a.getAttribute(MARKER_ATTR)).toBe('hidden');
    expect((document.getElementById('b') as HTMLElement).style.display).toBe('');
  });

  it('is idempotent across passes and unhides when a filter stops matching', () => {
    html('<div id="a" class="box">Sponsored</div>');
    const x = new ProceduralExecutor(env(), [filter(['css', '.box'], ['has-text', 'Sponsored'])]);
    expect(x.run().hidden).toBe(1);
    expect(x.run().hidden).toBe(0);
    const a = document.getElementById('a') as HTMLElement;
    a.textContent = 'News';
    const stats = x.run();
    expect(stats.unhidden).toBe(1);
    expect(a.style.display).toBe('');
    expect(a.hasAttribute(MARKER_ATTR)).toBe(false);
  });

  it('re-hides an element whose inline display the page cleared', () => {
    html('<div id="a" class="box">Sponsored</div>');
    const x = new ProceduralExecutor(env(), [filter(['css', '.box'], ['has-text', 'Sponsored'])]);
    x.run();
    const a = document.getElementById('a') as HTMLElement;
    // A page that fights back: drop the inline style we set.
    a.style.removeProperty('display');
    a.removeAttribute(MARKER_ATTR);
    x.run();
    expect(a.style.display).toBe('none');
    expect(a.style.getPropertyPriority('display')).toBe('important');
    expect(a.getAttribute(MARKER_ATTR)).toBe('hidden');
    // The original (empty) inline value is still what reset() puts back.
    x.reset();
    expect(a.style.display).toBe('');
  });

  it('keeps an element hidden when one of two filters stops matching it', () => {
    html('<div id="a" class="box">Sponsored</div>');
    const x = new ProceduralExecutor(env(), [
      filter(['css', '.box'], ['has-text', 'Sponsored']),
      filter(['css', '#a']),
    ]);
    x.run();
    const a = document.getElementById('a') as HTMLElement;
    expect(a.style.display).toBe('none');
    a.textContent = 'News';
    x.run();
    // The first filter stopped matching and restored what it recorded, but the second
    // one still matches, so the element must not become visible again.
    x.run();
    expect(a.style.display).toBe('none');
  });

  it('restores the inline display the page had set', () => {
    html('<div id="a" class="box" style="display:flex">Sponsored</div>');
    const x = new ProceduralExecutor(env(), [filter(['css', '.box'], ['has-text', 'Sponsored'])]);
    x.run();
    expect((document.getElementById('a') as HTMLElement).style.display).toBe('none');
    x.reset();
    expect((document.getElementById('a') as HTMLElement).style.display).toBe('flex');
  });

  it('keeps applying later filters when an action throws on hostile DOM', () => {
    html('<form id="a" class="box">Sponsored</form><div id="b" class="box">Sponsored</div>');
    const form = document.getElementById('a') as HTMLElement;
    // `<form><input name=remove>` makes `el.remove` a page-controlled non-function.
    Object.defineProperty(form, 'remove', { value: 'clobbered', configurable: true });
    const x = new ProceduralExecutor(env(), [
      filter(['css', 'form'], ['remove']),
      filter(['css', 'div.box'], ['has-text', 'Sponsored']),
    ]);
    expect(() => x.run()).not.toThrow();
    expect((document.getElementById('b') as HTMLElement).style.display).toBe('none');
  });

  it('remove() detaches the matched elements', () => {
    html('<div id="a" class="box">Sponsored</div><div id="b" class="box">News</div>');
    const x = new ProceduralExecutor(env(), [filter(['css', '.box'], ['has-text', 'Sponsored'], ['remove'])]);
    expect(x.run().removed).toBe(1);
    expect(document.getElementById('a')).toBeNull();
    expect(document.getElementById('b')).not.toBeNull();
  });

  it('style() applies the declarations inline', () => {
    html('<div id="a" class="box">Sponsored</div>');
    const x = new ProceduralExecutor(env(), [
      filter(['css', '.box'], ['has-text', 'Sponsored'], ['style', 'opacity: 0.1 !important; color: red']),
    ]);
    expect(x.run().styled).toBe(1);
    const a = document.getElementById('a') as HTMLElement;
    expect(a.style.opacity).toBe('0.1');
    expect(a.style.color).toBe('red');
    expect(a.getAttribute(MARKER_ATTR)).toBe('styled');
  });

  it('remove-attr() strips a named attribute from the matches', () => {
    html('<a id="a" class="ad" href="/x" onclick="go()">Ad</a><a id="b" href="/y" onclick="go()">News</a>');
    const x = new ProceduralExecutor(env(), [
      filter(['css', 'a'], ['has-text', 'Ad'], ['remove-attr', 'onclick']),
    ]);
    expect(x.run().stripped).toBe(1);
    expect(document.getElementById('a')!.hasAttribute('onclick')).toBe(false);
    expect(document.getElementById('b')!.hasAttribute('onclick')).toBe(true);
  });

  it('remove-attr() with a regex strips every matching attribute', () => {
    html('<div id="a" data-ad="1" data-track="2" title="keep"></div>');
    const x = new ProceduralExecutor(env(), [filter(['css', '#a'], ['remove-attr', '/^data-/'])]);
    expect(x.run().stripped).toBe(2);
    const a = document.getElementById('a')!;
    expect(a.hasAttribute('data-ad')).toBe(false);
    expect(a.hasAttribute('data-track')).toBe(false);
    expect(a.getAttribute('title')).toBe('keep');
  });

  it('remove-class() strips a named class', () => {
    html('<div id="a" class="box ad sticky"></div>');
    const x = new ProceduralExecutor(env(), [filter(['css', '#a'], ['remove-class', 'ad'])]);
    expect(x.run().stripped).toBe(1);
    expect(document.getElementById('a')!.className).toBe('box sticky');
  });

  it('remove-class() with a regex strips every matching class', () => {
    html('<div id="a" class="ad-slot ad-label content"></div>');
    const x = new ProceduralExecutor(env(), [filter(['css', '#a'], ['remove-class', '/^ad-/'])]);
    expect(x.run().stripped).toBe(2);
    expect(document.getElementById('a')!.className).toBe('content');
  });

  it('re-strips a class the page adds back', () => {
    html('<div id="a" class="ad"></div>');
    const x = new ProceduralExecutor(env(), [filter(['css', '#a'], ['remove-class', 'ad'])]);
    x.run();
    document.getElementById('a')!.classList.add('ad');
    expect(x.run().stripped).toBe(1);
    expect(document.getElementById('a')!.classList.contains('ad')).toBe(false);
  });

  it('does not hide the element it strips', () => {
    html('<div id="a" class="ad"></div>');
    const x = new ProceduralExecutor(env(), [filter(['css', '#a'], ['remove-attr', 'nope'])]);
    const stats = x.run();
    expect(stats.hidden).toBe(0);
    expect((document.getElementById('a') as HTMLElement).style.display).toBe('');
  });

  it('applies remove-attr and remove-class together', () => {
    html('<div id="a" class="ad box" data-x="1"></div>');
    const x = new ProceduralExecutor(env(), [
      filter(['css', '#a'], ['remove-attr', 'data-x'], ['remove-class', 'ad']),
    ]);
    expect(x.run().stripped).toBe(2);
    const a = document.getElementById('a')!;
    expect(a.hasAttribute('data-x')).toBe(false);
    expect(a.className).toBe('box');
  });

  it('never throws on a broken chain', () => {
    html('<div id="a"></div>');
    const x = new ProceduralExecutor(env(), [filter(['css', '::::'], ['has-text', 'x'])]);
    expect(() => x.run()).not.toThrow();
  });
});
