import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import type { AppConfig } from '../server/config.js';
import { insertUser, now, openDatabase, transaction, type Row } from '../server/db.js';
import { encryptConfig, hashPassword, hashToken, newToken } from '../server/security.js';

export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=', 'base64');
export const TEST_PASSWORD = 'test-only-password-2026';
export const ORIGIN = 'http://localhost:5173';
export const staleTime = () => new Date(Date.now() - 20 * 60_000).toISOString();

export async function fixture(t: TestContext, overrides: Partial<AppConfig> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'yingyu-test-'));
  const config: AppConfig = { dataDir, publicUrl: ORIGIN, encryptionKey: randomBytes(32), production: false, integrationToken: '', ...overrides };
  const db = openDatabase(dataDir);
  const app = createApp(db, config);
  t.after(async () => { db.close(); await rm(dataDir, { recursive: true, force: true }); });

  const request = (path: string, init: RequestInit = {}) => app.request(new URL(path, config.publicUrl), init);
  const json = (path: string, method: string, body: unknown, cookie?: string, extraHeaders: Record<string, string> = {}) => request(path, {
    method,
    headers: { Origin: config.publicUrl, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
    body: JSON.stringify(body),
  });
  const session = (user: Row) => {
    const token = newToken();
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashToken(token), user.id, new Date(Date.now() + 3600_000).toISOString());
    return 'yingyu_session=' + token;
  };
  const user = async (options: { role?: 'user' | 'admin'; name?: string; email?: string; quotaBytes?: number; password?: string } = {}) => {
    const row = insertUser(db, { name: options.name || '测试用户', email: options.email || randomUUID() + '@example.test', role: options.role, quotaBytes: options.quotaBytes, passwordHash: await hashPassword(options.password || TEST_PASSWORD) });
    return { ...row, cookie: session(row) } as Row & { cookie: string };
  };
  const upload = async (cookie: string | null, options: { bytes?: Buffer; name?: string; visibility?: string; albumId?: string; token?: string; declaredType?: string } = {}) => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array(options.bytes || PNG)], options.name || 'image.png', { type: options.declaredType || 'image/png' }));
    if (options.visibility) form.set('visibility', options.visibility);
    if (options.albumId) form.set('albumId', options.albumId);
    const encoded = new Request(config.publicUrl, { method: 'POST', body: form });
    const bytes = await encoded.arrayBuffer();
    return request('/api/images', {
      method: 'POST',
      headers: { Origin: config.publicUrl, 'Content-Type': encoded.headers.get('content-type')!, 'Content-Length': String(bytes.byteLength), ...(cookie ? { Cookie: cookie } : {}), ...(options.token ? { Authorization: 'Bearer ' + options.token } : {}) },
      body: bytes,
    });
  };
  return { db, config, app, request, json, session, user, upload };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;

export async function readRequest(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function webdav(t: TestContext, f?: Fixture) {
  type Gate = { entered: Promise<void>; release: () => void; enter: () => void; resume: Promise<void> };
  const gates = new Map<string, Gate>();
  const allGates = new Set<Gate>();
  const objects = new Map<string, Buffer>();
  const calls: { method: string; path: string; authorization?: string }[] = [];
  const control = { failPut: false, persistFailedPut: false, failDelete: false, redirect: false };
  const server = createServer(async (req, res) => {
    try {
      const method = req.method!;
      const path = new URL(req.url!, 'http://localhost').pathname;
      calls.push({ method, path, authorization: req.headers.authorization });
      const data = await readRequest(req);
      const gate = gates.get(method);
      if (gate) { gates.delete(method); gate.enter(); await gate.resume; }
      if (control.redirect) { res.writeHead(302, { Location: '/redirected' }); res.end(); return; }
      if (req.headers.authorization !== 'Basic ' + Buffer.from('tester:fixture-secret').toString('base64')) { res.writeHead(401); res.end(); return; }
      if (method === 'MKCOL') { res.writeHead(405); res.end(); return; }
      if (method === 'PUT') {
        if (!control.failPut || control.persistFailedPut) objects.set(path, data);
        res.writeHead(control.failPut ? 500 : 201); res.end(); return;
      }
      if (method === 'GET') {
        const object = objects.get(path);
        res.writeHead(object ? 200 : 404, { 'Content-Type': 'application/octet-stream' }); res.end(object); return;
      }
      if (method === 'DELETE') {
        if (control.failDelete) { res.writeHead(500); res.end(); return; }
        const existed = objects.delete(path);
        res.writeHead(existed ? 204 : 404); res.end(); return;
      }
      res.writeHead(405); res.end();
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const gate of allGates) gate.release();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/dav/`;
  const config = { endpoint, username: 'tester', password: 'fixture-secret', path: '图片 library' };
  const blockNext = (method: string) => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const gate = { entered, resume, enter, release };
    gates.set(method, gate); allGates.add(gate);
    return { entered, release };
  };
  const id = randomUUID();
  if (f) transaction(f.db, () => {
    f.db.prepare('UPDATE storage_providers SET active=0').run();
    f.db.prepare('INSERT INTO storage_providers(id,name,kind,config,active,created_at) VALUES(?,?,?,?,1,?)').run(id, '测试 WebDAV', 'webdav', encryptConfig(config, f.config.encryptionKey), now());
  });
  return { id, config, objects, calls, control, blockNext };
}
