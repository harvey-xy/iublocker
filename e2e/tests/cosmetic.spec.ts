/**
 * Cosmetic filtering (docs/COSMETIC-FILTERING.md) from e2e/fixtures/test-list.txt:
 *   127.0.0.1##.ad-banner
 *   127.0.0.1###sponsored
 *   127.0.0.1#?#.card:has-text(Sponsored)      ← procedural, `complete` mode only
 */
import { expect, test } from '../fixtures/extension';

test.afterEach(async ({ sendRequest }) => {
  await sendRequest({ type: 'site:setMode', hostname: '127.0.0.1', mode: null }).catch(() => undefined);
});

test('specific selectors are hidden in the default (optimal) mode', async ({ page, server }) => {
  await page.goto(server.url('/cosmetic.html'));
  await expect(page.locator('#ready')).toHaveText('ready');

  await expect(page.locator('#ad-banner-1')).toBeHidden();
  await expect(page.locator('#sponsored')).toBeHidden();
  await expect(page.locator('#content')).toBeVisible();
});

test('procedural filters apply in complete mode only', async ({ page, server, sendRequest }) => {
  await page.goto(server.url('/cosmetic.html'));
  // optimal: :has-text() is not evaluated, the card stays visible.
  await expect(page.locator('#card-sponsored')).toBeVisible();

  await sendRequest({ type: 'site:setMode', hostname: '127.0.0.1', mode: 'complete' });
  await page.reload();

  await expect(page.locator('#card-sponsored')).toBeHidden();
  await expect(page.locator('#card-sponsored-nested')).toBeHidden();
  await expect(page.locator('#card-regular')).toBeVisible();
  await expect(page.locator('#content')).toBeVisible();
});

test('hiding survives DOM mutations', async ({ page, server, sendRequest }) => {
  await sendRequest({ type: 'site:setMode', hostname: '127.0.0.1', mode: 'complete' });
  await page.goto(server.url('/cosmetic.html'));
  await expect(page.locator('#ad-banner-1')).toBeHidden();

  await page.evaluate(() => {
    const injected = document.createElement('div');
    injected.className = 'ad-banner';
    injected.id = 'ad-banner-late';
    injected.textContent = 'late ad';
    document.body.append(injected);

    const card = document.createElement('div');
    card.className = 'card';
    card.id = 'card-late';
    card.textContent = 'Sponsored — added later';
    document.body.append(card);
  });

  await expect(page.locator('#ad-banner-late')).toBeHidden();
  await expect(page.locator('#card-late')).toBeHidden();
});
