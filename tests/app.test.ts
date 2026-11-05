import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GiB } from '../shared/types.js';
import { fixture, PNG, ORIGIN, TEST_PASSWORD, staleTime, webdav } from './helpers.js';
import type { Row } from '../server/db.js';

test('registration requires initialization and receives the administrator-defined free quota', async t => {
  const f = await fixture(t);
  const input = { name: '新用户', email: 'new@example.test', password: TEST_PASSWORD };
  assert.equal((await f.json('/api/auth/register', 'POST', input)).status, 503);
  await f.user({ role: 'admin' });
  f.db.prepare("UPDATE settings SET value=? WHERE key='defaultQuotaBytes'").run(JSON.stringify(3 * GiB));
  const response = await f.json('/api/auth/register', 'POST', input);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.user.quotaBytes, 3 * GiB);
  assert.equal(body.user.role, 'user');
  assert.equal('passwordHash' in body.user, false);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.equal((await f.request('/api/auth/me', { headers: { Cookie: cookie.split(';')[0] } })).status, 200);
  assert.equal((await f.json('/api/auth/register', 'POST', input)).status, 409);
  f.db.prepare("UPDATE settings SET value='false' WHERE key='registrationOpen'").run();
  assert.equal((await f.json('/api/auth/register', 'POST', { ...input, email: 'second@example.test' })).status, 403);
  assert.equal((await f.json('/api/auth/login', 'POST', { email: input.email, password: TEST_PASSWORD })).status, 200);
});

test('mutations reject an untrusted or absent browser origin and regular users cannot administer', async t => {
  const f = await fixture(t);
  const user = await f.user();
  const headers = { Cookie: user.cookie, 'Content-Type': 'application/json' };
  assert.equal((await f.request('/api/account/profile', { method: 'PATCH', headers, body: '{"name":"other"}' })).status, 403);
  assert.equal((await f.request('/api/account/profile', { method: 'PATCH', headers: { ...headers, Origin: 'https://other.example' }, body: '{"name":"other"}' })).status, 403);
  assert.equal((await f.request('/api/admin/users', { headers: { Cookie: user.cookie } })).status, 403);
  assert.equal((await f.request('/api/images')).status, 401);
});

test('image bytes determine MIME, visibility filters work, and deleting an album retains images', async t => {
  const f = await fixture(t);
  const user = await f.user();
  const album = (await (await f.json('/api/albums', 'POST', { name: '旅行' }, user.cookie)).json()).album;
  const publicResponse = await f.upload(user.cookie, { name: '100%_trip.png', albumId: album.id, declaredType: 'text/plain' });
  assert.equal(publicResponse.status, 201);
  const publicImage = (await publicResponse.json()).image;
  assert.equal(publicImage.mime, 'image/png');
  assert.equal(publicImage.width, 1);
  assert.equal(publicImage.height, 1);
  assert.equal((await f.upload(user.cookie, { visibility: 'private', name: 'private.png' })).status, 201);
  const get = async (query: string) => (await f.request('/api/images?' + query, { headers: { Cookie: user.cookie } })).json();
  assert.equal((await get('visibility=public')).total, 1);
  assert.equal((await get('visibility=private')).total, 1);
  assert.equal((await get('search=' + encodeURIComponent('%_'))).total, 1);
  assert.equal((await get('albumId=' + album.id)).total, 1);
  await f.json('/api/images/' + publicImage.id, 'PATCH', { starred: true }, user.cookie);
  assert.equal((await get('starred=true')).images[0].id, publicImage.id);
  assert.equal((await get('starred=false')).total, 1);
  assert.equal((await f.request('/api/albums/' + album.id, { method: 'DELETE', headers: { Origin: ORIGIN, Cookie: user.cookie } })).status, 200);
  const retained = await get('visibility=public');
  assert.equal(retained.images[0].albumId, null);
  assert.equal(retained.total, 1);
});

