import { describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { act } from 'preact/test-utils';
import { Segmented, Toggle } from '../src/ui/lib/components';
import { click, flush, mount, unmount } from './ui-harness';

const options = [
  { value: 'a', label: 'A', description: 'first' },
  { value: 'b', label: 'B', description: 'second' },
  { value: 'c', label: 'C', description: 'third', marker: '(default)' },
] as const;

describe('Segmented', () => {
  it('exposes radiogroup semantics with a roving tabindex', async () => {
    const el = await mount(
      h(Segmented, { legend: 'Mode', value: 'b', options: [...options], onChange: () => {}, name: 'demo' }),
    );
    const group = el.querySelector('[data-segmented="demo"]');
    expect(group?.getAttribute('role')).toBe('radiogroup');
    expect(group?.getAttribute('aria-label')).toBe('Mode');
    const radios = [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    expect(el.querySelector('.segmented-desc')?.textContent).toBe('second');
    expect(el.querySelector('[data-value="c"] .segment-marker')?.textContent).toBe('(default)');
    unmount(el);
  });

  it('selects with the arrow keys and wraps around', async () => {
    const onChange = vi.fn();
    const el = await mount(
      h(Segmented, { legend: 'Mode', value: 'c', options: [...options], onChange, name: 'demo' }),
    );
    const group = el.querySelector('[data-segmented="demo"]');
    await act(async () => {
      group?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    await flush();
    expect(onChange).toHaveBeenCalledWith('a');

    await act(async () => {
      group?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    await flush();
    expect(onChange).toHaveBeenLastCalledWith('b');
    unmount(el);
  });
});

describe('Toggle', () => {
  it('reports the new checked state and links its label', async () => {
    const onChange = vi.fn();
    const el = await mount(h(Toggle, { checked: false, onChange, label: 'Badge', name: 'badge' }));
    const input = el.querySelector<HTMLInputElement>('input[data-toggle="badge"]');
    const label = el.querySelector<HTMLLabelElement>('.toggle-label');
    expect(input?.getAttribute('role')).toBe('switch');
    expect(label?.htmlFor).toBe(input?.id);
    await click(input);
    expect(onChange).toHaveBeenCalledWith(true);
    unmount(el);
  });
});
