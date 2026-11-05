import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import type { EmailChangeStatus, PendingEmailChange } from '../shared/types.js';
import type { AppConfig } from './config.js';
import { audit, now, transaction, type DB, type Row } from './db.js';
import { createMailService } from './mail.js';
import { equalSecret, hashToken, RateLimiter, verifyPassword } from './security.js';

const validity = 10 * 60_000;
const cooldown = 60_000;
const maxAttempts = 5;

export function createEmailChangeService(db: DB, config: AppConfig) {
  const mail = createMailService(db, config);
  const limiter = new RateLimiter();
  const codeHash = (userId: string, code: string) => createHmac('sha256', config.encryptionKey).update('email-change:' + userId + ':' + code).digest('hex');
  const currentUser = (userId: string, sessionHash: string): Row => {
    const user = db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND s.token_hash=? AND s.expires_at>?').get(userId, sessionHash, now()) as Row | undefined;
    if (!user || user.status !== 'active' || !user.email_verified_at) throw new HTTPException(401, { message: '登录状态已失效，请重新登录' });
    return user;
  };
  const pendingFor = (user: Row): Row | undefined => {
    const pending = db.prepare('SELECT * FROM email_change_requests WHERE user_id=?').get(user.id) as Row | undefined;
    if (pending && (pending.source_email !== user.email || pending.password_fingerprint !== hashToken(user.password_hash) || pending.expires_at <= now())) {
      db.prepare('DELETE FROM email_change_requests WHERE user_id=? AND request_id=?').run(user.id, pending.request_id);
      return undefined;
    }
    return pending;
  };
  const view = (row: Row): PendingEmailChange => ({
    requestId: row.request_id, email: row.email, expiresAt: row.expires_at,
    resendAt: new Date(Date.parse(row.sent_at) + cooldown).toISOString(),
    remainingAttempts: Math.max(0, maxAttempts - row.attempts), delivered: Boolean(row.delivered),
  });
  const status = (user: Row): EmailChangeStatus => {
    const pending = pendingFor(user);
    return { enabled: mail.settings().enabled, pending: pending ? view(pending) : null };
  };
  const ensureMail = () => {
    if (!mail.settings().enabled) throw new HTTPException(503, { message: '更换邮箱需要邮件验证，请联系管理员启用邮件服务' });
  };
  const stage = (user: Row, email: string, previous?: Row): Row => {
    if (previous && Date.now() - Date.parse(previous.sent_at) < cooldown) throw new HTTPException(429, { message: '请等待 60 秒后再发送验证码' });
    limiter.hit('send:' + user.id, 1, cooldown);
    limiter.hit('account:' + user.id, 6, 15 * 60_000);
    limiter.hit('recipient:' + email, 3, 15 * 60_000);
    let code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    while (previous?.code_hash === codeHash(user.id, code)) code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const sentAt = now();
    const requestId = randomUUID();
    db.prepare('INSERT INTO email_change_requests(user_id,request_id,source_email,password_fingerprint,email,code_hash,sent_at,expires_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET request_id=excluded.request_id,source_email=excluded.source_email,password_fingerprint=excluded.password_fingerprint,email=excluded.email,code_hash=excluded.code_hash,sent_at=excluded.sent_at,expires_at=excluded.expires_at,attempts=0,delivered=0')
      .run(user.id, requestId, user.email, hashToken(user.password_hash), email, codeHash(user.id, code), sentAt, new Date(Date.now() + validity).toISOString());
    // The plaintext code exists only for the delivery, never in the database.
    return { ...db.prepare('SELECT * FROM email_change_requests WHERE user_id=?').get(user.id), code };
  };
  const deliver = async (request: Row) => {
    const delivered = await mail.send('email-change', request.email, {
      title: '验证新的登录邮箱', code: request.code,
      paragraphs: ['我们收到了更换登录邮箱的请求。', '你的验证码：' + request.code + '\n请在 10 分钟内回到已登录的账户设置页完成验证。验证完成前，原邮箱仍可用于登录。', '如果不是你本人操作，请忽略此邮件。'],
      action: { label: '返回账户设置', url: config.publicUrl + '/app/settings' },
    });
    db.prepare('UPDATE email_change_requests SET delivered=? WHERE user_id=? AND request_id=?').run(delivered ? 1 : 0, request.user_id, request.request_id);
    const active = db.prepare('SELECT * FROM email_change_requests WHERE user_id=? AND request_id=?').get(request.user_id, request.request_id) as Row | undefined;
    if (!active) throw new HTTPException(409, { message: '邮箱更换请求已失效，请重新打开后再试' });
    return { pending: view(active) };
  };
  const request = async (userId: string, sessionHash: string, input: { email: string; currentPassword: string }) => {
    limiter.hit('password:' + userId, 6, 15 * 60_000);
    ensureMail();
    const user = currentUser(userId, sessionHash);
    if (!await verifyPassword(input.currentPassword, user.password_hash)) throw new HTTPException(400, { message: '当前密码不正确' });
    const pending = transaction(db, () => {
      // Password verification yields: recheck the account and session before sending.
      const current = currentUser(userId, sessionHash);
      if (current.password_hash !== user.password_hash || current.email !== user.email) throw new HTTPException(409, { message: '账户信息已变更，请重新验证当前密码' });
      if (input.email === current.email.toLowerCase()) throw new HTTPException(400, { message: '新邮箱不能与当前邮箱相同' });
      if (db.prepare('SELECT id FROM users WHERE email=?').get(input.email)) throw new HTTPException(409, { message: '此邮箱已被使用，请填写其他邮箱' });
      return stage(current, input.email, pendingFor(current));
    });
    return deliver(pending);
  };
  const resend = async (userId: string, sessionHash: string, requestId: string) => {
    ensureMail();
    const pending = transaction(db, () => {
      const user = currentUser(userId, sessionHash);
      const previous = pendingFor(user);
      if (!previous || previous.request_id !== requestId) throw new HTTPException(409, { message: '邮箱更换请求已失效，请重新验证当前密码' });
      if (db.prepare('SELECT id FROM users WHERE email=?').get(previous.email)) throw new HTTPException(409, { message: '此邮箱已被使用，请填写其他邮箱' });
      return stage(user, previous.email, previous);
    });
    return deliver(pending);
  };
  const confirm = (userId: string, sessionHash: string, requestId: string, code: string) => {
    limiter.hit('confirm:' + userId, 20, 15 * 60_000);
    const outcome = transaction(db, () => {
      const user = currentUser(userId, sessionHash);
      const pending = pendingFor(user);
      if (!pending || pending.request_id !== requestId || pending.attempts >= maxAttempts) return { error: '验证码错误、已过期或尝试次数过多，请重新获取验证码', status: 400 as const };
      if (!pending.delivered) return { error: '验证码未能发送，请重新发送或联系管理员', status: 503 as const };
      if (!equalSecret(codeHash(userId, code), pending.code_hash)) {
        db.prepare('UPDATE email_change_requests SET attempts=attempts+1 WHERE user_id=? AND request_id=?').run(userId, requestId);
        return { error: '验证码错误、已过期或尝试次数过多，请重新获取验证码', status: 400 as const };
      }
      if (db.prepare('SELECT id FROM users WHERE email=?').get(pending.email)) {
        db.prepare('DELETE FROM email_change_requests WHERE user_id=?').run(userId);
        return { error: '此邮箱已被使用，请填写其他邮箱', status: 409 as const };
      }
      db.prepare('UPDATE users SET email=?,email_verified_at=? WHERE id=?').run(pending.email, now(), userId);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
      db.prepare('DELETE FROM api_tokens WHERE user_id=?').run(userId);
      db.prepare('DELETE FROM email_tokens WHERE user_id=?').run(userId);
      db.prepare('DELETE FROM email_change_requests WHERE user_id=?').run(userId);
      audit(db, userId, 'account.email', userId, '更换登录邮箱：' + user.email + ' → ' + pending.email + '；撤销已有会话与访问令牌');
      return { user: db.prepare('SELECT * FROM users WHERE id=?').get(userId) as Row, previousEmail: user.email as string };
    });
    if ('error' in outcome) throw new HTTPException(outcome.status, { message: outcome.error });
    return outcome;
  };
  const notify = (previousEmail: string, email: string) => mail.send('email-changed', previousEmail, {
    title: '登录邮箱已更换',
    paragraphs: ['你的账户已于 ' + now() + ' 更换登录邮箱。', '新登录邮箱：' + email, '今后请使用新邮箱和原密码登录。其他设备的登录状态、个人 API 令牌和原有找回链接已撤销。', '如果不是你本人操作，请尽快联系站点管理员。'],
    action: { label: '前往站点', url: config.publicUrl + '/login' },
  });
  return { status, request, resend, confirm, notify };
}
