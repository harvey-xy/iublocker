/* Shared helpers for the `ui-*` tests: a fake message router and Preact mount/flush utilities. */
import { render } from 'preact';
import type { VNode } from 'preact';
import { act } from 'preact/test-utils';

export type RouteHandler = (message: any) => unknown;

export interface RouterMock {
  /** Every message passed to `chrome.runtime.sendMessage`, in order. */
  calls: any[];
  sent(type: string): any[];
  last(type: string): any;
}

/** Replace `chrome.runtime.sendMessage` with a router backed by `routes`. */
export function mockRouter(routes: Record<string, RouteHandler>): RouterMock {
  const calls: any[] = [];
  (globalThis as any).chrome.runtime.sendMessage = (message: any, callback?: (res: any) => void) => {
    calls.push(message);
    const handler = routes[message?.type];
    const response = handler
      ? { ok: true, data: handler(message) }
      : { ok: false, error: `ui-harness: no route for ${String(message?.type)}` };
    Promise.resolve().then(() => callback?.(response));
  };
  return {
    calls,
    sent: (type: string) => calls.filter((c) => c?.type === type),
    last: (type: string) => calls.filter((c) => c?.type === type).at(-1),
  };
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Let pending promises settle and Preact re-render. */
export async function flush(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await tick();
    });
  }
}

export async function mount(vnode: VNode<any>): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(vnode, container);
    await tick();
  });
  await flush();
  return container;
}

export function unmount(container: HTMLElement): void {
  render(null, container);
  container.remove();
}

export async function click(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error('click: element not found');
  await act(async () => {
    (element as HTMLElement).click();
    await tick();
  });
  await flush();
}

export async function setValue(element: Element | null | undefined, value: string): Promise<void> {
  if (!element) throw new Error('setValue: element not found');
  const input = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
  });
  await flush();
}

export function text(container: HTMLElement): string {
  return container.textContent ?? '';
}

export function checked(container: HTMLElement, name: string): boolean {
  const input = container.querySelector<HTMLInputElement>(`input[data-toggle="${name}"]`);
  if (!input) throw new Error(`toggle ${name} not found`);
  return input.checked;
}
