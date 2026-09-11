/**
 * Element picker bootstrap. The picker UI itself is an ISOLATED-world content script
 * (`src/content/picker.ts`, workstream T5) injected on demand.
 * docs/COSMETIC-FILTERING.md §5.
 */
import { isWebUrl } from '@iublocker/shared';
import { errorMessage, log } from './log';
import * as store from './storage/store';

export const PICKER_FILE = 'content/picker.js';

export async function startPicker(tabId: number): Promise<boolean> {
  let url = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    url = tab?.url ?? '';
  } catch (err) {
    throw new Error(`no such tab: ${errorMessage(err)}`);
  }
  if (!isWebUrl(url)) throw new Error('the picker cannot run on this page');

  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: [PICKER_FILE],
      world: 'ISOLATED',
      injectImmediately: true,
    });
  } catch (err) {
    log.error('picker injection failed', err);
    throw new Error(`could not start the picker: ${errorMessage(err)}`);
  }
  await store.session.setPickerActive(tabId, true);
  return true;
}

export async function stopPicker(tabId: number): Promise<void> {
  await store.session.setPickerActive(tabId, false);
}
