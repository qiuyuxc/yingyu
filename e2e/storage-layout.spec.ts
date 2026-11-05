import { expect } from '@playwright/test';
import { test, completeAuthentication } from './helpers';

const ORIGIN = 'http://127.0.0.1:4173';

test('long storage names, endpoints, paths and connection errors fit their cards', async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.goto('/login');
  await page.getByLabel('邮箱地址', { exact: true }).fill(`storage-admin-${info.project.name}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password-2026');
  await completeAuthentication(page, '登录我的空间');
  await page.getByRole('button', { name: '跳过引导', exact: true }).click();
  const records = [
    { name: 'R'.repeat(40), kind: 'r2', config: { endpoint: `https://${'a'.repeat(32)}.eu.r2.cloudflarestorage.com`, bucket: 'b'.repeat(63), accessKeyId: 'fixture-id', secretAccessKey: 'fixture-secret', publicBaseUrl: 'https://images.example.test/' + 'p'.repeat(500) } },
    { name: 'W'.repeat(40), kind: 'webdav', config: { endpoint: 'https://dav.example.test/' + 'e'.repeat(500), path: 'd'.repeat(500), username: 'fixture-user', password: 'fixture-password' } },
  ];
  const created: string[] = [];
  try {
    for (const record of records) {
      const response = await page.request.post('/api/admin/storage', { headers: { Origin: ORIGIN }, data: record });
      expect(response.status()).toBe(201);
      created.push((await response.json()).provider.id);
    }
    await page.goto('/admin/storage');
    const card = page.locator('.storage-card').filter({ hasText: records[0].name });
    await expect(card).toBeVisible();
    const error = 'EndpointUnavailable:' + 'x'.repeat(400);
    await page.route(`**/api/admin/storage/${created[0]}/test`, route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error }) }));
    await card.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(card.locator('.connection-result')).toContainText(error);
    const widths = info.project.name === 'mobile' ? [393, 320] : [1440, 1100, 900, 700];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 960 });
      await expect.poll(() => page.evaluate(() => {
        const grid = document.querySelector('.storage-grid')!.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>('.storage-card')].every(element => {
          const rect = element.getBoundingClientRect();
          return rect.left >= grid.left - 1 && rect.right <= grid.right + 1 && element.scrollWidth <= element.clientWidth + 1;
        }) && document.documentElement.scrollWidth <= innerWidth + 1;
      }), { message: `storage cards overflow at ${width}px` }).toBe(true);
      await expect(card.getByRole('heading', { name: records[0].name })).toBeVisible();
      await expect(card.getByRole('button', { name: '设为默认', exact: true })).toBeVisible();
    }
    await card.getByRole('button', { name: '编辑存储 ' + records[0].name, exact: true }).click();
    await expect(page.getByLabel('服务端点', { exact: true })).toHaveValue(records[0].config.endpoint);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally {
    for (const id of created) expect((await page.request.delete('/api/admin/storage/' + id, { headers: { Origin: ORIGIN } })).status()).toBe(200);
  }
});
