/**
 * Element picker UI (docs/COSMETIC-FILTERING.md §5).
 *
 * The whole UI lives in a *closed* shadow root on a host element appended to
 * `documentElement`, so the page can neither style nor read it. Vanilla DOM only;
 * `src/content/picker.ts` is the injected entry point that owns the instance.
 */

import { sendRequest } from '@iublocker/shared';
import { frameHostname, qsa } from './dom';
import {
  broadenIndex,
  buildLadder,
  defaultLadderIndex,
  filterFor,
  generateSelector,
  narrowIndex,
} from './selector';
import type { LadderEntry } from './selector';

const HOST_TAG = 'iub-picker';
const PREVIEW_ID = 'iub-picker-preview';
const APPLIED_ID = 'iub-picker-applied';
const MAX_BOXES = 32;
const Z_INDEX = '2147483647';

const PICKER_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; }
.dim { position: fixed; background: rgba(10, 12, 16, 0.45); pointer-events: none; }
.box { position: fixed; border: 1px solid #4aa3ff; background: rgba(74, 163, 255, 0.18);
       pointer-events: none; }
.box.secondary { border-style: dashed; background: rgba(74, 163, 255, 0.08); }
.panel { position: fixed; right: 16px; bottom: 16px; width: 320px; max-width: calc(100vw - 32px);
         padding: 12px; border-radius: 10px; pointer-events: auto;
         background: #ffffff; color: #14171c; border: 1px solid #d4d8de;
         box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28); }
.panel.flip { top: 16px; bottom: auto; }
.title { font-weight: 600; margin-bottom: 6px; display: flex; justify-content: space-between; }
.title small { font-weight: 400; opacity: 0.7; }
code { display: block; padding: 8px; border-radius: 6px; background: #f2f4f7; color: #14171c;
       font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
       word-break: break-all; max-height: 92px; overflow: auto; }
