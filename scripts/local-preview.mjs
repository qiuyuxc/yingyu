#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'data/local-app-preview');
const stateFile = resolve(directory, 'server.json');
const credentialsFile = resolve(directory, 'accounts.json');
const logFile = resolve(directory, 'server.log');
const mode = process.argv[2] || 'start';
const read = path => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const previous = read(stateFile);

async function seedPreviewAnnouncements() {
  const marker = resolve(directory, 'announcements-seeded');
  if (existsSync(marker)) return;
  const { openDatabase } = await import('../dist-server/server/db.js');
  const previewDb = openDatabase(directory);
  try {
    const time = new Date().toISOString();
    const earlier = new Date(Date.now() - 86400_000).toISOString();
    const insert = previewDb.prepare("INSERT OR IGNORE INTO announcements(id,title,content,status,popup,created_at,updated_at,published_at) VALUES(?,?,?,'published',?,?,?,?)");
    insert.run('11111111-1111-4111-8111-111111111101', '欢迎来到映屿', '这是本地测试站点的示例公告。\n\n登录后可以收到最新公告，在“我的 → 公告中心”查看历史通知。选择“不再弹出”后，该版本不会重复提醒，公告更新后会再次提醒。', 1, time, time, time);
    insert.run('11111111-1111-4111-8111-111111111102', '整理与分享你的图片', '相册里的图片可以连续向下浏览。长按图片可以收藏、分享、移动到相册，也可以选择多张一起操作。', 0, earlier, earlier, earlier);
    const banner = previewDb.prepare("SELECT value FROM settings WHERE key='announcement'").get();
    if (!JSON.parse(banner?.value || '\"\"').trim()) {
      previewDb.prepare("UPDATE settings SET value=? WHERE key='announcement'").run(JSON.stringify('本站为本地测试站点，示例图片仅用于界面演示。'));
    }
  } finally { previewDb.close(); }
  writeFileSync(marker, new Date().toISOString() + '\n', { mode: 0o600 });
}

if (mode === 'status') {
  console.log(JSON.stringify({ ...previous, running: Boolean(previous && alive(previous.pid)), accountsFile: credentialsFile, logFile }, null, 2));
  process.exit(0);
}
if (!['start', 'stop'].includes(mode)) throw new Error('Usage: npm run preview:local -- [start|stop|status]');
if (mode === 'stop') {
  if (previous && alive(previous.pid)) {
    // Do not stop a process if the recorded PID has been reused for something else.
    if (existsSync(`/proc/${previous.pid}/cmdline`) && !readFileSync(`/proc/${previous.pid}/cmdline`, 'utf8').includes(resolve(root, 'dist-server/server/index.js'))) {
      throw new Error('Recorded PID belongs to another process; it was not stopped.');
    }
    process.kill(previous.pid, 'SIGTERM');
    for (let attempt = 0; attempt < 50 && alive(previous.pid); attempt++) await delay(100);
    if (alive(previous.pid)) throw new Error('The preview server is still stopping; inspect its log.');
  }
  console.log('本地测试服务已停止，测试数据保留。');
  process.exit(0);
}
if (previous && alive(previous.pid)) {
  await seedPreviewAnnouncements();
  console.log(`本地测试服务已运行：${previous.url}\n账号文件：${credentialsFile}`);
  process.exit(0);
}
if (!existsSync(resolve(root, 'dist-server/server/index.js')) || !existsSync(resolve(root, 'dist/index.html'))) {
  throw new Error('请先运行 npm run build');
}

mkdirSync(directory, { recursive: true, mode: 0o700 });
const addresses = Object.entries(networkInterfaces()).flatMap(([name, values]) =>
  (values || []).filter(value => !value.internal && value.family === 'IPv4' && !/^(tun|tap|docker|veth)/.test(name)));
