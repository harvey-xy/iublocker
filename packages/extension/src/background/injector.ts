/**
 * Injector — the only per-navigation work the worker does. docs/ARCHITECTURE.md §4.
 *
 * On `webNavigation.onCommitted` for an http(s) frame:
 *   1. resolve the site mode for the *top-level* hostname;
 *   2. mode ≥ optimal → `insertCSS({origin:'USER'})` with the specific selectors and
 *      `:style()` rules for the frame's hostname, in chunks of ≤ 1,000 selectors;
 *   3. mode ≥ optimal → `executeScript({world:'MAIN', injectImmediately:true})` for the
 *      dynamic (user/delta) scriptlets, passing the bundled function object directly.
 */
import { hostnameFromUrl, modeAtLeast, type SiteMode } from '@iublocker/shared';
import { resolveScriptlet } from '@iublocker/scriptlets';
import * as cosmetic from './cosmetic/index';
import { errorMessage, log } from './log';
import * as scriptlets from './scriptlets/index';
import { resolveMode } from './siteModes';
import * as store from './storage/store';

export const MAX_SELECTORS_PER_CHUNK = 1_000;

export interface CommittedDetails {
  tabId: number;
  frameId: number;
  url: string;
}

/** Frames we already pushed CSS into (`tabId:frameId:hostname`). Pure cache. */
const injectedFrames = new Set<string>();
const INJECTED_MAX = 2_000;

const frameKey = (tabId: number, frameId: number, hostname: string): string =>
  `${tabId}:${frameId}:${hostname}`;

export function wasInjected(tabId: number, frameId: number, hostname: string): boolean {
  return injectedFrames.has(frameKey(tabId, frameId, hostname));
}

function noteInjected(tabId: number, frameId: number, hostname: string): void {
  if (injectedFrames.size >= INJECTED_MAX) injectedFrames.clear();
  injectedFrames.add(frameKey(tabId, frameId, hostname));
}

export function forgetTab(tabId: number): void {
  for (const key of [...injectedFrames]) {
    if (key.startsWith(`${tabId}:`)) injectedFrames.delete(key);
  }
}

function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/** CSS payloads for one frame: hiding selectors chunked, plus `:style()` rules. */
export function buildCssChunks(
  selectors: readonly string[],
  styles: readonly [selector: string, style: string][],
  chunkSize = MAX_SELECTORS_PER_CHUNK,
): string[] {
  const out: string[] = [];
  const unique = [...new Set(selectors)].filter((s) => s.length > 0);
  for (let i = 0; i < unique.length; i += chunkSize) {
    out.push(`${unique.slice(i, i + chunkSize).join(',')}{display:none!important;}`);
  }
  const byStyle = new Map<string, string[]>();
  const styleCss: string[] = [];
  const seenAtRules = new Set<string>();
  for (const [selector, style] of styles) {
    if (!selector || !style) continue;
    // AdGuard `#$#` filters can carry an at-rule (`@media (…) { … }`) in the selector slot.
    // Those cannot share a selector list, so each becomes its own rule.
    if (selector.startsWith('@')) {
      const rule = `${selector}{${style}}`;
      if (!seenAtRules.has(rule)) {
        seenAtRules.add(rule);
        styleCss.push(rule);
      }
      continue;
    }
    const list = byStyle.get(style) ?? [];
    if (!list.includes(selector)) list.push(selector);
    byStyle.set(style, list);
  }
  for (const [style, sels] of byStyle) styleCss.push(`${sels.join(',')}{${style}}`);
  if (styleCss.length) out.push(styleCss.join('\n'));
  return out;
}

/** Top-level hostname for a frame; sub-frames read the tab's own URL. */
export async function resolveTopHostname(tabId: number, frameId: number, url: string): Promise<string> {
  if (frameId === 0) return hostnameFromUrl(url);
  const cached = await store.session.getTab(tabId);
  if (cached?.hostname) return cached.hostname;
  try {
    const tab = await chrome.tabs.get(tabId);
    const hostname = hostnameFromUrl(tab?.url ?? '');
    if (hostname) await store.session.patchTab(tabId, { hostname, lastUrl: tab?.url ?? '' });
    return hostname;
  } catch {
    return hostnameFromUrl(url);
  }
}

async function injectCosmetic(details: CommittedDetails, hostname: string, mode: SiteMode): Promise<void> {
  const lookup = await cosmetic.lookup(hostname);
  if (lookup.elemhide) return;
  const selectors = lookup.specifichide ? [] : lookup.selectors;
  const styles = lookup.specifichide ? [] : lookup.styles;
  const chunks = buildCssChunks(selectors, styles);
  if (chunks.length === 0) return;
  for (const css of chunks) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: details.tabId, frameIds: [details.frameId] },
        origin: 'USER',
        css,
      });
    } catch (err) {
      log.debug(`insertCSS failed for ${hostname} (${mode})`, errorMessage(err));
      return;
    }
  }
  noteInjected(details.tabId, details.frameId, hostname);
}

async function injectScriptlets(details: CommittedDetails, hostname: string): Promise<void> {
  const calls = await scriptlets.lookupDynamic(hostname);
  if (calls.length === 0) return;
  await Promise.all(
    calls.map(async (call) => {
      const def = resolveScriptlet(call.name);
      if (!def) {
        log.debug(`unknown scriptlet ${call.name} for ${hostname}`);
        return;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: details.tabId, frameIds: [details.frameId] },
          world: 'MAIN',
          injectImmediately: true,
          func: def.fn,
          args: call.args,
        });
      } catch (err) {
        log.debug(`executeScript(${call.name}) failed on ${hostname}`, errorMessage(err));
      }
    }),
  );
}

export async function handleCommitted(details: CommittedDetails): Promise<void> {
  if (!isHttpUrl(details.url)) return;
  const hostname = hostnameFromUrl(details.url);
  if (!hostname) return;

  if (details.frameId === 0) {
    forgetTab(details.tabId);
    await store.session.patchTab(details.tabId, { hostname, lastUrl: details.url, blocked: 0, matched: [] });
  }

  const topHostname = (await resolveTopHostname(details.tabId, details.frameId, details.url)) || hostname;
  const mode = await resolveMode(topHostname);
  if (!modeAtLeast(mode, 'optimal')) return;

  await Promise.all([injectCosmetic(details, hostname, mode), injectScriptlets(details, hostname)]);
}

/** Synchronous listener (registered at the top level of index.ts). */
export function onCommitted(details: CommittedDetails): void {
  void handleCommitted(details).catch((err) => log.error('onCommitted failed', err));
}

export function __resetForTests(): void {
  injectedFrames.clear();
}
