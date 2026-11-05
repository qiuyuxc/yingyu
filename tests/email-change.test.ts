import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createMailService } from '../server/mail.js';
import type { Row } from '../server/db.js';
import { fixture, TEST_PASSWORD } from './helpers.js';
import { startTestSmtp } from './smtp-fixture.js';

const decode = (source: string) => source.replace(/=\r\n/g, '').replace(/=([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
const codeIn = (source: string) => { const code = decode(source).match(/>(\d{6})<\/p>/)?.[1]; assert.ok(code); return code; };
const resetTokenIn = (source: string) => { const token = decode(source).match(/#token=([\w-]{40,})/)?.[1]; assert.ok(token); return token; };

async function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = await fixture(t), smtp = await startTestSmtp();
  t.after(smtp.close);
  createMailService(f.db, f.config).save(smtp.settings);
  const user = await f.user();
  const begin = async (email = 'changed@example.test') => {
    const response = await f.json('/api/account/email-change', 'POST', { email, currentPassword: TEST_PASSWORD }, user.cookie);
    assert.equal(response.status, 202);
    return (await response.json()).pending;
  };
  const confirm = (requestId: string, code: string, cookie = user.cookie) => f.json('/api/account/email-change/confirm', 'POST', { requestId, code }, cookie);
  return { f, smtp, user, begin, confirm };
}

test('email changes require a web session, password, working mail configuration and an unused new address', async t => {
  const { f, user, begin } = await setup(t);
  assert.equal((await f.json('/api/account/email-change', 'POST', { email: 'next@example.test', currentPassword: TEST_PASSWORD })).status, 401);
  const token = (await (await f.json('/api/account/tokens', 'POST', { name: 'uploader' }, user.cookie)).json()).token;
  assert.equal((await f.json('/api/account/email-change', 'POST', { email: 'next@example.test', currentPassword: TEST_PASSWORD }, undefined, { Authorization: 'Bearer ' + token })).status, 403);
  assert.equal((await f.request('/api/account/email-change', { headers: { Authorization: 'Bearer ' + token } })).status, 403);
  assert.equal((await f.json('/api/account/email-change', 'POST', { email: 'next@example.test', currentPassword: TEST_PASSWORD }, user.cookie, { Origin: 'https://untrusted.test' })).status, 403);
  assert.equal((await f.json('/api/account/email-change', 'POST', { email: 'next@example.test', currentPassword: 'wrong-password' }, user.cookie)).status, 400);
  assert.equal((await f.json('/api/account/email-change', 'POST', { email: user.email.toUpperCase(), currentPassword: TEST_PASSWORD }, user.cookie)).status, 400);
  const occupied = await f.user({ email: 'occupied@example.test' });
  assert.equal((await f.json('/api/account/email-change', 'POST', { email: occupied.email.toUpperCase(), currentPassword: TEST_PASSWORD }, user.cookie)).status, 409);
  assert.equal(f.db.prepare('SELECT * FROM email_change_requests').all().length, 0);
  const mail = createMailService(f.db, f.config);
  const settings = mail.settings(); mail.save({ ...settings, enabled: false });
  assert.equal((await f.json('/api/account/email-change', 'POST', { email: 'next@example.test', currentPassword: TEST_PASSWORD }, user.cookie)).status, 503);
  assert.equal((await (await f.request('/api/account/email-change', { headers: { Cookie: user.cookie } })).json()).enabled, false);
  mail.save(settings);
  const pending = await begin(' Normalized@Example.Test ');
  assert.equal(pending.email, 'normalized@example.test');
});

test('confirming the new mailbox keeps account resources, rotates the current session and revokes old credentials', async t => {
  const { f, smtp, user, begin, confirm } = await setup(t);
  const otherSession = f.session(user);
  const apiToken = (await (await f.json('/api/account/tokens', 'POST', { name: 'old-token' }, user.cookie)).json()).token;
  const image = (await (await f.upload(user.cookie)).json()).image;
  const before = (await (await f.request('/api/auth/me', { headers: { Cookie: user.cookie } })).json()).user;
  await f.json('/api/auth/forgot-password', 'POST', { email: user.email });
  const resetToken = resetTokenIn(smtp.messages[0]);
  const pending = await begin();
  const code = codeIn(smtp.messages[1]);
  assert.notEqual((f.db.prepare('SELECT code_hash FROM email_change_requests').get() as Row).code_hash, code);
  assert.equal((f.db.prepare('SELECT email FROM users WHERE id=?').get(user.id) as Row).email, user.email);
  assert.equal((await f.json('/api/auth/login', 'POST', { email: pending.email, password: TEST_PASSWORD })).status, 401);
  const response = await confirm(pending.requestId, code);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  assert.notEqual(cookie, user.cookie);
  const changed = (await response.json()).user;
  assert.equal(changed.email, pending.email); assert.equal(changed.id, user.id);
  for (const key of ['usedBytes', 'quotaBytes', 'imageCount', 'tier', 'createdAt']) assert.equal(changed[key], before[key]);
  assert.equal((await f.request('/api/auth/me', { headers: { Cookie: cookie } })).status, 200);
  for (const old of [user.cookie, otherSession]) assert.equal((await f.request('/api/auth/me', { headers: { Cookie: old } })).status, 401);
  assert.equal((await f.request('/api/images', { headers: { Authorization: 'Bearer ' + apiToken } })).status, 401);
  assert.equal((await f.json('/api/auth/reset-password', 'POST', { token: resetToken, password: 'unused-new-password' })).status, 400);
  assert.equal((await confirm(pending.requestId, code, cookie)).status, 400);
  assert.equal((await f.json('/api/auth/login', 'POST', { email: user.email, password: TEST_PASSWORD })).status, 401);
  assert.equal((await f.json('/api/auth/login', 'POST', { email: pending.email, password: TEST_PASSWORD })).status, 200);
  assert.equal((await (await f.request('/api/images', { headers: { Cookie: cookie } })).json()).images[0].id, image.id);
  assert.ok(smtp.messages[2].includes('To: ' + user.email));
  assert.ok(decode(smtp.messages[2]).includes(pending.email));
  assert.equal(f.db.prepare('SELECT * FROM email_change_requests').all().length, 0);
});

test('email change codes have a persistent cooldown, five attempts, and only the latest request can confirm', async t => {
  const { f, smtp, user, begin, confirm } = await setup(t);
  const pending = await begin();
  const first = codeIn(smtp.messages[0]);
  assert.equal((await f.json('/api/account/email-change/resend', 'POST', { requestId: pending.requestId }, user.cookie)).status, 429);
  const wrong = first === '000000' ? '111111' : '000000';
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await confirm(pending.requestId, wrong)).status, 400);
  assert.equal((await confirm(pending.requestId, first)).status, 400);
  const status = await (await f.request('/api/account/email-change', { headers: { Cookie: user.cookie } })).json();
  assert.equal(status.pending.remainingAttempts, 0);
  assert.equal(smtp.messages.length, 1);
  t.mock.timers.tick(61_000);
  const resend = await f.json('/api/account/email-change/resend', 'POST', { requestId: pending.requestId }, user.cookie);
  assert.equal(resend.status, 202);
  const latest = (await resend.json()).pending;
  const next = codeIn(smtp.messages[1]);
  assert.notEqual(next, first); assert.notEqual(latest.requestId, pending.requestId);
  assert.equal((await confirm(pending.requestId, first)).status, 400);
  assert.equal((await confirm(latest.requestId, first)).status, 400);
  assert.equal((await confirm(latest.requestId, next)).status, 200);
});

test('cancelling or expiring a change leaves the original mailbox unchanged', async t => {
  const { f, smtp, user, begin, confirm } = await setup(t);
  const pending = await begin();
  const code = codeIn(smtp.messages[0]);
  assert.equal((await f.json('/api/account/email-change', 'DELETE', {}, user.cookie)).status, 200);
  assert.equal((await confirm(pending.requestId, code)).status, 400);
  t.mock.timers.tick(61_000);
  const next = await begin('expired@example.test');
  const nextCode = codeIn(smtp.messages[1]);
  t.mock.timers.tick(10 * 60_000);
  assert.equal((await confirm(next.requestId, nextCode)).status, 400);
  assert.equal((await (await f.request('/api/account/email-change', { headers: { Cookie: user.cookie } })).json()).pending, null);
  assert.equal((f.db.prepare('SELECT email FROM users WHERE id=?').get(user.id) as Row).email, user.email);
});

test('two accounts claiming the same mailbox cannot both change to it', async t => {
  const { f, smtp, user, begin, confirm } = await setup(t);
  const other = await f.user();
  const first = await begin('shared@example.test');
  const secondResponse = await f.json('/api/account/email-change', 'POST', { email: first.email, currentPassword: TEST_PASSWORD }, other.cookie);
  assert.equal(secondResponse.status, 202);
  const second = (await secondResponse.json()).pending;
  const outcomes = await Promise.all([
    confirm(first.requestId, codeIn(smtp.messages[0])),
    f.json('/api/account/email-change/confirm', 'POST', { requestId: second.requestId, code: codeIn(smtp.messages[1]) }, other.cookie),
  ]);
  assert.deepEqual(outcomes.map(response => response.status).sort(), [200, 409]);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS count FROM users WHERE email=?').get(first.email) as Row).count, 1);
  assert.equal((f.db.prepare('SELECT email FROM users WHERE id=?').get(other.id) as Row).email, other.email);
  assert.notEqual(user.id, other.id);
});

test('a submitted email change cannot survive a password change, password reset or account suspension', async t => {
  for (const action of ['password', 'reset', 'suspend']) {
    await t.test(action, async sub => {
    const { f, smtp, user, begin, confirm } = await setup(sub);
    const pending = await begin(action + '@example.test');
    const code = codeIn(smtp.messages[0]);
    let nextCookie = user.cookie;
    if (action === 'password') {
      const changed = await f.json('/api/account/password', 'PATCH', { currentPassword: TEST_PASSWORD, password: 'replacement-password-2026' }, user.cookie);
      assert.equal(changed.status, 200); nextCookie = changed.headers.get('set-cookie')!.split(';')[0];
    } else if (action === 'reset') {
      await f.json('/api/auth/forgot-password', 'POST', { email: user.email });
      const changed = await f.json('/api/auth/reset-password', 'POST', { token: resetTokenIn(smtp.messages[1]), password: 'replacement-password-2026' });
      assert.equal(changed.status, 200);
      const login = await f.json('/api/auth/login', 'POST', { email: user.email, password: 'replacement-password-2026' });
      nextCookie = login.headers.get('set-cookie')!.split(';')[0];
    } else {
      const admin = await f.user({ role: 'admin' });
      assert.equal((await f.json('/api/admin/users/' + user.id, 'PATCH', { status: 'suspended' }, admin.cookie)).status, 200);
    }
    assert.equal(f.db.prepare('SELECT * FROM email_change_requests WHERE user_id=?').get(user.id), undefined);
    assert.ok([400, 401, 403].includes((await confirm(pending.requestId, code, nextCookie)).status));
    assert.equal((f.db.prepare('SELECT email FROM users WHERE id=?').get(user.id) as Row).email, user.email);
    });
  }
});

test('mail failures cannot change an unverified mailbox or undo a successful change', async t => {
  const { f, smtp, user, begin, confirm } = await setup(t);
  smtp.control.fail = true;
  const pending = await begin();
  assert.equal(pending.delivered, false);
  assert.equal((await confirm(pending.requestId, '000000')).status, 503);
  assert.equal((f.db.prepare('SELECT email FROM users WHERE id=?').get(user.id) as Row).email, user.email);
  t.mock.timers.tick(61_000); smtp.control.fail = false;
  const resend = await f.json('/api/account/email-change/resend', 'POST', { requestId: pending.requestId }, user.cookie);
  assert.equal(resend.status, 202);
  const latest = (await resend.json()).pending, code = codeIn(smtp.messages[0]);
  smtp.control.fail = true;
  const changed = await confirm(latest.requestId, code);
  assert.equal(changed.status, 200); assert.equal((await changed.json()).noticeDelivered, false);
  const cookie = changed.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await f.request('/api/auth/me', { headers: { Cookie: cookie } })).status, 200);
});
