import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request } from '@iublocker/shared';
import { ElementPicker } from '../src/content/picker-ui';

type PickerWindow = Window & { __iub_picker?: { destroy(): void } };

const sent: Request[] = [];

function mockWorker(
  data: unknown = { text: '', warnings: [], counts: { dnr: 0, cosmetic: 1, scriptlets: 0 } },
): void {
  (globalThis as any).chrome.runtime.sendMessage = (msg: Request, cb?: (r: unknown) => void) => {
    sent.push(msg);
    cb?.({ ok: true, data });
  };
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function hover(el: Element): void {
  el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
}

let picker: ElementPicker | null = null;

beforeEach(() => {
  sent.length = 0;
  mockWorker();
  (window as PickerWindow).__iub_picker?.destroy();
  document.documentElement.innerHTML = '<head></head><body></body>';
  document.body.innerHTML =
    '<section id="wrapper"><div class="card promo"><span class="label">Ad</span></div>' +
    '<div class="card"><span class="label">Ad</span></div></section>';
});

afterEach(() => {
  picker?.destroy();
  picker = null;
});

describe('element picker', () => {
  it('mounts a closed shadow root on documentElement and cleans it up', () => {
    picker = new ElementPicker(window);
    picker.start();
    const host = document.querySelector('iub-picker') as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.shadowRoot).toBeNull(); // closed
    expect(host.style.zIndex).toBe('2147483647');
    expect(host.parentElement).toBe(document.documentElement);
    picker.destroy();
    expect(document.querySelector('iub-picker')).toBeNull();
  });

  it('hovering proposes a selector, clicking picks it', () => {
    picker = new ElementPicker(window);
    picker.start();
    const label = document.querySelector('.label') as Element;
    hover(label);
    expect(picker.currentSelector).toBe('span.label');
    click(label);
    expect(picker.currentSelector).toBe('span.label');
    // Once picked, hovering elsewhere must not change the selection.
    hover(document.querySelector('#wrapper') as Element);
    expect(picker.currentSelector).toBe('span.label');
  });

  it('previews the candidate with a temporary style element', () => {
    picker = new ElementPicker(window);
    picker.start();
    click(document.querySelector('.label') as Element);
    const preview = document.getElementById('iub-picker-preview');
    expect(preview?.textContent).toBe('span.label{display:none!important;}');
    picker.destroy();
    expect(document.getElementById('iub-picker-preview')).toBeNull();
  });

  it('swallows page clicks while picking', () => {
    picker = new ElementPicker(window);
    picker.start();
    const label = document.querySelector('.label') as Element;
    let pageSaw = false;
    label.addEventListener('click', () => {
      pageSaw = true;
    });
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    label.dispatchEvent(ev);
    expect(pageSaw).toBe(false);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('Escape cancels and removes every listener', () => {
    picker = new ElementPicker(window);
    picker.start();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('iub-picker')).toBeNull();
    // Listeners are gone: a later click reaches the page again.
    let pageSaw = false;
    const label = document.querySelector('.label') as Element;
    label.addEventListener('click', () => {
      pageSaw = true;
    });
    click(label);
    expect(pageSaw).toBe(true);
  });

  it('Create sends filters:addUser and keeps the element hidden', async () => {
    picker = new ElementPicker(window);
    picker.start();
    click(document.querySelector('.label') as Element);
    await picker.create();
    expect(sent.at(-1)).toEqual({
      type: 'filters:addUser',
      lines: [`${window.location.hostname}##span.label`],
    });
    expect(document.querySelector('iub-picker')).toBeNull();
    const applied = document.getElementById('iub-picker-applied');
    expect(applied?.textContent).toContain('span.label');
  });

  it('the entry script mounts one picker, and a second injection replaces it', async () => {
    await import('../src/content/picker');
    expect(document.querySelectorAll('iub-picker')).toHaveLength(1);
    vi.resetModules();
    await import('../src/content/picker');
    expect(document.querySelectorAll('iub-picker')).toHaveLength(1);
    (window as PickerWindow).__iub_picker?.destroy();
    expect(document.querySelectorAll('iub-picker')).toHaveLength(0);
  });
});
