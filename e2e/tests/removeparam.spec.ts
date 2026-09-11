/**
 * $removeparam=utm_source — tracking parameters are stripped from navigations while the
 * rest of the query survives.
 */
import { expect, test } from '../fixtures/extension';

test('utm_source is stripped from an automatic navigation', async ({ page, server }) => {
  await page.goto(server.url('/removeparam.html'));
  await page.waitForURL(/auto=1/);

  const url = new URL(page.url());
  expect(url.searchParams.get('utm_source')).toBeNull();
  expect(url.searchParams.get('keep')).toBe('1');
  expect(url.searchParams.get('auto')).toBe('1');
  await expect(page.locator('#utm')).toHaveText('null');
  await expect(page.locator('#keep')).toHaveText('1');
});

test('utm_source is stripped when following a link', async ({ page, server }) => {
  await page.goto(server.url('/removeparam.html?keep=1'));
  await page.locator('#link').click();
  await page.waitForURL(/keep=1/);

  expect(new URL(page.url()).searchParams.get('utm_source')).toBeNull();
  await expect(page.locator('#keep')).toHaveText('1');
});
