import { describe, it, expect, beforeEach } from 'vitest';
import { StyleManager } from '../src/content/style';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('StyleManager', () => {
  it('creates the element on documentElement when <head> does not exist yet', () => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.head.remove();
    expect(doc.head).toBeNull();
    const sm = new StyleManager(doc);
    sm.hide(['.ad']);
    const el = doc.getElementById('iub-cosmetic');
    expect(el).not.toBeNull();
    expect(el?.parentElement).toBe(doc.documentElement);
    expect(el?.textContent).toContain('.ad{display:none!important;}');
  });

  it('moves into <head> once it exists', () => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.head.remove();
    const sm = new StyleManager(doc);
    sm.hide(['.ad']);
    const head = doc.createElement('head');
    doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
    sm.ensureAttached();
    expect(doc.getElementById('iub-cosmetic')?.parentElement).toBe(head);
  });

  it('dedupes selectors and keeps appending, never rewriting', () => {
    const sm = new StyleManager(document);
    expect(sm.hide(['.ad', '.ad', '#banner'])).toBe(2);
    expect(sm.hide(['.ad'])).toBe(0);
    expect(sm.hide(['.promo'])).toBe(1);
    const css = sm.cssText;
    expect(css.match(/\.ad/g)?.length).toBe(1);
    expect(css).toContain('.ad,#banner{display:none!important;}');
    expect(css).toContain('.promo{display:none!important;}');
    sm.destroy();
  });

  it('injects :style() rules once', () => {
    const sm = new StyleManager(document);
    sm.style('.ad', 'opacity:0.1!important');
    sm.style('.ad', 'opacity:0.1!important');
    expect(sm.cssText.match(/opacity/g)?.length).toBe(1);
    sm.destroy();
  });

  it('re-appends the element when the page removes it', async () => {
    const sm = new StyleManager(document);
    sm.hide(['.ad']);
    const el = document.getElementById('iub-cosmetic');
    expect(el).not.toBeNull();
    el?.remove();
    expect(document.getElementById('iub-cosmetic')).toBeNull();
    await tick();
    expect(document.getElementById('iub-cosmetic')).toBe(el);
    expect(el?.textContent).toContain('.ad');
    sm.destroy();
  });

  it('destroy() removes the element and stops re-appending', async () => {
    const sm = new StyleManager(document);
    sm.hide(['.ad']);
    sm.destroy();
    expect(document.getElementById('iub-cosmetic')).toBeNull();
    await tick();
    expect(document.getElementById('iub-cosmetic')).toBeNull();
  });
});