test('private originals are available to their owner and browser administrators, never another user or an admin personal token', async t => {
  const f = await fixture(t);
  const owner = await f.user();
  const other = await f.user();
  const admin = await f.user({ role: 'admin' });
  const image = (await (await f.upload(owner.cookie, { visibility: 'private' })).json()).image;
  assert.equal((await f.request('/i/' + image.id)).status, 401);
  assert.equal((await f.request('/i/' + image.id, { headers: { Cookie: other.cookie } })).status, 404);
  const original = await f.request('/i/' + image.id, { headers: { Cookie: owner.cookie } });
  assert.equal(original.status, 200);
  assert.match(original.headers.get('cache-control')!, /private, no-store/);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), PNG);
  assert.equal((await f.request('/i/' + image.id, { headers: { Cookie: admin.cookie } })).status, 200);
  const token = (await (await f.json('/api/account/tokens', 'POST', { name: '管理员个人上传' }, admin.cookie)).json()).token;
  assert.equal((await f.request('/i/' + image.id, { headers: { Authorization: 'Bearer ' + token } })).status, 404);
  assert.equal((await f.request('/api/admin/users', { headers: { Authorization: 'Bearer ' + token } })).status, 403);
  assert.equal((await f.request('/api/images/' + image.id, { method: 'DELETE', headers: { Cookie: other.cookie, Origin: ORIGIN } })).status, 404);
});

test('concurrent uploads reserve bytes before storage and a quota reduction cannot consume reservations', { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  const dav = await webdav(t, f);
  const user = await f.user({ quotaBytes: PNG.length });
  const admin = await f.user({ role: 'admin' });
  const gate = dav.blockNext('PUT');
  const first = f.upload(user.cookie);
  await gate.entered;
  const reserved = f.db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as Row;
  assert.equal(reserved.reserved_bytes, PNG.length);
  assert.equal(reserved.used_bytes, 0);
  const second = await f.upload(user.cookie, { name: 'second.png' });
  assert.equal(second.status, 409);
  const reduced = await f.json('/api/admin/users/' + user.id, 'PATCH', { quotaBytes: 0 }, admin.cookie);
  assert.equal(reduced.status, 409);
  gate.release();
  assert.equal((await first).status, 201);
  const final = f.db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as Row;
  assert.equal(final.reserved_bytes, 0);
  assert.equal(final.used_bytes, PNG.length);
  assert.equal(dav.objects.size, 1);
});

test('failed writes return reservations only after storage cleanup succeeds', async t => {
  const f = await fixture(t);
  const dav = await webdav(t, f);
  const user = await f.user();
  const admin = await f.user({ role: 'admin' });
  dav.control.failPut = true;
  assert.equal((await f.upload(user.cookie)).status, 502);
  let row = f.db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as Row;
  assert.equal(row.reserved_bytes, 0);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM images').get() as Row).n, 0);
  dav.control.persistFailedPut = true;
  dav.control.failDelete = true;
  assert.equal((await f.upload(user.cookie)).status, 502);
  row = f.db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as Row;
  assert.equal(row.reserved_bytes, PNG.length);
  assert.equal(row.used_bytes, 0);
  const pending = (await (await f.request('/api/admin/maintenance', { headers: { Cookie: admin.cookie } })).json()).pending;
  assert.equal(pending.length, 1);
  assert.equal((await f.json('/api/admin/maintenance/' + pending[0].id + '/cleanup', 'POST', {}, admin.cookie)).status, 409);
  f.db.prepare('UPDATE images SET state_changed_at=? WHERE id=?').run(staleTime(), pending[0].id);
  assert.equal((await f.json('/api/admin/maintenance/' + pending[0].id + '/cleanup', 'POST', {}, admin.cookie)).status, 502);
  dav.control.failDelete = false;
  assert.equal((await f.json('/api/admin/maintenance/' + pending[0].id + '/cleanup', 'POST', {}, admin.cookie)).status, 200);
  row = f.db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as Row;
  assert.equal(row.reserved_bytes, 0);
  assert.equal(dav.objects.size, 0);
});

test('failed deletion preserves used quota and an old image cannot be cleaned during a fresh deletion', { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  const dav = await webdav(t, f);
  const user = await f.user();
  const admin = await f.user({ role: 'admin' });
  const image = (await (await f.upload(user.cookie)).json()).image;
  const remove = () => f.request('/api/images/' + image.id, { method: 'DELETE', headers: { Origin: ORIGIN, Cookie: user.cookie } });
  dav.control.failDelete = true;
  assert.equal((await remove()).status, 502);
  assert.equal((f.db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as Row).used_bytes, PNG.length);
  assert.equal((f.db.prepare('SELECT * FROM images WHERE id=?').get(image.id) as Row).state, 'ready');
  dav.control.failDelete = false;
  f.db.prepare('UPDATE images SET created_at=? WHERE id=?').run(staleTime(), image.id);
  const gate = dav.blockNext('DELETE');
  const deleting = remove();
  await gate.entered;
  assert.equal((await f.json('/api/admin/maintenance/' + image.id + '/cleanup', 'POST', {}, admin.cookie)).status, 409);
  assert.equal((await remove()).status, 409);
  gate.release();
  assert.equal((await deleting).status, 200);
  assert.equal((f.db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as Row).used_bytes, 0);
  assert.equal((await remove()).status, 404);
});