const localIp = addresses.find(value => value.address.startsWith('192.168.'))?.address || addresses.find(value => value.address.startsWith('10.'))?.address || '127.0.0.1';
const port = Number(process.env.PREVIEW_PORT || 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PREVIEW_PORT must be between 1024 and 65535');
const url = new URL(process.env.PREVIEW_PUBLIC_URL || `http://${localIp}:${port}`).origin;
const accounts = read(credentialsFile) || {
  admin: { email: 'admin@yingyu.test', name: '测试管理员', password: 'Yy-' + randomBytes(9).toString('base64url') },
  user: { email: 'user@yingyu.test', name: '测试用户', password: 'Yy-' + randomBytes(9).toString('base64url') },
};
if (!existsSync(credentialsFile)) writeFileSync(credentialsFile, JSON.stringify(accounts, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const { openDatabase, insertUser } = await import('../dist-server/server/db.js');
const { hashPassword } = await import('../dist-server/server/security.js');
const db = openDatabase(directory);
for (const [role, account] of Object.entries(accounts)) {
  if (!db.prepare('SELECT id FROM users WHERE email=?').get(account.email)) {
    insertUser(db, { ...account, role, passwordHash: await hashPassword(account.password) });
  }
}
db.prepare("UPDATE settings SET value=? WHERE key='siteName'").run(JSON.stringify('映屿 · 本地测试'));
db.close();
const log = openSync(logFile, 'a', 0o600);
const child = spawn(process.execPath, [resolve(root, 'dist-server/server/index.js')], {
  cwd: root, detached: true, stdio: ['ignore', log, log],
  env: { ...process.env, HOST: '0.0.0.0', PORT: String(port), PUBLIC_URL: url,
    DATA_DIR: directory, NODE_ENV: 'development', ENCRYPTION_KEY: '', QUOTA_INTEGRATION_TOKEN: '', TRUST_PROXY: '0' },
});
closeSync(log);
child.unref();
writeFileSync(stateFile, JSON.stringify({ pid: child.pid, url, port, startedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
let ready = false;
for (let attempt = 0; attempt < 50; attempt++) {
  if (!alive(child.pid)) throw new Error(`测试服务启动失败，请查看 ${logFile}`);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/mobile/v1/capabilities`, { signal: AbortSignal.timeout(1000) });
    ready = response.ok && (await response.json()).apiVersion === 1;
    if (ready) break;
  } catch { /* Wait for the local listener. */ }
  await delay(100);
}
if (!ready) throw new Error(`测试服务未就绪，请查看 ${logFile}`);
await seedPreviewAnnouncements();

const marker = resolve(directory, 'seeded');
if (!existsSync(marker)) {
  for (const [role, account] of Object.entries(accounts)) {
    const call = async (path, body, token, method = 'POST') => {
      const response = await fetch(url + path, { method, headers: {
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(`${path}: ${result.error || response.status}`);
      return result;
    };
    const token = (await call('/api/mobile/v1/auth/login', { email: account.email, password: account.password })).session.accessToken;
    const albums = await call('/api/albums', undefined, token, 'GET');
    const album = albums.albums.find(item => item.name === '示例相册') || (await call('/api/albums', { name: '示例相册' }, token)).album;
    const existing = await call('/api/images?limit=100', undefined, token, 'GET');
    for (const [index, [file, name]] of [['forest.jpg', '林间来信.jpg'], ['lake.jpg', '湖畔清晨.jpg'], ['mountain.jpg', '远山与光.jpg']].entries()) {
      if (existing.images.some(image => image.name === name)) continue;
      const form = new FormData();
      form.set('file', new Blob([readFileSync(resolve(root, 'public/samples', file))], { type: 'image/jpeg' }), name);
      form.set('albumId', album.id); form.set('visibility', index === 1 ? 'private' : 'public');
      await call('/api/images', form, token);
    }
    if (role === 'user') {
      const requests = await call('/api/quota/requests', undefined, token, 'GET');
      if (!requests.requests.length) await call('/api/quota/requests', { requestedBytes: 2 * 1024 ** 3, reason: '本地测试扩容审核流程，存放旅行照片。' }, token);
    }
    await call('/api/mobile/v1/auth/logout', {}, token);
  }
  writeFileSync(marker, new Date().toISOString() + '\n', { mode: 0o600 });
}
console.log(`本地测试服务已启动：${url}\n账号文件：${credentialsFile}\n日志：${logFile}\n停止：npm run preview:local -- stop`);
