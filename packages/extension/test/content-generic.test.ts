import { describe, it, expect, beforeEach } from 'vitest';
import type { CosmeticGeneric } from '@iublocker/shared';
import { StyleManager } from '../src/content/style';
import { GenericHider } from '../src/content/generic';

const generic: CosmeticGeneric = {
  byId: { banner: ['#banner'], sidebar: ['#sidebar', '#sidebar > .promo'] },
  byClass: { ad: ['.ad', '.ad.top'], promo: ['.promo'], unused: ['.unused'] },
  complex: ['div[data-ad]', 'a[href^="/sponsored"]'],
};

let style: StyleManager;
let hider: GenericHider;

function setup(excluded: string[] = []): void {
  document.documentElement.innerHTML = '<head></head><body></body>';
  style = new StyleManager(document, 'iub-generic');
  hider = new GenericHider(generic, excluded, style);
}

beforeEach(() => setup());

describe('GenericHider', () => {
  it('injects only the selectors whose token occurs in the document', () => {
    document.body.innerHTML = '<div id="banner"></div><div class="ad top"></div>';
    hider.harvestRoot(document.documentElement);
    expect(hider.flush()).toBe(3);
    const css = style.cssText;
    expect(css).toContain('#banner');
    expect(css).toContain('.ad');
    expect(css).toContain('.ad.top');
    expect(css).not.toContain('#sidebar');
    expect(css).not.toContain('.unused');
  });

  it('harvests added nodes incrementally without re-doing work', () => {
    document.body.innerHTML = '<div class="ad"></div>';
    hider.harvestRoot(document.documentElement);
    expect(hider.flush()).toBe(2);
    const node = document.createElement('div');
    node.innerHTML = '<span class="ad"></span><span class="promo"></span>';
    document.body.appendChild(node);
    hider.harvestNode(node);
    // `.ad` was already seen; only `.promo` is new.
    expect(hider.pendingCount).toBe(1);
    expect(hider.flush()).toBe(1);
    expect(style.cssText).toContain('.promo');
  });

  it('harvests attribute changes', () => {
    document.body.innerHTML = '<div></div>';
    const el = document.querySelector('div') as HTMLElement;
    hider.harvestRoot(document.documentElement);
    hider.flush();
    el.id = 'sidebar';
    hider.harvestElement(el);
    expect(hider.flush()).toBe(2);
    expect(style.cssText).toContain('#sidebar > .promo');
  });

  it('drops selectors excluded by #@# for this hostname', () => {
    setup(['.ad', 'div[data-ad]']);
    document.body.innerHTML = '<div class="ad"></div>';
    hider.injectComplex();
    hider.harvestRoot(document.documentElement);
    hider.flush();
    const css = style.cssText;
    expect(css).not.toContain('.ad{');
    expect(css).toContain('.ad.top');
    expect(css).not.toContain('div[data-ad]');
    expect(css).toContain('a[href^="/sponsored"]');
  });

  it('injects the complex set exactly once', () => {
    hider.injectComplex();
    hider.injectComplex();
    expect(style.cssText.match(/data-ad/g)?.length).toBe(1);
  });

  it('ignores tokens that name an Object.prototype member', () => {
    // `byId[id]` used to walk the prototype chain: `<div id="constructor">` yielded the
    // `Object` constructor and threw "selectors is not iterable" out of the harvester,
    // which killed generic hiding for the rest of the document.
    document.body.innerHTML =
      '<div id="constructor"></div><div class="toString"></div>' +
      '<div id="__proto__" class="hasOwnProperty valueOf"></div><div class="ad"></div>';
    expect(() => hider.harvestRoot(document.documentElement)).not.toThrow();
    expect(hider.flush()).toBe(2);
    const css = style.cssText;
    expect(css).toContain('.ad');
    expect(css).not.toContain('constructor');
    expect(css).not.toContain('function');
  });

  it('harvests ids and classes through attributes, not clobberable properties', () => {
    document.body.innerHTML = '<form id="banner" class="ad"><input name="id"></form>';
    const form = document.querySelector('form') as Element;
    const decoy = document.createElement('input');
    // `HTMLFormElement`'s named getter shadows `.id`, `.classList` and even
    // `.querySelectorAll` in a real browser.
    Object.defineProperty(form, 'id', { value: decoy, configurable: true });
    Object.defineProperty(form, 'classList', { value: decoy, configurable: true });
    Object.defineProperty(form, 'querySelectorAll', { value: decoy, configurable: true });
    hider.harvestNode(form);
    expect(hider.flush()).toBe(3);
    const css = style.cssText;
    expect(css).toContain('#banner');
    expect(css).toContain('.ad');
    expect(css).toContain('.ad.top');
  });
});
