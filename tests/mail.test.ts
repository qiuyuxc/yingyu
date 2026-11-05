import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { GiB } from '../shared/types.js';
import { createMailService, renderMail } from '../server/mail.js';
import { verifyPassword } from '../server/security.js';
import type { Row } from '../server/db.js';
import { fixture, TEST_PASSWORD } from './helpers.js';
import { startTestSmtp } from './smtp-fixture.js';

async function smtp(t:TestContext){const server=await startTestSmtp();t.after(server.close);return server;}

const decoded = (source: string) => source.replace(/=\r\n/g, '').replace(/=([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
const tokenIn = (message: string) => { const token = decoded(message).match(/#token=([\w-]{40,})/)?.[1]; assert.ok(token); return token; };

test('SMTP configuration is encrypted, admin-only, and sends HTML plus text over SMTP', async t => {
  const f = await fixture(t), server = await smtp(t), admin = await f.user({ role: 'admin' }), user = await f.user();
  assert.equal((await f.json('/api/admin/mail', 'PATCH', server.settings, user.cookie)).status, 403);
  const saved = await f.json('/api/admin/mail', 'PATCH', server.settings, admin.cookie);
  assert.equal(saved.status, 200);
  const body = await saved.json(); assert.equal(body.settings.hasPassword, true); assert.equal(body.settings.password, undefined);
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM mail_config').all()).includes(server.settings.password));
  const site = await (await f.request('/api/site')).json(); assert.equal(site.email.verification, true); assert.ok(!JSON.stringify(site).includes('smtp-secret'));
  await f.json('/api/admin/mail', 'PATCH', { ...server.settings, password: '' }, admin.cookie);
  assert.equal(createMailService(f.db, f.config).settings().password, server.settings.password);
  assert.equal((await f.json('/api/admin/mail/test', 'POST', { recipient: user.email }, admin.cookie)).status, 200);
  assert.equal(server.messages.length, 1); assert.match(server.messages[0], /Content-Type: text\/html/); assert.match(server.messages[0], /Content-Type: text\/plain/);
  const logs = await (await f.request('/api/admin/mail', { headers: { Cookie: admin.cookie } })).json(); assert.equal(logs.logs[0].status, 'sent');
});

test('registration uses a six-digit code, authenticates once, limits attempts, and supports resend', async t => {
  const f = await fixture(t), server = await smtp(t); await f.user({ role: 'admin' });
  createMailService(f.db, f.config).save(server.settings);
  const input = { name: '<script>unsafe</script>', email: 'new@example.test', password: TEST_PASSWORD };
  const registration = await f.json('/api/auth/register', 'POST', input);
  assert.equal(registration.status, 201); assert.equal(registration.headers.get('set-cookie'), null);
  assert.equal((await registration.json()).verificationRequired, true);
  const codeIn = (message: string) => { const code = decoded(message).match(/>(\d{6})<\/p>/)?.[1]; assert.ok(code); return code; };
  const first = codeIn(server.messages[0]);
  const stored = f.db.prepare('SELECT * FROM email_tokens').get() as Row;
  assert.notEqual(stored.code_hash, first); assert.ok(stored.code_hash.length > 6);
  assert.equal((await f.json('/api/auth/login', 'POST', input)).status, 403);
  const pending = f.db.prepare('SELECT * FROM users WHERE email=?').get(input.email) as Row;
  assert.equal((await f.request('/api/images', { headers: { Cookie: f.session(pending) } })).status, 403);
  await f.json('/api/auth/resend-verification', 'POST', { email: input.email });
  assert.equal(server.messages.length, 1, 'resend cooldown does not send a duplicate email');
  f.db.prepare("UPDATE email_tokens SET sent_at='2000-01-01T00:00:00Z'").run();
  await f.json('/api/auth/resend-verification', 'POST', { email: input.email });
  const next = codeIn(server.messages[1]); assert.notEqual(next, first);
  assert.equal((await f.json('/api/auth/verify-email', 'POST', { email:input.email,code:first })).status, 400);
  const wrong=next==='000000'?'111111':'000000';
  for(let i=0;i<4;i++)assert.equal((await f.json('/api/auth/verify-email','POST',{email:input.email,code:wrong})).status,400);
  assert.equal((await f.json('/api/auth/verify-email','POST',{email:input.email,code:next})).status,400);
  f.db.prepare("UPDATE email_tokens SET sent_at='2000-01-01T00:00:00Z'").run();
  await f.json('/api/auth/resend-verification','POST',{email:input.email});
  const valid=codeIn(server.messages[2]);
  const verified=await f.json('/api/auth/verify-email','POST',{email:input.email,code:valid});
  assert.equal(verified.status,200);assert.ok(verified.headers.get('set-cookie'));
  assert.equal((await verified.json()).user.email,input.email);
  assert.equal((await f.json('/api/auth/verify-email','POST',{email:input.email,code:valid})).status,400);
});

test('password reset hides account existence and atomically revokes sessions, API tokens and reset links', async t => {
  const f = await fixture(t), server = await smtp(t), user = await f.user();
  createMailService(f.db, f.config).save(server.settings);
  const missing = await f.json('/api/auth/forgot-password', 'POST', { email: 'missing@example.test' });
  const requested = await f.json('/api/auth/forgot-password', 'POST', { email: user.email });
  assert.equal(requested.status, missing.status); assert.deepEqual(await requested.json(), await missing.json());
  const token = tokenIn(server.messages[0]);
  const created = await f.json('/api/account/tokens', 'POST', { name: 'old-token' }, user.cookie); assert.equal(created.status, 201);
  const reset = { token, password: 'a-new-password-2026' };
  const results = await Promise.all([f.json('/api/auth/reset-password', 'POST', reset), f.json('/api/auth/reset-password', 'POST', reset)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  assert.equal((await f.request('/api/auth/me', { headers: { Cookie: user.cookie } })).status, 401);
  assert.equal(f.db.prepare('SELECT * FROM api_tokens WHERE user_id=?').all(user.id).length, 0);
  assert.equal(f.db.prepare('SELECT * FROM email_tokens WHERE user_id=?').all(user.id).length, 0);
  const updated = f.db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as Row;
  assert.ok(await verifyPassword(reset.password, updated.password_hash));
  assert.equal((await f.json('/api/auth/login', 'POST', { email: user.email, password: reset.password })).status, 200);
});

test('quota submission and review send notifications; SMTP failures do not roll back a decision', async t => {
  const f = await fixture(t), server = await smtp(t), admin = await f.user({ role: 'admin' }), user = await f.user();
  createMailService(f.db, f.config).save(server.settings);
  const applied = await f.json('/api/quota/requests', 'POST', { requestedBytes: 2 * GiB, reason: '用于个人摄影作品' }, user.cookie);
  assert.equal(applied.status, 201); assert.equal(server.messages.length, 2);
  const id = (await applied.json()).request.id;
  const reviewed = await f.json('/api/admin/quota-requests/' + id, 'PATCH', { status: 'approved', adminNote: '已通过' }, admin.cookie);
  assert.equal(reviewed.status, 200); assert.equal(server.messages.length, 3);
  server.control.fail = true;
  const adjusted = await f.json('/api/admin/users/' + user.id, 'PATCH', { quotaBytes: 3 * GiB, reason: '增加配额' }, admin.cookie);
  assert.equal(adjusted.status, 200); assert.equal((await adjusted.json()).user.quotaBytes, 3 * GiB);
  const logs = f.db.prepare("SELECT * FROM mail_logs WHERE status='failed'").all(); assert.equal(logs.length, 1);
});

test('HTML templates escape names, notes and action URLs', () => {
  const result = renderMail('<script>site</script>', { title: '<img src=x>', paragraphs: ['<svg onload=alert(1)>'], action: { label: '<b>open</b>', url: 'https://example.test/?value="unsafe"' } });
  assert.ok(!result.html.includes('<script>')); assert.ok(!result.html.includes('<svg'));
  assert.match(result.html, /&lt;script&gt;/); assert.match(result.html, /&quot;unsafe&quot;/);
  assert.match(result.text, /<svg onload=alert\(1\)>/);
});