test('two concurrent maintenance requests return space exactly once', { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  const dav = await webdav(t, f);
  const user = await f.user();
  const admin = await f.user({ role: 'admin' });
  const image = (await (await f.upload(user.cookie)).json()).image;
  f.db.prepare("UPDATE images SET state='deleting',state_changed_at=? WHERE id=?").run(staleTime(), image.id);
  const clean = () => f.json('/api/admin/maintenance/' + image.id + '/cleanup', 'POST', {}, admin.cookie);
  const gate = dav.blockNext('DELETE');
  const first = clean();
  await gate.entered;
  assert.equal((await clean()).status, 409);
  gate.release();
  assert.equal((await first).status, 200);
  assert.equal((f.db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as Row).used_bytes, 0);
  assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='storage.cleanup'").get() as Row).n, 1);
  assert.equal((await clean()).status, 404);
});

test('expansion requests are unique while pending, reviewed once, and never lower existing quota', async t => {
  const f = await fixture(t);
  const user = await f.user();
  const admin = await f.user({ role: 'admin' });
  const input = { requestedBytes: 2 * GiB, reason: '摄影作品长期存放' };
  const submitted = await f.json('/api/quota/requests', 'POST', input, user.cookie);
  assert.equal(submitted.status, 201);
  const id = (await submitted.json()).request.id;
  assert.equal((await f.json('/api/quota/requests', 'POST', input, user.cookie)).status, 409);
  assert.equal((await f.json('/api/admin/quota-requests/' + id, 'PATCH', { status: 'approved', quotaBytes: GiB / 2 }, admin.cookie)).status, 409);
  const reviewed = await f.json('/api/admin/quota-requests/' + id, 'PATCH', { status: 'approved', quotaBytes: 3 * GiB, adminNote: '已扩容' }, admin.cookie);
  assert.equal(reviewed.status, 200);
  assert.equal((await reviewed.json()).request.status, 'approved');
  assert.equal((await f.json('/api/admin/quota-requests/' + id, 'PATCH', { status: 'rejected' }, admin.cookie)).status, 409);
  const me = await (await f.request('/api/auth/me', { headers: { Cookie: user.cookie } })).json();
  assert.equal(me.user.quotaBytes, 3 * GiB);
  assert.equal(me.user.tier, '扩容额度');
});

