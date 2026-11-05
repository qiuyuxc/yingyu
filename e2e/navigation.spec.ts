import { expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { test, completeAuthentication, withPostLoginAnnouncement } from './helpers';

const PASSWORD = 'browser-test-password-2026';
const ORIGIN = 'http://127.0.0.1:4173';

async function enterWorkspace(page: Page, identity = 'tour-a') {
  await page.goto('/login');
  await expect(page.locator('.auth-card')).toBeVisible();
  await page.getByLabel('邮箱地址', { exact: true }).fill(`${identity}-${test.info().project.name}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
  await completeAuthentication(page, '登录我的空间');
  await expect(page.getByRole('dialog', { name: '使用引导' })).toBeVisible();
}

test('tour follows real upload actions, waits for successful upload and copying, and can replay before logout', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async (value: string) => {
      if (sessionStorage.getItem('test:clipboard-fail')) throw new Error('复制失败，请重试');
      sessionStorage.setItem('test:clipboard', value);
    } },
  }));
  await enterWorkspace(page);
  const tour = page.getByRole('dialog', { name: '使用引导' });
  const atStep = async (number: number) => {
    await expect(tour).toContainText(`${number} / 5`);
    await expect.poll(() => page.locator('.tour-card').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
    })).toBe(true);
  };
  await expect(tour).toContainText('一起上传并分享一张图片');
  await tour.getByRole('button', { name: '开始操作' }).click();
  await atStep(1);
  await expect(tour.getByRole('button', { name: '下一步' })).toHaveCount(0);
  await page.getByRole('navigation', { name: '工作台导航' }).getByRole('link', { name: '上传图片', exact: true }).click();
  await atStep(2);
  await page.locator('.page-heading').getByRole('link', { name: '我的图片' }).click();
  await expect(tour).toContainText('引导已暂停');
  await tour.getByRole('button', { name: '返回上传页' }).click();
  await atStep(2);
  await page.getByLabel('选择上传图片').setInputFiles({ name: 'not-an-image.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.locator('.toast.error').filter({ hasText: '不支持的图片格式' })).toBeVisible();
  await atStep(2);
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '选择图片', exact: true }).click();
  await (await picker).setFiles(resolve('public/samples/forest.jpg'));
  await atStep(3);
  await page.getByRole('button', { name: /私密.*仅自己和管理员可见/ }).click();
  await atStep(4);
  await page.route('**/api/images', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '临时存储失败，请重试' }) }));
  await page.getByRole('button', { name: '开始上传', exact: true }).click();
  await expect(page.locator('.queue-row.error')).toHaveCount(1);
  await expect(tour).toContainText('上传失败');
  await atStep(4);
  await page.unroute('**/api/images');
  await page.getByRole('button', { name: '上传 / 重试', exact: true }).click();
  await atStep(5);
  await expect(page.locator('.queue-row.done')).toHaveCount(1);
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await page.evaluate(() => sessionStorage.setItem('test:clipboard-fail', '1'));
  await page.getByRole('button', { name: '复制全部链接' }).click();
  await expect(page.locator('.toast.error').filter({ hasText: '复制失败' })).toBeVisible();
  await atStep(5);
  await page.evaluate(() => sessionStorage.removeItem('test:clipboard-fail'));
  await page.getByRole('button', { name: '复制全部链接' }).click();
  await expect(tour).toContainText('上传和分享，你已经学会了');
  expect(await page.evaluate(() => sessionStorage.getItem('test:clipboard'))).toBe(await page.getByLabel('成功上传的图片链接').inputValue());
  await tour.getByRole('link', { name: '查看我的图片' }).click();
  await expect(tour).toHaveCount(0);
  await expect(page.locator('.image-card')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: '我的图片', exact: true })).toBeVisible();
  await expect(tour).toHaveCount(0);
  await page.getByRole('button', { name: '使用引导', exact: true }).click();
  await expect(tour).toContainText('一起上传并分享一张图片');
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);

  const trigger = page.getByRole('button', { name: '账户菜单' });
  await trigger.click();
  const menu = page.getByRole('menu', { name: '账户操作' });
  await expect(menu.getByRole('menuitem', { name: '账户设置' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: '退出登录' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('heading', { name: '我的图片', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '暂时无法退出' }) }));
  await trigger.click();
  await menu.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page.locator('.toast.error')).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
  await page.unroute('**/api/auth/logout');
  // Disabling the logout item may blur it; close via a pointer action before retrying.
  await page.getByRole('heading', { name: '我的图片', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await menu.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  await enterWorkspace(page, 'tour-b');
  await tour.getByRole('button', { name: '跳过引导' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: '我的图片', exact: true })).toBeVisible();
  await expect(tour).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('mobile horizontal gestures open and close navigation while vertical and input gestures are ignored', async ({ page, context, isMobile }) => {
  test.skip(!isMobile, 'Touch navigation applies to the mobile layout.');
  await enterWorkspace(page, 'gesture');
  await page.getByRole('button', { name: '跳过引导' }).click();
  const cdp = await context.newCDPSession(page);
  const swipe = async (x: number, y: number, dx: number, dy: number, cancel = false) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 6, y: y + dy * i / 6 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  };
  const sidebar = page.locator('#workspace-navigation');
  const heading = await page.getByRole('heading', { name: '我的图片', exact: true }).boundingBox();
  await swipe(40, heading!.y + 12, 130, 3, true);
  await expect(sidebar).not.toHaveClass(/expanded/);
  await swipe(40, heading!.y + 12, 8, 140);
  await expect(sidebar).not.toHaveClass(/expanded/);
  await swipe(40, heading!.y + 12, 140, 3);
  await expect(sidebar).toHaveClass(/expanded/);
  await expect(page.locator('.workspace-body')).toHaveAttribute('inert', '');
  await expect(sidebar).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const label = await sidebar.locator('.nav-section-label').first().boundingBox();
  await swipe(175, label!.y + 5, -120, 2);
  await expect(sidebar).not.toHaveClass(/expanded/);
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('navigation', { name: '工作台导航' }).getByRole('link', { name: '上传图片', exact: true }).click();
  await expect(sidebar).not.toHaveClass(/expanded/);
  await expect(page.getByRole('heading', { name: '上传图片', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('navigation', { name: '工作台导航' }).getByRole('link', { name: /^我的图片/ }).click();
  const input = await page.locator('.search-field input').boundingBox();
  await swipe(input!.x + 12, input!.y + 12, 100, 1);
  await expect(sidebar).not.toHaveClass(/expanded/);
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.keyboard.press('Escape');
  await expect(sidebar).not.toHaveClass(/expanded/);
  await expect(page.getByRole('button', { name: '打开导航' })).toBeFocused();
});

test('announcements appear only after login, keep published history in the center, and remember each revision', async ({ page, request }) => {
  const admin = await request.post('/api/auth/login', { headers: { Origin: ORIGIN }, data: { email: 'admin@example.test', password: PASSWORD } });
  expect(admin.status()).toBe(200);
  const created: string[] = [];
  const create = async (title: string, content: string, status = 'published', popup = false) => {
    const result = await request.post('/api/admin/announcements', { headers: { Origin: ORIGIN }, data: { title, content, status, popup } });
    expect(result.status()).toBe(201);
    const post = (await result.json()).announcement; created.push(post.id); return post;
  };
  try {
    await create('历史公告', '较早发布的内容');
    await create('仅管理员可见的草稿', '尚未发布', 'draft');
    let post = await create('本站公告测试', '欢迎使用\n\n<script>window.announcementInjected = true</script>\n' + '详细公告内容。\n'.repeat(180), 'published', true);
    const edit = async (changes: object) => {
      const result = await request.patch('/api/admin/announcements/' + post.id, { headers: { Origin: ORIGIN }, data: { ...post, ...changes } });
      expect(result.status()).toBe(200); post = (await result.json()).announcement;
    };
    await page.goto('/login');
    await expect(page.getByRole('button', { name: '登录我的空间' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await page.request.get('/api/announcements')).status()).toBe(401);
    await page.getByLabel('邮箱地址', { exact: true }).fill(`notice-${test.info().project.name}@example.test`);
    await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: '登录我的空间' }).click();
    const notice = page.getByRole('dialog', { name: '本站公告测试' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('<script>');
    expect(await page.evaluate(() => 'announcementInjected' in window)).toBe(false);
    expect(await notice.evaluate(element => element.getBoundingClientRect().width <= innerWidth)).toBe(true);
    expect(await notice.locator('.login-announcement-content').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '跳过引导' }).click();
    await page.reload();
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: '不再弹出' }).click();
    await withPostLoginAnnouncement(page, () => page.reload());
    await expect(notice).not.toBeVisible();
    const menu = page.getByRole('button', { name: '打开导航' });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('navigation', { name: '工作台导航' }).getByRole('link', { name: '公告中心' }).click();
    await expect(page.getByRole('heading', { name: '公告中心' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '历史公告', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '仅管理员可见的草稿', exact: true })).toHaveCount(0);
    await page.locator('.announcement-entry').filter({ hasText: '本站公告测试' }).getByRole('button', { name: '阅读全文' }).click();
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: '我知道了' }).click();
    await edit({ content: '更新后的第二版公告' });
    await page.reload();
    await expect(notice).toContainText('更新后的第二版公告');
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: '不再弹出' }).click();
    await edit({ popup: false });
    await withPostLoginAnnouncement(page, () => page.reload());
    await expect(notice).not.toBeVisible();
    await expect(page.getByRole('heading', { name: '本站公告测试', exact: true })).toBeVisible();
    await edit({ status: 'draft' });
    await withPostLoginAnnouncement(page, () => page.reload());
    await expect(page.getByRole('heading', { name: '本站公告测试', exact: true })).toHaveCount(0);
  } finally {
    for (const id of created) await request.delete('/api/admin/announcements/' + id, { headers: { Origin: ORIGIN } });
  }
});
