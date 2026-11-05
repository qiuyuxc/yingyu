import { expect } from '@playwright/test';
import { test, completeAuthentication } from './helpers';

const ORIGIN = 'http://127.0.0.1:4173';
const PASSWORD = 'browser-test-password-2026';

test('small announcement dismissals survive reloads and tabs, stay per account and reset for new content', async ({ page, context, request }, info) => {
  test.setTimeout(60_000);
  const admin = await request.post('/api/auth/login', { headers: { Origin: ORIGIN }, data: { email: 'admin@example.test', password: PASSWORD } });
  expect(admin.status()).toBe(200);
  const original = (await (await request.get('/api/site')).json()).settings.announcement;
  const update = async (announcement: string) => {
    const response = await request.patch('/api/admin/announcement-banner', { headers: { Origin: ORIGIN }, data: { announcement } });
    expect(response.status()).toBe(200);
  };
  const login = async (identity: string, firstVisit = true) => {
    await page.goto('/login');
    await page.getByLabel('邮箱地址', { exact: true }).fill(`${identity}-${info.project.name}@example.test`);
    await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
    await completeAuthentication(page, '登录我的空间');
    await expect(page).toHaveURL(/\/app$/);
    if (firstVisit) await page.getByRole('button', { name: '跳过引导', exact: true }).click();
    await expect(page.getByRole('heading', { name: '我的图片', exact: true })).toBeVisible();
  };
  const logout = async () => {
    expect((await page.request.post('/api/auth/logout', { headers: { Origin: ORIGIN } })).status()).toBe(200);
  };
  const banner = page.getByRole('complementary', { name: '站点公告' });
  const reload = async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: '我的图片', exact: true })).toBeVisible();
  };
  try {
    await update('小公告持久化测试');
    await login('banner-a');
    await expect(banner).toContainText('小公告持久化测试');
    await banner.getByRole('button', { name: '关闭公告' }).click();
    await reload();
    await expect(banner).toHaveCount(0);
    await page.goto('/app/upload');
    await page.locator('.page-heading').getByRole('link', { name: '我的图片' }).click();
    await expect(page.getByRole('heading', { name: '我的图片', exact: true })).toBeVisible();
    await expect(banner).toHaveCount(0);
    const tab = await context.newPage();
    try {
      await tab.goto('/app');
      await expect(tab.getByRole('heading', { name: '我的图片', exact: true })).toBeVisible();
      await expect(tab.getByRole('complementary', { name: '站点公告' })).toHaveCount(0);
    } finally { await tab.close(); }
    await logout();
    await login('banner-b');
    await expect(banner).toContainText('小公告持久化测试');
    await logout();
    await login('banner-a', false);
    await expect(banner).toHaveCount(0);
    await update('更新后的小公告');
    await reload();
    await expect(banner).toContainText('更新后的小公告');
    await banner.getByRole('button', { name: '关闭公告' }).click();
    await reload();
    await expect(banner).toHaveCount(0);
  } finally { await update(original); }
});