test('an unchanged role preserves sessions, while suspension revokes them and hides public images', async t => {
  const f = await fixture(t);
  const admin = await f.user({ role: 'admin' });
  const user = await f.user();
  assert.equal((await f.json('/api/admin/users/' + admin.id, 'PATCH', { role: 'admin', status: 'active', quotaBytes: 2 * GiB }, admin.cookie)).status, 200);
  assert.equal((await f.request('/api/admin/users', { headers: { Cookie: admin.cookie } })).status, 200);
  assert.equal((await f.json('/api/admin/users/' + admin.id, 'PATCH', { role: 'user' }, admin.cookie)).status, 400);
  const image = (await (await f.upload(user.cookie)).json()).image;
  const token = (await (await f.json('/api/account/tokens', 'POST', { name: 'test' }, user.cookie)).json()).token;
  assert.equal((await f.json('/api/admin/users/' + user.id, 'PATCH', { status: 'suspended' }, admin.cookie)).status, 200);
  assert.equal((await f.request('/api/auth/me', { headers: { Cookie: user.cookie } })).status, 401);
  assert.equal((await f.request('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })).status, 401);
  assert.equal((await f.request('/i/' + image.id)).status, 404);
});

test('personal tokens can upload without an Origin and password changes revoke old tokens and sessions', async t => {
  const f = await fixture(t);
  const user = await f.user();
  const otherSession = f.session(user);
  const token = (await (await f.json('/api/account/tokens', 'POST', { name: '博客上传' }, user.cookie)).json()).token;
  const form = new FormData();
  form.set('file', new File([new Uint8Array(PNG)], 'script.png', { type: 'image/png' }));
  const encoded = new Request(ORIGIN, { method: 'POST', body: form });
  const bytes = await encoded.arrayBuffer();
  assert.equal((await f.request('/api/images', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': encoded.headers.get('content-type')!, 'Content-Length': String(bytes.byteLength) }, body: bytes })).status, 201);
  assert.equal((await f.json('/api/account/tokens', 'POST', { name: 'from-token' }, undefined, { Authorization: 'Bearer ' + token })).status, 403);
  const changed = await f.json('/api/account/password', 'PATCH', { currentPassword: TEST_PASSWORD, password: 'new-test-password-2026' }, user.cookie);
  assert.equal(changed.status, 200);
  assert.equal((await f.request('/api/auth/me', { headers: { Cookie: otherSession } })).status, 401);
  assert.equal((await f.request('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })).status, 401);
  assert.equal((await f.request('/api/auth/me', { headers: { Cookie: changed.headers.get('set-cookie')!.split(';')[0] } })).status, 200);
});

test('the external quota interface is opt-in, authenticated, and idempotent', async t => {
  const disabled = await fixture(t);
  assert.equal((await disabled.json('/api/integrations/quota', 'POST', {}, undefined, { Authorization: 'Bearer test' })).status, 404);
  const f = await fixture(t, { integrationToken: 'test-integration-token' });
  const user = await f.user();
  const grant = { userId: user.id, quotaBytes: 4 * GiB, tier: '创作额度', reason: '外部授权', eventId: 'event-001' };
  assert.equal((await f.json('/api/integrations/quota', 'POST', grant, undefined, { Authorization: 'Bearer wrong' })).status, 401);
  const first = await f.json('/api/integrations/quota', 'POST', grant, undefined, { Authorization: 'Bearer test-integration-token' });
  assert.equal(first.status, 200);
  const repeated = await f.json('/api/integrations/quota', 'POST', grant, undefined, { Authorization: 'Bearer test-integration-token' });
  assert.deepEqual(await repeated.json(), await first.json());
  assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='quota.grant'").get() as Row).n, 1);
});

test('storage secrets are encrypted and redacted, and switching storage preserves original locations', async t => {
  const f = await fixture(t);
  const admin = await f.user({ role: 'admin' });
  const user = await f.user();
  const localImage = (await (await f.upload(user.cookie, { name: 'local.png' })).json()).image;
  const created = await f.json('/api/admin/storage', 'POST', { name: 'R2', kind: 'r2', config: { endpoint: 'https://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com', bucket: 'images', accessKeyId: 'test-access-id', secretAccessKey: 'test-secret-key' } }, admin.cookie);
  assert.equal(created.status, 201);
  const provider = (await created.json()).provider;
  assert.equal(provider.hasSecrets, true);
  assert.equal('secretAccessKey' in provider.config, false);
  const stored = f.db.prepare('SELECT config FROM storage_providers WHERE id=?').get(provider.id) as Row;
  assert.equal(stored.config.includes('test-secret-key'), false);
  const dav = await webdav(t, f);
  const remoteImage = (await (await f.upload(user.cookie, { name: 'remote.png' })).json()).image;
  assert.equal(remoteImage.storageId, dav.id);
  assert.equal((await f.request('/i/' + localImage.id)).status, 200);
  assert.equal((await f.request('/i/' + remoteImage.id)).status, 200);
  assert.equal((await f.json('/api/admin/storage/' + dav.id, 'PATCH', { name: 'Moved', kind: 'webdav', config: { ...dav.config, path: 'elsewhere', password: '' } }, admin.cookie)).status, 409);
  assert.equal((await f.json('/api/admin/storage/' + dav.id, 'PATCH', { name: 'Renamed', kind: 'webdav', config: { ...dav.config, password: '' } }, admin.cookie)).status, 200);
  assert.equal((await f.json('/api/admin/storage/local/activate', 'POST', {}, admin.cookie)).status, 200);
  assert.equal((await f.request('/api/admin/storage/' + dav.id, { method: 'DELETE', headers: { Cookie: admin.cookie, Origin: ORIGIN } })).status, 409);
});

test('malformed image data and oversized or unbounded uploads leave quota unchanged', async t => {
  const f = await fixture(t);
  const user = await f.user();
  assert.equal((await f.upload(user.cookie, { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') })).status, 400);
  assert.equal((await f.request('/api/images', { method: 'POST', headers: { Cookie: user.cookie, Origin: ORIGIN }, body: 'unbounded' })).status, 411);
  assert.equal((await f.request('/api/images', { method: 'POST', headers: { Cookie: user.cookie, Origin: ORIGIN, 'Content-Length': String(30 * 1024 * 1024) }, body: 'too large' })).status, 413);
  const row = f.db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as Row;
  assert.equal(row.used_bytes + row.reserved_bytes, 0);
});