.meta { margin: 8px 0 4px; opacity: 0.75; }
input[type='range'] { width: 100%; margin: 6px 0 10px; }
.row { display: flex; gap: 6px; }
.row + .row { margin-top: 6px; }
button { flex: 1; padding: 6px 8px; border-radius: 6px; cursor: pointer;
         border: 1px solid #d4d8de; background: #f7f8fa; color: #14171c; }
button:hover { background: #eceff3; }
button.primary { background: #2f6fed; border-color: #2f6fed; color: #fff; }
button.primary:hover { background: #2760d4; }
button:disabled { opacity: 0.5; cursor: default; }
.status { margin-top: 8px; min-height: 16px; color: #1b7f3b; }
.status.error { color: #c0392b; }
@media (prefers-color-scheme: dark) {
  .panel { background: #1b1e24; color: #e6e8ec; border-color: #333842; }
  code { background: #23272f; color: #e6e8ec; }
  button { background: #23272f; color: #e6e8ec; border-color: #333842; }
  button:hover { background: #2b303a; }
  .status { color: #5ecb7e; }
}
`;

type PickerWindow = Window & { __iub_picker?: { destroy(): void } };

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

export class ElementPicker {
  private readonly win: Window;
  private readonly doc: Document;
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly boxes: HTMLElement;
  private readonly dims: HTMLElement[] = [];
  private readonly panel: HTMLElement;
  private readonly selectorEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly createBtn: HTMLButtonElement;
  private readonly narrowBtn: HTMLButtonElement;
  private readonly broadenBtn: HTMLButtonElement;
  private readonly againBtn: HTMLButtonElement;

  private hovered: Element | null = null;
  private ladder: LadderEntry[] = [];
  private index = 0;
  private selected = false;
  private preview: HTMLStyleElement | null = null;
  private frame: number | null = null;
  private destroyed = false;

  private readonly onMouseMove = (ev: Event): void => this.handleMouseMove(ev);
  private readonly onClick = (ev: Event): void => this.handleClick(ev);
  private readonly onKeyDown = (ev: Event): void => this.handleKeyDown(ev);
  private readonly onViewport = (): void => this.scheduleRender();

  constructor(win: Window) {
    this.win = win;
    this.doc = win.document;
    this.host = this.doc.createElement(HOST_TAG);
    this.host.style.setProperty('all', 'initial', 'important');
    this.host.style.setProperty('position', 'fixed', 'important');
    this.host.style.setProperty('inset', '0', 'important');
    this.host.style.setProperty('z-index', Z_INDEX, 'important');
    this.host.style.setProperty('pointer-events', 'none', 'important');
    this.root = this.host.attachShadow({ mode: 'closed' });

    this.root.append(el(this.doc, 'style', { textContent: PICKER_CSS }));
    for (let i = 0; i < 4; i++) {
      const dim = el(this.doc, 'div', { className: 'dim' });
      this.dims.push(dim);
      this.root.append(dim);
    }
    this.boxes = el(this.doc, 'div');
    this.root.append(this.boxes);

    this.selectorEl = el(this.doc, 'code', { textContent: '' });
    this.countEl = el(this.doc, 'div', {
      className: 'meta',
      textContent: 'Hover an element, click to pick.',
    });
    this.statusEl = el(this.doc, 'div', { className: 'status' });
    this.slider = el(this.doc, 'input', { type: 'range', min: '0', max: '0', value: '0', disabled: true });
    this.narrowBtn = el(this.doc, 'button', { textContent: 'Narrower', disabled: true });
    this.broadenBtn = el(this.doc, 'button', { textContent: 'Broader', disabled: true });
    this.createBtn = el(this.doc, 'button', { className: 'primary', textContent: 'Create', disabled: true });
    this.againBtn = el(this.doc, 'button', { textContent: 'Pick again' });
    const quitBtn = el(this.doc, 'button', { textContent: 'Quit' });

    this.panel = el(this.doc, 'div', { className: 'panel' }, [
      el(this.doc, 'div', { className: 'title' }, [
        'iuBlocker picker',
        el(this.doc, 'small', { textContent: 'Esc to cancel' }),
      ]),
      this.selectorEl,
      this.countEl,
      this.slider,
      el(this.doc, 'div', { className: 'row' }, [this.narrowBtn, this.broadenBtn]),
      el(this.doc, 'div', { className: 'row' }, [this.createBtn, this.againBtn, quitBtn]),
      this.statusEl,
    ]);
    this.root.append(this.panel);

    this.slider.addEventListener('input', () => {
      this.index = Number(this.slider.value) || 0;
      this.render();
    });
    this.narrowBtn.addEventListener('click', () => this.step(narrowIndex(this.index)));
    this.broadenBtn.addEventListener('click', () => this.step(broadenIndex(this.index, this.ladder)));
    this.createBtn.addEventListener('click', () => void this.create());
    this.againBtn.addEventListener('click', () => this.pickAgain());
    quitBtn.addEventListener('click', () => this.destroy());
  }

  start(): void {
    const root = this.doc.documentElement;
    if (!root) return;
    root.appendChild(this.host);
    this.doc.addEventListener('mousemove', this.onMouseMove, true);
    this.doc.addEventListener('click', this.onClick, true);
    this.doc.addEventListener('keydown', this.onKeyDown, true);
    this.win.addEventListener('scroll', this.onViewport, true);
    this.win.addEventListener('resize', this.onViewport, true);
    this.render();
  }

  destroy(keepHide = false): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.removeEventListener('mousemove', this.onMouseMove, true);
    this.doc.removeEventListener('click', this.onClick, true);
    this.doc.removeEventListener('keydown', this.onKeyDown, true);
    this.win.removeEventListener('scroll', this.onViewport, true);
    this.win.removeEventListener('resize', this.onViewport, true);
    if (this.frame !== null) {
      this.win.cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    if (this.preview) {
      if (keepHide) this.preview.id = APPLIED_ID;
      else this.preview.remove();
      this.preview = null;
    }
    this.host.remove();
    const win = this.win as PickerWindow;
    if (win.__iub_picker && win.__iub_picker.destroy === this.boundDestroy) delete win.__iub_picker;
  }

  /** Stable reference used to identify this instance's teardown hook. */
  readonly boundDestroy = (): void => this.destroy();

  /** The filter the picker would create right now, or `''` while nothing is picked. */
  get currentSelector(): string {
    if (this.selected) return this.ladder[this.index]?.selector ?? '';
    return this.hovered ? generateSelector(this.hovered) : '';
  }

  // ------------------------------------------------------------------- events

  private handleMouseMove(ev: Event): void {
    if (this.selected || this.isOwnEvent(ev)) return;
    const target = ev.target;
    if (!(target instanceof Element) || target === this.host) return;
    if (target === this.hovered) return;
    this.hovered = target;
    this.flipPanelAway(target);
    this.scheduleRender();
  }

  private handleClick(ev: Event): void {
    if (this.isOwnEvent(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    if (this.selected) return;
    const target = ev.target;
    if (!(target instanceof Element) || target === this.host) return;
    this.select(target);
  }

  private handleKeyDown(ev: Event): void {
    const key = (ev as KeyboardEvent).key;
    if (key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    this.destroy();
  }

  /** True when the event originated inside our own (closed) shadow root. */
  private isOwnEvent(ev: Event): boolean {
    const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
    return path.includes(this.host) || ev.target === this.host;
  }

  // -------------------------------------------------------------------- state

  private select(target: Element): void {
    this.hovered = target;
    this.ladder = buildLadder(target);
    this.index = defaultLadderIndex(this.ladder, target);
    this.selected = true;
    this.slider.disabled = false;
    this.slider.max = String(Math.max(this.ladder.length - 1, 0));
    this.createBtn.disabled = false;
    this.render();
  }

  private step(index: number): void {
    this.index = index;
    this.render();
  }

  private pickAgain(): void {
    this.selected = false;
    this.hovered = null;
    this.ladder = [];
    this.index = 0;
    this.slider.disabled = true;
    this.createBtn.disabled = true;
    this.narrowBtn.disabled = true;
    this.broadenBtn.disabled = true;
    this.statusEl.textContent = '';
    this.statusEl.classList.remove('error');
    this.clearPreview();
    this.render();
  }

  /** Creates the user filter for the current selection (also used by tests). */
  async create(): Promise<void> {
    const selector = this.currentSelector;
    if (!selector) return;
    // No hostname (a `file://` page, an opaque origin) would yield `##selector`: a
    // *generic* filter that hides this element on every site. Refuse instead.
    const line = filterFor(frameHostname(this.win), selector);
    if (line === null) {
      this.statusEl.classList.add('error');
      this.statusEl.textContent = 'This page has no hostname, so the filter cannot be scoped to it.';
      return;
    }
    this.createBtn.disabled = true;
    try {
      const res = await sendRequest({ type: 'filters:addUser', lines: [line] });
      const warning = res.warnings?.[0];
      if (warning) {
        this.statusEl.classList.add('error');
        this.statusEl.textContent = warning;
        this.createBtn.disabled = false;
        return;
      }
    } catch (err) {
      this.statusEl.classList.add('error');
      this.statusEl.textContent = err instanceof Error ? err.message : 'Could not save the filter';
      this.createBtn.disabled = false;
      return;
    }
    // Keep the preview style so the element stays hidden until the next navigation.
    this.destroy(true);
  }

  // ------------------------------------------------------------------ drawing

  private scheduleRender(): void {
    if (this.destroyed || this.frame !== null) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  private render(): void {
    if (this.destroyed) return;
    this.clearPreview();
    const selector = this.currentSelector;
    const targets = this.selected && selector ? qsa(this.doc, selector) : this.hovered ? [this.hovered] : [];
    const primary = (this.selected ? (this.ladder[this.index]?.element ?? targets[0]) : this.hovered) ?? null;
    this.drawBoxes(targets, primary);
    this.drawDim(primary);
    this.selectorEl.textContent = selector || '—';
    if (this.selected) {
      this.countEl.textContent = `${targets.length} element${targets.length === 1 ? '' : 's'} matched · step ${this.index + 1}/${this.ladder.length}`;
      this.slider.value = String(this.index);
      this.narrowBtn.disabled = this.index === 0;
      this.broadenBtn.disabled = this.index >= this.ladder.length - 1;
      if (selector) this.applyPreview(selector);
    } else {
      this.countEl.textContent = 'Hover an element, click to pick.';
    }
  }

  private drawBoxes(targets: readonly Element[], primary: Element | null): void {
    this.boxes.textContent = '';
    let drawn = 0;
    for (const target of targets) {
      if (drawn >= MAX_BOXES) break;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const box = el(this.doc, 'div', { className: target === primary ? 'box' : 'box secondary' });
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      this.boxes.append(box);
      drawn += 1;
    }
  }

  /** Four rectangles around the primary element — a cheap spotlight backdrop. */
  private drawDim(primary: Element | null): void {
    const [top, right, bottom, left] = this.dims;
    if (!top || !right || !bottom || !left) return;
    if (!primary) {
      for (const dim of this.dims) dim.style.display = 'none';
      return;
    }
    const r = primary.getBoundingClientRect();
    const vw = this.win.innerWidth;
    const vh = this.win.innerHeight;
    const place = (dim: HTMLElement, x: number, y: number, w: number, h: number): void => {
      dim.style.display = w > 0 && h > 0 ? 'block' : 'none';
      dim.style.left = `${x}px`;
      dim.style.top = `${y}px`;
      dim.style.width = `${Math.max(w, 0)}px`;
      dim.style.height = `${Math.max(h, 0)}px`;
    };
    place(top, 0, 0, vw, r.top);
    place(bottom, 0, r.bottom, vw, vh - r.bottom);
    place(left, 0, r.top, r.left, r.height);
    place(right, r.right, r.top, vw - r.right, r.height);
  }

  private flipPanelAway(target: Element): void {
    const rect = target.getBoundingClientRect();
    const panelTop = this.win.innerHeight - 260;
    const overlaps = rect.bottom > panelTop && rect.right > this.win.innerWidth - 360;
    this.panel.classList.toggle('flip', overlaps);
  }

  private applyPreview(selector: string): void {
    const parent = this.doc.head ?? this.doc.documentElement;
    if (!parent) return;
    const style = el(this.doc, 'style', {
      id: PREVIEW_ID,
      textContent: `${selector}{display:none!important;}`,
    });
    parent.appendChild(style);
    this.preview = style;
  }

  private clearPreview(): void {
    this.preview?.remove();
    this.preview = null;
  }
}
