import { test as base, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

export const test = base.extend({
  extraHTTPHeaders: async ({}, use, info) => {
    const id = createHash('sha256').update(info.testId + ':' + info.retry).digest();
    await use({ 'X-Forwarded-For': '10.' + id[0] + '.' + id[1] + '.' + id[2] });
  },
});

export async function withPostLoginAnnouncement(page: Page, action: () => Promise<unknown>) {
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/announcements/popup' && result.status() === 200);
  await action();
  const { announcement } = await (await response).json();
  if (!announcement) return;
  const { user } = await (await page.request.get('/api/auth/me')).json();
  const dismissed = await page.evaluate(({ key, revision }) => localStorage.getItem(key) === String(revision), { key: `yingyu-announcement-dismissed:${user.id}:${announcement.id}`, revision: announcement.revision });
  if (!dismissed) await page.getByRole('button', { name: '不再弹出', exact: true }).click();
}

export function completeAuthentication(page: Page, button: string) {
  return withPostLoginAnnouncement(page, () => page.getByRole('button', { name: button, exact: true }).click());
}
