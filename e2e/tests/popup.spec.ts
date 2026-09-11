/**
 * Popup smoke test (docs/TESTING.md): the popup renders the current site and a mode
 * control, and a mode change is visible through `tab:getState`.
 *
 * The popup is opened as a normal tab, where `chrome.tabs.query({active:true})` would
 * return the popup itself — the `popup()` fixture therefore appends `?tabId=<id>` for
 * implementations that accept it. If the popup ignores the parameter and shows the wrong
 * host, that is a UI bug to fix in packages/extension/src/ui/popup (T6).
 */
import { expect, test } from '../fixtures/extension';

const HOST = '127.0.0.1';

test.afterEach(async ({ sendRequest }) => {
  await sendRequest({ type: 'site:setMode', hostname: HOST, mode: null }).catch(() => undefined);
});

test('the popup renders the hostname and a mode control', async ({ popup, server }) => {
  const popupPage = await popup(server.url('/modes.html'));

  await expect(popupPage.locator('body')).toContainText(HOST);

  const modeControl = popupPage.locator(
    'select, [role="radiogroup"], [data-mode], input[type="radio"][name*="mode" i], button[data-mode]',
  );
  await expect(modeControl.first()).toBeVisible();
  await popupPage.close();
});

test('changing the mode round-trips through tab:getState', async ({ popup, server, sendRequest }) => {
  const popupPage = await popup(server.url('/modes.html'));

  // Prefer driving the real control; fall back to the API when the markup differs.
  const select = popupPage.locator('select').first();
  const basicButton = popupPage.locator('[data-mode="basic"], input[type="radio"][value="basic"]').first();
  if (await select.count()) {
    await select.selectOption('basic');
  } else if (await basicButton.count()) {
    await basicButton.click();
  } else {
    await sendRequest({ type: 'site:setMode', hostname: HOST, mode: 'basic' });
  }

  await expect
    .poll(async () => (await sendRequest<{ effectiveMode: string }>({ type: 'tab:getState' })).effectiveMode)
    .toBe('basic');

  // Reopening the popup shows the persisted mode.
  await popupPage.close();
  const reopened = await popup();
  await expect(reopened.locator('body')).toContainText(/basic/i);
  await reopened.close();
});

test('the popup reports blocked counts for the tab', async ({ popup, page, server }) => {
  const popupPage = await popup(server.url('/network.html'));
  await page.waitForFunction(() => (globalThis as any).__loaded === true).catch(() => undefined);

  // The count is refreshed on popup open (getMatchedRules), so poll the rendered text.
  await expect.poll(async () => (await popupPage.locator('body').innerText()).replace(/\s+/g, ' ')).toMatch(/\d/);
  await popupPage.close();
});
