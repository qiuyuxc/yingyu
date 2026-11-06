import { expect } from '@playwright/test';
import { test } from './helpers';

test('first visit uses monochrome and follows the system appearance', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'mono');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())).toBe('#f5f5f5');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())).toBe('#171717');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'mono');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('a previously selected palette is preserved on startup', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('yingyu-palette', 'green');
    localStorage.setItem('yingyu-theme', 'dark');
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'green');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'green');
});
