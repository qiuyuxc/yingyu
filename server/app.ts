import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { getConnInfo } from '@hono/node-server/conninfo';
import { randomUUID, randomInt, createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { z, ZodError } from 'zod';
import { GiB, MiB, type StorageConfig } from '../shared/types.js';
import type { AppConfig } from './config.js';
import { audit, getSettings, insertUser, now, transaction, userView, type DB, type Row } from './db.js';
import { decryptConfig, encryptConfig, equalSecret, hashPassword, hashToken, newToken, RateLimiter, verifyPassword } from './security.js';
import { inspectImage } from './image.js';
import { createStore, validateStorage } from './storage.js';
import { createQuotaProvisioner, provisionIdempotent } from './quota.js';
import { createMailService, mailSchema } from './mail.js';
import { createAvatarService, AVATAR_LIMIT } from './avatars.js';
import { publicObjectUrl } from './storage.js';
import { createEmailChangeService } from './email-change.js';

type Env = { Variables: { user: Row; authKind: 'session' | 'token' } };
const passwordSchema=z.string().min(10,'密码至少需要 10 个字符').max(128,'密码最多 128 个字符');
const emailSchema=z.string().trim().toLowerCase().email('请输入有效的邮箱地址').max(254);
const nameSchema=z.string().trim().min(1,'请输入名称').max(40,'名称最多 40 个字符');
const quotaSchema=z.number().int().min(0).max(100*1024*GiB);
const grantSchema=z.object({ userId:z.string().uuid(),quotaBytes:quotaSchema,tier:z.string().trim().min(1).max(40),reason:z.string().trim().min(1).max(500) });
const storageSchema=z.object({
  name:nameSchema,
  kind:z.enum(['local','s3','r2','webdav']),
  config:z.object({
    endpoint:z.string().trim().max(2048).optional(),region:z.string().trim().max(80).optional(),bucket:z.string().trim().max(255).optional(),
    publicBaseUrl:z.string().trim().max(2048).optional(),
    accessKeyId:z.string().trim().max(500).optional(),secretAccessKey:z.string().max(2000).optional(),username:z.string().trim().max(255).optional(),
    password:z.string().max(2000).optional(),path:z.string().trim().max(1024).optional(),forcePathStyle:z.boolean().optional(),
  }),
});

async function json<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try { body=await c.req.json(); } catch { throw new HTTPException(400, { message:'请求内容必须为有效 JSON' }); }
  return schema.parse(body);
}

function ip(c: Context) { try { return getConnInfo(c).remote.address || 'local'; } catch { return 'local'; } }

export function createApp(db: DB, config: AppConfig) {
  const app=new Hono<Env>();
  const limiter=new RateLimiter();
  const mail=createMailService(db,config);
  const emailChanges=createEmailChangeService(db,config);
  const avatars=createAvatarService(db,config);
  let dummyPassword: Promise<string> | undefined;
  const cookieName=config.production?'__Host-yingyu_session':'yingyu_session';
  const sessionDays=7;
  const requestIp = (c: Context) => {
    // The supplied proxy replaces X-Forwarded-For; direct deployments ignore it.
    const forwarded = config.trustProxy ? c.req.header('X-Forwarded-For')?.split(',').at(-1)?.trim() : undefined;
    return forwarded && isIP(forwarded) ? forwarded : ip(c);
  };

  app.use('*',async(c,next) => {
    await next();
    c.header('X-Content-Type-Options','nosniff');
    c.header('X-Frame-Options','DENY');
    c.header('Referrer-Policy','strict-origin-when-cross-origin');
    c.header('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    if (config.production) c.header('Strict-Transport-Security','max-age=31536000');
    if (c.req.path.startsWith('/api/')) c.header('Cache-Control','no-store');
  });
  app.use('/api/*',bodyLimit({ maxSize:100*MiB+MiB,onError:c=>c.json({ error:'请求超过大小限制' },413) }));
  app.use('/api/*',async(c,next) => {
    if (!['GET','HEAD','OPTIONS'].includes(c.req.method)) {
      const origin=c.req.header('Origin');
      const machineAuth=c.req.header('Authorization')?.startsWith('Bearer ');
      if (origin ? origin!==config.publicUrl : !machineAuth) throw new HTTPException(403, { message:'请求来源不受信任' });
    }
    await next();
  });

  const authenticate=async(c: Context<Env>,next: () => Promise<void>) => {
    const bearer=c.req.header('Authorization');
    const session=getCookie(c,cookieName);
    let row: Row | undefined;
    if (bearer?.startsWith('Bearer ')) {
      const token=bearer.slice(7);
      if (token.length>150) throw new HTTPException(401, { message:'访问令牌无效' });
      row=db.prepare('SELECT u.*,t.id AS api_token_id FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=?').get(hashToken(token)) as Row|undefined;
      if (row) db.prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?').run(now(),row.api_token_id);
      c.set('authKind','token');
    } else if (session && session.length<150) {
      row=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(hashToken(session),now()) as Row|undefined;
      c.set('authKind','session');
    }
    if (!row) throw new HTTPException(401, { message:'请先登录' });
    if (row.status!=='active') throw new HTTPException(403, { message:'账号已被停用，请联系管理员' });
    if (!row.email_verified_at) throw new HTTPException(403, { message:'请先验证邮箱' });
    c.set('user',row);
    await next();
  };
  const admin=async(c: Context<Env>,next: () => Promise<void>) => {
    if (c.get('user').role!=='admin') throw new HTTPException(403, { message:'需要管理员权限' });
    // Personal API tokens only access user APIs, even for administrators.
    if (c.get('authKind')!=='session') throw new HTTPException(403, { message:'管理操作请使用网页登录；自动调额使用独立集成接口' });
    await next();
  };
  const issueSession=(c:Context<Env>,userId:string) => {
    const token=newToken();
    const expires=new Date(Date.now()+sessionDays*86400_000);
    db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now());
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashToken(token),userId,expires.toISOString());
    setCookie(c,cookieName,token,{ httpOnly:true,secure:config.production,sameSite:'Lax',path:'/',maxAge:sessionDays*86400 });
  };
  const ownedImage=(id:string,user:Row) => {
    const image=db.prepare('SELECT * FROM images WHERE id=? AND user_id=?').get(id,user.id) as Row|undefined;
    if (!image) throw new HTTPException(404, { message:'图片不存在' });
    return image;
  };
  const imageView=(row:Row) => ({
    id:row.id,name:row.name,size:row.size,mime:row.mime,width:row.width,height:row.height,albumId:row.album_id,
    visibility:row.visibility,starred:Boolean(row.starred),storageId:row.storage_id,storageName:row.storage_name,
    createdAt:row.created_at,url:`${config.publicUrl}/i/${row.id}`,...(row.owner_name?{ ownerName:row.owner_name,ownerId:row.user_id }:{}),
  });
  const storageRow=(id:string) => {
    const provider=db.prepare('SELECT * FROM storage_providers WHERE id=?').get(id) as Row|undefined;
    if (!provider) throw new HTTPException(404, { message:'存储配置不存在' });
    return provider;
  };
  const providerStore=(provider:Row) => createStore(provider.kind,decryptConfig(provider.config,config.encryptionKey),config.dataDir);
  const quotaView=(row:Row) => ({
    id:row.id,userId:row.user_id,userName:row.user_name,userEmail:row.user_email,currentQuota:row.current_quota,
    requestedBytes:row.requested_bytes,reason:row.reason,status:row.status,adminNote:row.admin_note,createdAt:row.created_at,reviewedAt:row.reviewed_at,
  });
  const quotaQuery='SELECT q.*,u.name AS user_name,u.email AS user_email,u.quota_bytes AS current_quota FROM quota_requests q JOIN users u ON u.id=q.user_id';
  const codeHash=(userId:string,code:string)=>createHmac('sha256',config.encryptionKey).update(userId+':'+code).digest('hex');
  const sendEmailToken=async(user:Row,purpose:'verify'|'reset')=>{
    const token=newToken();
    let code=purpose==='verify'?String(randomInt(0,1000000)).padStart(6,'0'):null;
    const previous=db.prepare('SELECT code_hash FROM email_tokens WHERE user_id=? AND purpose=?').get(user.id,purpose) as Row|undefined;
    while(code&&previous?.code_hash===codeHash(user.id,code)) code=String(randomInt(0,1000000)).padStart(6,'0');
    const expires=new Date(Date.now()+(purpose==='reset'?30*60_000:10*60_000)).toISOString();
    db.prepare('DELETE FROM email_tokens WHERE expires_at<=?').run(now());
    db.prepare('INSERT INTO email_tokens(token_hash,user_id,purpose,expires_at,code_hash,attempts,sent_at) VALUES(?,?,?,?,?,0,?) ON CONFLICT(user_id,purpose) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,code_hash=excluded.code_hash,attempts=0,sent_at=excluded.sent_at').run(hashToken(token),user.id,purpose,expires,code?codeHash(user.id,code):null,now());
    const reset=purpose==='reset';
    return mail.send(purpose,user.email,{
      title:reset?'重置登录密码':'验证你的邮箱',code:code||undefined,
      paragraphs:[`${user.name}，你好。`,reset?'我们收到了重置密码的请求。请在 30 分钟内设置新密码；如果不是你本人操作，请忽略此邮件。':`你的邮箱验证码：${code}\n请在 10 分钟内输入验证码完成注册。如果不是你本人注册，请忽略此邮件。`],
      action:reset?{label:'重置密码',url:`${config.publicUrl}/reset-password#token=${encodeURIComponent(token)}`}:{label:'返回验证页面',url:`${config.publicUrl}/verify-email?email=${encodeURIComponent(user.email)}`},
    });
  };

  app.get('/api/health',c=>c.json({ ok:true }));
  app.get('/api/site',c=>{ const email=mail.settings(); return c.json({ settings:getSettings(db),initialized:Boolean(db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()),storageReady:Boolean(db.prepare('SELECT id FROM storage_providers WHERE active=1').get()),email:{passwordReset:email.enabled&&email.passwordReset,verification:email.enabled&&email.verification} }); });

  app.post('/api/auth/forgot-password',async c=>{
    const input=await json(c,z.object({email:emailSchema}));
    limiter.hit('forgot:'+requestIp(c),10,3600_000);limiter.hit('forgot-email:'+input.email,3,15*60_000);
    const smtp=mail.settings();
    if (!smtp.enabled||!smtp.passwordReset) throw new HTTPException(503,{message:'邮件找回密码暂未启用，请联系管理员'});
    const user=db.prepare("SELECT * FROM users WHERE email=? AND status='active'").get(input.email) as Row|undefined;
    if(user) await sendEmailToken(user,'reset');
    return c.json({message:'如果该邮箱已注册，你将收到密码重置邮件。请检查收件箱或垃圾邮件。'},202);
  });
  app.post('/api/auth/resend-verification',async c=>{
    const input=await json(c,z.object({email:emailSchema}));
    limiter.hit('resend:'+requestIp(c),10,3600_000);limiter.hit('resend-email:'+input.email,3,15*60_000);
    if(!mail.settings().enabled) throw new HTTPException(503,{message:'邮件服务暂未启用，请联系管理员'});
    const user=db.prepare("SELECT * FROM users WHERE email=? AND status='active' AND email_verified_at IS NULL").get(input.email) as Row|undefined;
    const previous=user?db.prepare("SELECT sent_at FROM email_tokens WHERE user_id=? AND purpose='verify'").get(user.id) as Row|undefined:undefined;
    if(user&&(!previous?.sent_at||Date.now()-Date.parse(previous.sent_at)>=60000)) await sendEmailToken(user,'verify');
    return c.json({message:'如果该邮箱需要验证，验证码将发送至你的收件箱，有效期 10 分钟。',retryAfter:60},202);
  });
  app.post('/api/auth/verify-email',async c=>{
    limiter.hit('verify:'+requestIp(c),20,15*60_000);
    const input=await json(c,z.union([z.object({email:emailSchema,code:z.string().regex(/^\d{6}$/,'请输入 6 位验证码')}),z.object({token:z.string().min(32).max(128)})]));
    const userId=transaction(db,()=>{
      const row='token' in input?db.prepare("SELECT t.* FROM email_tokens t JOIN users u ON u.id=t.user_id WHERE token_hash=? AND purpose='verify' AND expires_at>? AND u.status='active'").get(hashToken(input.token),now()) as Row|undefined:db.prepare("SELECT t.* FROM email_tokens t JOIN users u ON u.id=t.user_id WHERE u.email=? AND purpose='verify' AND expires_at>? AND u.status='active' AND u.email_verified_at IS NULL").get(input.email,now()) as Row|undefined;
      if(!row||row.attempts>=5) return null;
      if('code' in input&&(!row.code_hash||!equalSecret(codeHash(row.user_id,input.code),row.code_hash))) {
        db.prepare('UPDATE email_tokens SET attempts=attempts+1 WHERE token_hash=?').run(row.token_hash);
        return null;
      }
      db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(now(),row.user_id);
      db.prepare("DELETE FROM email_tokens WHERE user_id=? AND purpose='verify'").run(row.user_id);
      audit(db,row.user_id,'account.verify',row.user_id,'邮箱验证成功');
      return row.user_id as string;
    });
    if(!userId) throw new HTTPException(400,{message:'token' in input?'验证链接无效或已过期，请重新发送验证码':'验证码错误、已过期或尝试次数过多，请重新获取验证码'});
    issueSession(c,userId);
    return c.json({ok:true,user:userView(db,db.prepare('SELECT * FROM users WHERE id=?').get(userId) as Row)});
  });
  app.post('/api/auth/reset-password',async c=>{
    limiter.hit('reset:'+requestIp(c),20,15*60_000);
    const input=await json(c,z.object({token:z.string().min(32).max(128),password:passwordSchema}));
    const passwordHash=await hashPassword(input.password);
    transaction(db,()=>{
      const row=db.prepare("SELECT t.user_id FROM email_tokens t JOIN users u ON u.id=t.user_id WHERE token_hash=? AND purpose='reset' AND expires_at>? AND u.status='active'").get(hashToken(input.token),now()) as Row|undefined;
      if(!row) throw new HTTPException(400,{message:'重置链接无效或已过期，请重新申请'});
      db.prepare('UPDATE users SET password_hash=?,email_verified_at=COALESCE(email_verified_at,?) WHERE id=?').run(passwordHash,now(),row.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
      db.prepare('DELETE FROM api_tokens WHERE user_id=?').run(row.user_id);
      db.prepare('DELETE FROM email_tokens WHERE user_id=?').run(row.user_id);
      db.prepare('DELETE FROM email_change_requests WHERE user_id=?').run(row.user_id);
      audit(db,row.user_id,'account.password',row.user_id,'通过邮件重置密码并撤销全部会话与令牌');
    });
    deleteCookie(c,cookieName,{path:'/',secure:config.production});
    return c.json({ok:true});
  });

  app.post('/api/auth/register',async c => {
    limiter.hit('register:'+requestIp(c),10,3600_000);
    if (!db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()) throw new HTTPException(503, { message:'图床尚未初始化，请联系站点管理员' });
    if (!getSettings(db).registrationOpen) throw new HTTPException(403, { message:'管理员已暂停注册' });
    const input=await json(c,z.object({ email:emailSchema,name:nameSchema,password:passwordSchema }));
    const passwordHash=await hashPassword(input.password);
    const verificationRequired=mail.settings().enabled&&mail.settings().verification;
    const row=transaction(db,() => {
      if (db.prepare('SELECT id FROM users WHERE email=?').get(input.email)) throw new HTTPException(409, { message:'此邮箱已被注册' });
      const user=insertUser(db,{ ...input,passwordHash,verified:!verificationRequired });
      audit(db,user.id,'account.register',user.id,'创建账号');
      return user;
    });
    if(verificationRequired) {
      const delivered=await sendEmailToken(row,'verify');
      return c.json({verificationRequired:true,email:row.email,delivered},201);
    }
    issueSession(c,row.id);
    return c.json({ user:userView(db,row) },201);
  });
  app.post('/api/auth/login',async c => {
    limiter.hit('login:'+requestIp(c),20,15*60_000);
    const input=await json(c,z.object({ email:emailSchema,password:z.string().min(1).max(128) }));
    limiter.hit('login-email:'+input.email,10,15*60_000);
    const row=db.prepare('SELECT * FROM users WHERE email=?').get(input.email) as Row|undefined;
    dummyPassword??=hashPassword(newToken());
    const valid=await verifyPassword(input.password,row?.password_hash || await dummyPassword);
    if (!row || !valid) throw new HTTPException(401, { message:'邮箱或密码不正确' });
    if (row.status!=='active') throw new HTTPException(403, { message:'账号已被停用，请联系管理员' });
    if (!row.email_verified_at) return c.json({error:'请先验证邮箱',verificationRequired:true,email:row.email},403);
    issueSession(c,row.id);
    return c.json({ user:userView(db,row) });
  });
  app.post('/api/auth/logout',authenticate,c => {
    const token=getCookie(c,cookieName);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
    deleteCookie(c,cookieName,{ path:'/',secure:config.production });
    return c.json({ ok:true });
  });
  app.get('/api/auth/me',authenticate,c=>c.json({ user:userView(db,c.get('user')) }));

  const announcementView = (row: Row) => ({ id: row.id, title: row.title, content: row.content, status: row.status, popup: Boolean(row.popup), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at });
  const announcementList = (c: Context<Env>, includeDrafts: boolean) => {
    const page = z.coerce.number().int().min(1).parse(c.req.query('page') || '1');
    const where = includeDrafts ? '' : " WHERE status='published'";
    const rows = db.prepare('SELECT * FROM announcements' + where + ' ORDER BY ' + (includeDrafts ? 'updated_at' : 'published_at') + ' DESC,id DESC LIMIT 20 OFFSET ?').all((page - 1) * 20) as Row[];
    const total = (db.prepare('SELECT COUNT(*) AS count FROM announcements' + where).get() as Row).count;
    return c.json({ announcements: rows.map(announcementView), total, page });
  };
  app.get('/api/announcements', authenticate, c => announcementList(c, false));
  app.get('/api/announcements/popup', authenticate, c => {
    const row = db.prepare("SELECT * FROM announcements WHERE status='published' AND popup=1 ORDER BY published_at DESC,updated_at DESC,id DESC LIMIT 1").get() as Row | undefined;
    return c.json({ announcement: row ? announcementView(row) : null });
  });

  app.use('/api/account/*',authenticate);
  const emailSessionHash = (c: Context<Env>) => {
    if (c.get('authKind') !== 'session') throw new HTTPException(403, { message: '请在网页登录后更换邮箱' });
    return hashToken(getCookie(c, cookieName) || '');
  };
  app.get('/api/account/email-change', c => {
    emailSessionHash(c);
    return c.json(emailChanges.status(c.get('user')));
  });
  app.post('/api/account/email-change', async c => {
    const sessionHash = emailSessionHash(c);
    const input = await json(c, z.object({ email: emailSchema, currentPassword: z.string().min(1).max(128) }));
    return c.json(await emailChanges.request(c.get('user').id, sessionHash, input), 202);
  });
  app.post('/api/account/email-change/resend', async c => {
    const sessionHash = emailSessionHash(c);
    const input = await json(c, z.object({ requestId: z.string().uuid() }));
    return c.json(await emailChanges.resend(c.get('user').id, sessionHash, input.requestId), 202);
  });
  app.post('/api/account/email-change/confirm', async c => {
    const sessionHash = emailSessionHash(c);
    const input = await json(c, z.object({ requestId: z.string().uuid(), code: z.string().regex(/^\d{6}$/, '请输入 6 位验证码') }));
    const changed = emailChanges.confirm(c.get('user').id, sessionHash, input.requestId, input.code);
    issueSession(c, changed.user.id);
    const noticeDelivered = await emailChanges.notify(changed.previousEmail, changed.user.email);
    return c.json({ user: userView(db, changed.user), noticeDelivered });
  });
  app.delete('/api/account/email-change', c => {
    emailSessionHash(c);
    db.prepare('DELETE FROM email_change_requests WHERE user_id=?').run(c.get('user').id);
    return c.json({ ok: true });
  });
  app.get('/api/account/avatars',async c=>{
    const userId=c.get('user').id;
    try { return c.json(await avatars.maintain(userId)); }
    catch(error) { if(error instanceof HTTPException&&error.status===409) return c.json(avatars.snapshot(userId)); throw error; }
  });
  app.post('/api/account/avatars',async c=>{
    limiter.hit('avatar-upload:'+c.get('user').id,30,3600_000);
    const length=Number(c.req.header('Content-Length'));
    if(!Number.isFinite(length)||length<=0) throw new HTTPException(411,{message:'上传需要 Content-Length'});
    if(length>AVATAR_LIMIT+MiB) throw new HTTPException(413,{message:'头像大小不能超过 5 MB'});
    let form:FormData;
    try { form=await c.req.formData(); } catch { throw new HTTPException(400,{message:'无效的上传内容'}); }
    const file=form.get('file');
    if(!(file instanceof File)) throw new HTTPException(400,{message:'请选择头像图片'});
    if(file.size>AVATAR_LIMIT) throw new HTTPException(413,{message:'头像大小不能超过 5 MB'});
    return c.json(await avatars.upload(c.get('user').id,Buffer.from(await file.arrayBuffer()),file.name),201);
  });
  app.patch('/api/account/avatars/library',async c=>{
    const input=await json(c,z.object({enabled:z.boolean()}));
    return c.json(await avatars.setEnabled(c.get('user').id,input.enabled));
  });
  app.post('/api/account/avatars/cleanup',async c=>c.json(await avatars.maintain(c.get('user').id)));
  app.post('/api/account/avatars/:id/select',async c=>c.json(await avatars.select(c.get('user').id,c.req.param('id'))));
  app.delete('/api/account/avatars/:id',async c=>c.json(await avatars.remove(c.get('user').id,c.req.param('id'))));
  const avatarContent=async(c:Context<Env>,own:boolean)=>{
    const row=db.prepare("SELECT a.* FROM avatars a JOIN users u ON u.id=a.user_id WHERE a.id=? AND a.state IN ('current','history') AND u.status='active'").get(c.req.param('id')||'') as Row|undefined;
    if(!row||(own?row.user_id!==c.get('user').id:row.state!=='current')) throw new HTTPException(404,{message:'头像不存在'});
    try {
      const object=await avatars.store(row.storage_id).get(row.object_key);
      return new Response(object as BodyInit,{headers:{'Content-Type':row.mime,'Content-Length':String(row.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    } catch { throw new HTTPException(502,{message:'头像暂时无法读取'}); }
  };
  app.get('/a/:id',c=>avatarContent(c,false));
  app.get('/api/account/avatars/:id/content',c=>avatarContent(c,true));
  app.patch('/api/account/profile',async c => {
    const input=await json(c,z.object({ name:nameSchema }));
    db.prepare('UPDATE users SET name=? WHERE id=?').run(input.name,c.get('user').id);
    return c.json({ user:userView(db,db.prepare('SELECT * FROM users WHERE id=?').get(c.get('user').id) as Row) });
  });
  app.patch('/api/account/password',async c => {
    const input=await json(c,z.object({ currentPassword:z.string().max(128),password:passwordSchema }));
    const user=c.get('user');
    limiter.hit('password:'+user.id,6,15*60_000);
    if (!await verifyPassword(input.currentPassword,user.password_hash)) throw new HTTPException(400, { message:'当前密码不正确' });
    const passwordHash=await hashPassword(input.password);
    transaction(db,()=>{
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash,user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM api_tokens WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM email_tokens WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM email_change_requests WHERE user_id=?').run(user.id);
      audit(db,user.id,'account.password',user.id,'更新密码并撤销已有会话与访问令牌');
    });
    issueSession(c,user.id);
    return c.json({ ok:true });
  });
  app.get('/api/account/tokens',c=>c.json({ tokens:db.prepare('SELECT id,name,prefix,created_at AS createdAt,last_used_at AS lastUsedAt FROM api_tokens WHERE user_id=? ORDER BY created_at DESC').all(c.get('user').id) }));
  app.post('/api/account/tokens',async c => {
    if (c.get('authKind')!=='session') throw new HTTPException(403, { message:'请在网页登录后管理令牌' });
    const input=await json(c,z.object({ name:nameSchema }));
    const count=db.prepare('SELECT COUNT(*) AS count FROM api_tokens WHERE user_id=?').get(c.get('user').id) as Row;
    if (count.count>=10) throw new HTTPException(400, { message:'最多创建 10 个访问令牌' });
    const token='yy_'+newToken();const id=randomUUID();const createdAt=now();
    db.prepare('INSERT INTO api_tokens(id,user_id,token_hash,name,prefix,created_at) VALUES(?,?,?,?,?,?)').run(id,c.get('user').id,hashToken(token),input.name,token.slice(0,10),createdAt);
    return c.json({ token,entry:{ id,name:input.name,prefix:token.slice(0,10),createdAt,lastUsedAt:null } },201);
  });
  app.delete('/api/account/tokens/:id',c => {
    if (c.get('authKind')!=='session') throw new HTTPException(403, { message:'请在网页登录后管理令牌' });
    db.prepare('DELETE FROM api_tokens WHERE id=? AND user_id=?').run(c.req.param('id'),c.get('user').id);
    return c.json({ ok:true });
  });

  app.use('/api/albums',authenticate);
  app.use('/api/albums/*',authenticate);
  app.get('/api/albums',c=>c.json({ albums:db.prepare("SELECT a.id,a.name,a.created_at AS createdAt,COUNT(i.id) AS count FROM albums a LEFT JOIN images i ON i.album_id=a.id AND i.state='ready' WHERE a.user_id=? GROUP BY a.id ORDER BY a.created_at DESC").all(c.get('user').id) }));
  app.post('/api/albums',async c => {
    const input=await json(c,z.object({ name:nameSchema }));
    if (db.prepare('SELECT id FROM albums WHERE user_id=? AND name=?').get(c.get('user').id,input.name)) throw new HTTPException(409, { message:'已有同名相册' });
    const count=db.prepare('SELECT COUNT(*) AS count FROM albums WHERE user_id=?').get(c.get('user').id) as Row;
    if (count.count>=100) throw new HTTPException(400, { message:'最多创建 100 个相册' });
    const album={ id:randomUUID(),name:input.name,createdAt:now(),count:0 };
    db.prepare('INSERT INTO albums(id,user_id,name,created_at) VALUES(?,?,?,?)').run(album.id,c.get('user').id,album.name,album.createdAt);
    return c.json({ album },201);
  });
  app.delete('/api/albums/:id',c=>{
    db.prepare('DELETE FROM albums WHERE id=? AND user_id=?').run(c.req.param('id'),c.get('user').id);
    return c.json({ ok:true });
  });

  app.use('/api/images',authenticate);
  app.use('/api/images/*',authenticate);
  app.get('/api/images',c => {
    const query=z.object({ page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(40),search:z.string().max(100).default(''),albumId:z.string().optional(),starred:z.enum(['true','false']).optional(),visibility:z.enum(['public','private']).optional(),sort:z.enum(['newest','oldest','largest','name']).default('newest') }).parse(c.req.query());
    const where=["i.user_id=?","i.state='ready'"];const args:(string|number)[]=[c.get('user').id];
    if (query.search) { where.push("i.name LIKE ? ESCAPE '\\'");args.push('%'+query.search.replace(/[\\%_]/g,'\\$&')+'%'); }
    if (query.albumId) { where.push('i.album_id=?');args.push(query.albumId); }
    if (query.starred==='true') where.push('i.starred=1');
    if (query.starred==='false') where.push('i.starred=0');
    if (query.visibility) { where.push('i.visibility=?');args.push(query.visibility); }
    const total=(db.prepare(`SELECT COUNT(*) AS total FROM images i WHERE ${where.join(' AND ')}`).get(...args) as Row).total;
    const sort={ newest:'i.created_at DESC',oldest:'i.created_at ASC',largest:'i.size DESC',name:'i.name ASC' }[query.sort];
    const rows=db.prepare(`SELECT i.*,s.name AS storage_name FROM images i JOIN storage_providers s ON s.id=i.storage_id WHERE ${where.join(' AND ')} ORDER BY ${sort},i.id LIMIT ? OFFSET ?`).all(...args,query.limit,(query.page-1)*query.limit) as Row[];
    return c.json({ images:rows.map(imageView),total,page:query.page,limit:query.limit });
  });
  app.post('/api/images',async c => {
    const user=c.get('user');
    limiter.hit('upload:'+user.id,120,60_000);
    const settings=getSettings(db);
    // Require a bounded request before parsing multipart data.
    const length=Number(c.req.header('Content-Length'));
    if (!Number.isFinite(length) || length<=0) throw new HTTPException(411, { message:'上传需要有效的 Content-Length' });
    if (length>settings.maxUploadBytes+MiB) throw new HTTPException(413, { message:`单张图片不能超过 ${settings.maxUploadBytes/MiB} MB` });
    let body: Awaited<ReturnType<typeof c.req.parseBody>>;
    try { body=await c.req.parseBody(); } catch { throw new HTTPException(400, { message:'上传内容无效，请使用 multipart/form-data' }); }
    const file=body.file;
    if (!(file instanceof File)) throw new HTTPException(400, { message:'请选择一张图片（file 字段）' });
    if (file.size===0 || file.size>settings.maxUploadBytes) throw new HTTPException(413, { message:`图片为空或超过 ${settings.maxUploadBytes/MiB} MB` });
    const buffer=Buffer.from(await file.arrayBuffer());
    const info=inspectImage(buffer);
    const visibility=z.enum(['public','private']).parse(body.visibility||'public');
    const albumId=typeof body.albumId==='string' && body.albumId?body.albumId:null;
    if (albumId && !db.prepare('SELECT id FROM albums WHERE id=? AND user_id=?').get(albumId,user.id)) throw new HTTPException(400, { message:'相册不存在' });
    const provider=db.prepare('SELECT * FROM storage_providers WHERE active=1').get() as Row|undefined;
    if (!provider) throw new HTTPException(503, { message:'管理员尚未启用存储' });
    const id=randomUUID();const objectKey=`${user.id}/${id}.${info.ext}`;
    const filename=file.name.replace(/[\u0000-\u001f\u007f/\\]/g,'_').slice(0,200)||`image.${info.ext}`;
    transaction(db,()=>{
      const reserved=db.prepare("UPDATE users SET reserved_bytes=reserved_bytes+? WHERE id=? AND status='active' AND used_bytes+reserved_bytes+?<=quota_bytes").run(file.size,user.id,file.size);
      if (!reserved.changes) throw new HTTPException(409, { message:'剩余配额不足，请先释放空间或申请扩容' });
      const startedAt=now();
      db.prepare('INSERT INTO images(id,user_id,storage_id,object_key,name,size,mime,width,height,album_id,visibility,created_at,state_changed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,user.id,provider.id,objectKey,filename,file.size,info.mime,info.width,info.height,albumId,visibility,startedAt,startedAt);
    });
    try {
      await providerStore(provider).put(objectKey,buffer,info.mime);
      transaction(db,()=>{
        const finished=db.prepare("UPDATE images SET state='ready',state_changed_at=? WHERE id=? AND state='uploading'").run(now(),id);
        if (!finished.changes) throw new Error('上传记录已经被清理');
        db.prepare('UPDATE users SET reserved_bytes=reserved_bytes-?,used_bytes=used_bytes+? WHERE id=?').run(file.size,file.size,user.id);
      });
    } catch (error) {
      // The provider may have persisted the object before a network failure.
      // Keep its reservation until deletion succeeds, so cleanup can be retried.
      try {
        await providerStore(provider).delete(objectKey);
        transaction(db,()=>{ const removed=db.prepare("DELETE FROM images WHERE id=? AND state='uploading'").run(id);if (removed.changes) db.prepare('UPDATE users SET reserved_bytes=reserved_bytes-? WHERE id=?').run(file.size,user.id); });
      } catch { audit(db,null,'storage.cleanup.pending',id,'上传未完成，保留空间预留等待重试清理'); }
      throw new HTTPException(502, { message:'存储写入失败，请联系管理员检查存储连接' });
    }
    const row=db.prepare('SELECT i.*,s.name AS storage_name FROM images i JOIN storage_providers s ON s.id=i.storage_id WHERE i.id=?').get(id) as Row;
    return c.json({ image:imageView(row),user:userView(db,db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as Row) },201);
  });
  app.patch('/api/images/:id',async c=>{
    const input=await json(c,z.object({ name:z.string().trim().min(1).max(200).optional(),starred:z.boolean().optional(),visibility:z.enum(['public','private']).optional(),albumId:z.string().uuid().nullable().optional() }));
    const user=c.get('user');const row=ownedImage(c.req.param('id'),user);
    if (row.state!=='ready') throw new HTTPException(409, { message:'图片正在处理，请稍后再试' });
    if (input.albumId && !db.prepare('SELECT id FROM albums WHERE id=? AND user_id=?').get(input.albumId,user.id)) throw new HTTPException(400, { message:'相册不存在' });
    db.prepare('UPDATE images SET name=?,starred=?,visibility=?,album_id=? WHERE id=?').run(input.name??row.name,input.starred===undefined?row.starred:Number(input.starred),input.visibility??row.visibility,input.albumId===undefined?row.album_id:input.albumId,row.id);
    return c.json({ image:imageView(db.prepare('SELECT i.*,s.name AS storage_name FROM images i JOIN storage_providers s ON s.id=i.storage_id WHERE i.id=?').get(row.id) as Row) });
  });

  const deleteImage=async(row:Row,actor:Row) => {
    if (row.state!=='ready') throw new HTTPException(409, { message:'图片正在处理，请稍后再试' });
    const startedAt=now();
    const lock=db.prepare("UPDATE images SET state='deleting',state_changed_at=? WHERE id=? AND state='ready'").run(startedAt,row.id);
    if (!lock.changes) throw new HTTPException(409, { message:'图片正在处理，请稍后再试' });
    try { await providerStore(storageRow(row.storage_id)).delete(row.object_key); }
    catch { db.prepare("UPDATE images SET state='ready',state_changed_at=? WHERE id=? AND state='deleting' AND state_changed_at=?").run(now(),row.id,startedAt);throw new HTTPException(502, { message:'存储删除失败，配额保持原值，请稍后重试' }); }
    transaction(db,()=>{
      const removed=db.prepare("DELETE FROM images WHERE id=? AND state='deleting' AND state_changed_at=?").run(row.id,startedAt);
      if (removed.changes) {
        db.prepare('UPDATE users SET used_bytes=used_bytes-? WHERE id=?').run(row.size,row.user_id);
        audit(db,actor.id,'image.delete',row.id,row.name);
      }
    });
  };
  app.delete('/api/images/:id',async c=>{ await deleteImage(ownedImage(c.req.param('id'),c.get('user')),c.get('user'));return c.json({ ok:true }); });

  app.get('/i/:id',async c => {
    const row=db.prepare("SELECT i.*,u.status AS owner_status FROM images i JOIN users u ON u.id=i.user_id WHERE i.id=? AND i.state='ready'").get(c.req.param('id')) as Row|undefined;
    if (!row || row.owner_status!=='active') throw new HTTPException(404, { message:'图片不存在' });
    if (row.visibility==='private') {
      await authenticate(c,async()=>{});
      const moderator=c.get('user').role==='admin' && c.get('authKind')==='session';
      if (c.get('user').id!==row.user_id && !moderator) throw new HTTPException(404, { message:'图片不存在' });
    }
    const provider=storageRow(row.storage_id);
    const storageConfig=decryptConfig(provider.config,config.encryptionKey) as StorageConfig;
    if(row.visibility==='public'&&(provider.kind==='r2'||provider.kind==='s3')&&storageConfig.publicBaseUrl) {
      c.header('Cache-Control','no-store');
      return c.redirect(publicObjectUrl(storageConfig.publicBaseUrl,row.object_key),302);
    }
    let object: ReadableStream<Uint8Array>|Buffer;
    try { object=await providerStore(storageRow(row.storage_id)).get(row.object_key); }
    catch { throw new HTTPException(502, { message:'图片暂时无法读取' }); }
    c.header('Content-Type',row.mime);
    c.header('Content-Length',String(row.size));
    // Short public cache keeps privacy changes, suspension, and deletion bounded.
    c.header('Cache-Control',row.visibility==='private'?'private, no-store':'public, max-age=60');
    c.header('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(row.name)}`);
    return new Response(object as BodyInit,{ headers:c.res.headers });
  });

  app.use('/api/quota/*',authenticate);
  app.get('/api/quota/requests',c=>c.json({ requests:(db.prepare(quotaQuery+' WHERE q.user_id=? ORDER BY q.created_at DESC LIMIT 50').all(c.get('user').id) as Row[]).map(quotaView) }));
  app.post('/api/quota/requests',async c=>{
    const input=await json(c,z.object({ requestedBytes:quotaSchema.min(MiB),reason:z.string().trim().min(5,'请至少填写 5 个字符的用途说明').max(500) }));
    const user=c.get('user');
    limiter.hit('quota-request:'+user.id,10,86400_000);
    if (input.requestedBytes<=user.quota_bytes) throw new HTTPException(400, { message:'申请的总额度应高于当前额度' });
    const id=transaction(db,()=>{
      if (db.prepare("SELECT id FROM quota_requests WHERE user_id=? AND status='pending'").get(user.id)) throw new HTTPException(409, { message:'已有一条申请正在审核，请耐心等待' });
      const id=randomUUID();db.prepare('INSERT INTO quota_requests(id,user_id,requested_bytes,reason,created_at) VALUES(?,?,?,?,?)').run(id,user.id,input.requestedBytes,input.reason,now());
      audit(db,user.id,'quota.request',id,`申请 ${input.requestedBytes} 字节总额度`);return id;
    });
    const smtp=mail.settings();
    if(smtp.enabled&&smtp.quotaNotifications) {
      const inboxes=smtp.reviewInbox?[smtp.reviewInbox]:(db.prepare("SELECT email FROM users WHERE role='admin' AND status='active' AND email_verified_at IS NOT NULL LIMIT 20").all() as Row[]).map(row=>row.email as string);
      await Promise.all([
        mail.send('quota-request',user.email,{title:'扩容申请已提交',paragraphs:[`申请总配额：${(input.requestedBytes/GiB).toFixed(2)} GB`,input.reason,'管理员审核后，你会收到邮件通知。'],action:{label:'查看申请',url:config.publicUrl+'/app/quota'}}),
        ...inboxes.map(recipient=>mail.send('quota-review-needed',recipient,{title:'有新的扩容申请待审核',paragraphs:[`${user.name}（${user.email}）申请扩容。`,`申请总配额：${(input.requestedBytes/GiB).toFixed(2)} GB`,input.reason],action:{label:'审核申请',url:config.publicUrl+'/admin/requests'}})),
      ]);
    }
    return c.json({ request:quotaView(db.prepare(quotaQuery+' WHERE q.id=?').get(id) as Row) },201);
  });

  app.use('/api/admin/*',authenticate,admin);
  app.get('/api/admin/mail',c=>c.json({settings:mail.publicSettings(),logs:db.prepare('SELECT id,recipient,kind,status,error,created_at AS createdAt FROM mail_logs ORDER BY created_at DESC LIMIT 30').all()}));
  app.patch('/api/admin/mail',async c=>{
    const input=await json(c,mailSchema);
    const settings=mail.save(input);
    audit(db,c.get('user').id,'mail.settings','site','更新 SMTP 配置（不记录凭据）');
    return c.json({settings});
  });
  app.post('/api/admin/mail/test',async c=>{
    limiter.hit('mail-test:'+c.get('user').id,5,15*60_000);
    const input=await json(c,z.object({recipient:emailSchema}));
    if(!mail.settings().enabled) throw new HTTPException(400,{message:'请先保存并启用 SMTP 配置'});
    const sent=await mail.send('test',input.recipient,{title:'SMTP 测试邮件',paragraphs:['如果你收到这封邮件，说明当前 SMTP 配置能够发送邮件。','这是一封 HTML 邮件，同时提供纯文本版本。'],action:{label:'打开站点',url:config.publicUrl}});
    if(!sent) throw new HTTPException(502,{message:'测试邮件发送失败，请查看发送记录并检查 SMTP 配置'});
    return c.json({message:'SMTP 服务器已接受测试邮件，请检查收件箱'});
  });
  app.get('/api/admin/overview',c=>{
    const users=db.prepare('SELECT COUNT(*) AS count,SUM(quota_bytes) AS quota FROM users').get() as Row;
    const images=db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS bytes FROM images WHERE state='ready'").get() as Row;
    const avatarBytes=(db.prepare("SELECT COALESCE(SUM(size),0) AS bytes FROM avatars WHERE state!='staging'").get() as Row).bytes;
    const pending=db.prepare("SELECT COUNT(*) AS count FROM quota_requests WHERE status='pending'").get() as Row;
    const today=new Date().toISOString().slice(0,10);
    const daily=db.prepare("SELECT substr(created_at,1,10) AS date,COUNT(*) AS count,SUM(size) AS bytes FROM images WHERE state='ready' AND created_at>=? GROUP BY date").all(new Date(Date.now()-6*86400_000).toISOString().slice(0,10)) as Row[];
    const dailyUploads=Array.from({ length:7 },(_,i)=>{ const date=new Date(Date.now()-(6-i)*86400_000).toISOString().slice(0,10);const record=daily.find(d=>d.date===date);return { date,count:record?.count??0,bytes:record?.bytes??0 }; });
    const recentAudit=db.prepare("SELECT a.id,COALESCE(u.name,'系统 / 外部接口') AS actor,a.action,a.target,a.detail,a.created_at AS createdAt FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 12").all();
    return c.json({ users:users.count,images:images.count,usedBytes:images.bytes+avatarBytes,quotaBytes:users.quota||0,pendingRequests:pending.count,uploadsToday:dailyUploads.find(d=>d.date===today)?.count??0,dailyUploads,recentAudit });
  });
  app.get('/api/admin/users',c=>{
    const search=z.string().max(100).parse(c.req.query('search')||'');
    const page=z.coerce.number().int().min(1).parse(c.req.query('page')||1);
    const pattern='%'+search.replace(/[\\%_]/g,'\\$&')+'%';
    const rows=db.prepare("SELECT * FROM users WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 30 OFFSET ?").all(pattern,pattern,(page-1)*30) as Row[];
    const total=(db.prepare("SELECT COUNT(*) AS count FROM users WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'").get(pattern,pattern) as Row).count;
    return c.json({ users:rows.map(r=>userView(db,r)),total,page });
  });
  app.patch('/api/admin/users/:id',async c=>{
    const input=await json(c,z.object({ quotaBytes:quotaSchema.optional(),tier:z.string().trim().min(1).max(40).optional(),status:z.enum(['active','suspended']).optional(),role:z.enum(['admin','user']).optional(),reason:z.string().trim().max(500).default('管理员调配') }));
    const actor=c.get('user');
    let quotaChanged=false;
    const row=transaction(db,()=>{
      const row=db.prepare('SELECT * FROM users WHERE id=?').get(c.req.param('id')) as Row|undefined;
      if (!row) throw new HTTPException(404, { message:'用户不存在' });
      quotaChanged=input.quotaBytes!==undefined&&input.quotaBytes!==row.quota_bytes;
      if (row.id===actor.id && (input.role==='user' || input.status==='suspended')) throw new HTTPException(400, { message:'不能撤销自己的管理权限或停用自己的账号' });
      if (row.role==='admin' && (input.role==='user'||input.status==='suspended')) {
        const count=db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND status='active'").get() as Row;
        if (count.count<=1) throw new HTTPException(400, { message:'站点至少需要一名启用的管理员' });
      }
      if (input.quotaBytes!==undefined || input.tier!==undefined) createQuotaProvisioner(db).grant({ userId:row.id,quotaBytes:input.quotaBytes??row.quota_bytes,tier:input.tier??row.tier,reason:input.reason },actor.id);
      db.prepare('UPDATE users SET status=?,role=? WHERE id=?').run(input.status??row.status,input.role??row.role,row.id);
      if (input.status==='suspended' || (input.role!==undefined && input.role!==row.role)) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);db.prepare('DELETE FROM api_tokens WHERE user_id=?').run(row.id);db.prepare('DELETE FROM email_change_requests WHERE user_id=?').run(row.id); }
      audit(db,actor.id,'user.update',row.id,JSON.stringify({ status:input.status,role:input.role }));
      return db.prepare('SELECT * FROM users WHERE id=?').get(row.id) as Row;
    });
    if(quotaChanged&&mail.settings().quotaNotifications) await mail.send('quota-updated',row.email,{title:'存储配额已调整',paragraphs:[`当前总配额：${(row.quota_bytes/GiB).toFixed(2)} GB`,input.reason],action:{label:'查看空间',url:config.publicUrl+'/app/quota'}});
    return c.json({ user:userView(db,row) });
  });
  app.get('/api/admin/quota-requests',c=>{
    const status=z.enum(['pending','approved','rejected','all']).parse(c.req.query('status')||'all');
    const rows=status==='all'?db.prepare(quotaQuery+' ORDER BY q.created_at DESC LIMIT 100').all():db.prepare(quotaQuery+' WHERE q.status=? ORDER BY q.created_at DESC LIMIT 100').all(status);
    return c.json({ requests:(rows as Row[]).map(quotaView) });
  });
  app.patch('/api/admin/quota-requests/:id',async c=>{
    const input=await json(c,z.object({ status:z.enum(['approved','rejected']),quotaBytes:quotaSchema.optional(),adminNote:z.string().trim().max(500).default('') }));
    transaction(db,()=>{
      const row=db.prepare('SELECT * FROM quota_requests WHERE id=?').get(c.req.param('id')) as Row|undefined;
      if (!row) throw new HTTPException(404, { message:'申请不存在' });
      if (row.status!=='pending') throw new HTTPException(409, { message:'此申请已经处理' });
      if (input.status==='approved') {
        const user=db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id) as Row;
        const quota=input.quotaBytes??Math.max(row.requested_bytes,user.quota_bytes);
        if (quota<user.quota_bytes) throw new HTTPException(409, { message:'扩容审批不能降低当前配额，请通过用户管理调整' });
        createQuotaProvisioner(db).grant({ userId:row.user_id,quotaBytes:quota,tier:'扩容额度',reason:input.adminNote||row.reason },c.get('user').id);
      }
      db.prepare('UPDATE quota_requests SET status=?,admin_note=?,reviewer_id=?,reviewed_at=? WHERE id=?').run(input.status,input.adminNote,c.get('user').id,now(),row.id);
      audit(db,c.get('user').id,'quota.review',row.id,input.status);
    });
    const reviewed=db.prepare(quotaQuery+' WHERE q.id=?').get(c.req.param('id')) as Row;
    if(mail.settings().quotaNotifications) await mail.send('quota-reviewed',reviewed.user_email,{title:input.status==='approved'?'扩容申请已通过':'扩容申请未通过',paragraphs:[`当前总配额：${(reviewed.current_quota/GiB).toFixed(2)} GB`,input.adminNote||'请登录查看申请详情。'],action:{label:'查看审核结果',url:config.publicUrl+'/app/quota'}});
    return c.json({ request:quotaView(db.prepare(quotaQuery+' WHERE q.id=?').get(c.req.param('id')) as Row) });
  });

  const storageView=(row:Row) => {
    const original=decryptConfig(row.config,config.encryptionKey) as StorageConfig;
    const { secretAccessKey,password,...safe }=original;
    const stats=db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS bytes FROM (SELECT size FROM images WHERE storage_id=? AND state='ready' UNION ALL SELECT size FROM avatars WHERE storage_id=?)").get(row.id,row.id) as Row;
    return { id:row.id,name:row.name,kind:row.kind,active:Boolean(row.active),config:safe,hasSecrets:Boolean(secretAccessKey||password),imageCount:stats.count,usedBytes:stats.bytes,createdAt:row.created_at };
  };
  app.get('/api/admin/storage',c=>c.json({ providers:(db.prepare('SELECT * FROM storage_providers ORDER BY created_at').all() as Row[]).map(storageView) }));
  app.post('/api/admin/storage',async c=>{
    const input=await json(c,storageSchema);
    if (input.kind==='local') throw new HTTPException(400, { message:'本地存储已内置，无需重复创建' });
    const count=db.prepare('SELECT COUNT(*) AS count FROM storage_providers').get() as Row;
    if (count.count>=20) throw new HTTPException(400, { message:'最多创建 20 个存储配置' });
    validateStorage(input.kind,input.config);
    const id=randomUUID();
    db.prepare('INSERT INTO storage_providers(id,name,kind,config,created_at) VALUES(?,?,?,?,?)').run(id,input.name,input.kind,encryptConfig(input.config,config.encryptionKey),now());
    audit(db,c.get('user').id,'storage.create',id,input.kind);
    return c.json({ provider:storageView(storageRow(id)) },201);
  });
  app.patch('/api/admin/storage/:id',async c=>{
    const input=await json(c,storageSchema);
    const row=storageRow(c.req.param('id'));
    if (row.kind!==input.kind) throw new HTTPException(400, { message:'存储类型不能修改，请新建配置' });
    const previous=decryptConfig(row.config,config.encryptionKey) as StorageConfig;
    const merged={ ...input.config,secretAccessKey:input.config.secretAccessKey||previous.secretAccessKey,password:input.config.password||previous.password };
    const count=db.prepare('SELECT (SELECT COUNT(*) FROM images WHERE storage_id=?)+(SELECT COUNT(*) FROM avatars WHERE storage_id=?) AS count').get(row.id,row.id) as Row;
    if (count.count>0 && ['endpoint','bucket','path','region','forcePathStyle'].some(key => (merged as Row)[key] !== (previous as Row)[key])) throw new HTTPException(409, { message:'此存储已有图片，不能修改其位置；请新建配置后切换' });
    validateStorage(input.kind,merged);
    db.prepare('UPDATE storage_providers SET name=?,config=? WHERE id=?').run(input.name,encryptConfig(merged,config.encryptionKey),row.id);
    audit(db,c.get('user').id,'storage.update',row.id,'更新配置（不记录凭据）');
    return c.json({ provider:storageView(storageRow(row.id)) });
  });
  app.post('/api/admin/storage/:id/test',async c=>{
    limiter.hit('storage-test:'+c.get('user').id,20,60_000);
    const row=storageRow(c.req.param('id'));const store=providerStore(row);
    const key=`_connection-tests/${randomUUID()}.txt`;const data=Buffer.from('yingyu-connection-test');
    let putStarted=false;
    try {
      putStarted=true;await store.put(key,data,'text/plain');
      const read=await store.get(key);
      const actual=Buffer.isBuffer(read)?read:Buffer.from(await new Response(read).arrayBuffer());
      if (!actual.equals(data)) throw new Error('读取内容与写入内容不一致');
      await store.delete(key);putStarted=false;
      return c.json({ ok:true,message:'写入、读取和删除均正常' });
    } catch {
      if (putStarted) { try { await store.delete(key); } catch { audit(db,c.get('user').id,'storage.test.cleanup',row.id,`需手动清理测试对象 ${key}`); } }
      throw new HTTPException(502, { message:'连接测试失败，请检查端点、凭据与读写权限' });
    }
  });
  app.post('/api/admin/storage/:id/activate',c=>{
    const row=storageRow(c.req.param('id'));
    transaction(db,()=>{ db.prepare('UPDATE storage_providers SET active=0 WHERE active=1').run();db.prepare('UPDATE storage_providers SET active=1 WHERE id=?').run(row.id);audit(db,c.get('user').id,'storage.activate',row.id,row.name); });
    return c.json({ ok:true });
  });
  app.delete('/api/admin/storage/:id',c=>{
    const row=storageRow(c.req.param('id'));
    if (row.active || row.kind==='local') throw new HTTPException(409, { message:'默认存储或本地存储不能删除' });
    if (db.prepare('SELECT id FROM images WHERE storage_id=? UNION ALL SELECT id FROM avatars WHERE storage_id=? LIMIT 1').get(row.id,row.id)) throw new HTTPException(409, { message:'此存储仍有图片或头像，不能删除' });
    db.prepare('DELETE FROM storage_providers WHERE id=?').run(row.id);audit(db,c.get('user').id,'storage.delete',row.id,row.name);return c.json({ ok:true });
  });

  const announcementSchema = z.object({ title: z.string().trim().min(1).max(80), content: z.string().trim().min(1).max(10000), status: z.enum(['draft', 'published']), popup: z.boolean(), revision: z.number().int().positive().optional() });
  const announcementRow = (id: string) => {
    const row = db.prepare('SELECT * FROM announcements WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new HTTPException(404, { message: '公告不存在或已删除' });
    return row;
  };
  app.get('/api/admin/announcements', c => announcementList(c, true));
  app.post('/api/admin/announcements', async c => {
    const input = await json(c, announcementSchema);
    const id = randomUUID(), time = now();
    db.prepare('INSERT INTO announcements(id,title,content,status,popup,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?)').run(id, input.title, input.content, input.status, Number(input.popup), time, time, input.status === 'published' ? time : null);
    audit(db, c.get('user').id, 'announcement.create', id, input.title);
    return c.json({ announcement: announcementView(announcementRow(id)) }, 201);
  });
  app.patch('/api/admin/announcements/:id', async c => {
    const input = await json(c, announcementSchema);
    const row = announcementRow(c.req.param('id'));
    if (input.revision !== undefined && input.revision !== row.revision) throw new HTTPException(409, { message: '公告已被更新，请关闭编辑后刷新列表再试' });
    const changed = input.title !== row.title || input.content !== row.content || input.status !== row.status || Number(input.popup) !== row.popup;
    const time = changed ? now() : row.updated_at;
    const publishedAt = input.status === 'published' && row.status !== 'published' ? time : row.published_at;
    db.prepare('UPDATE announcements SET title=?,content=?,status=?,popup=?,revision=?,updated_at=?,published_at=? WHERE id=?').run(input.title, input.content, input.status, Number(input.popup), row.revision + Number(changed), time, publishedAt, row.id);
    audit(db, c.get('user').id, 'announcement.update', row.id, input.title);
    return c.json({ announcement: announcementView(announcementRow(row.id)) });
  });
  app.delete('/api/admin/announcements/:id', c => {
    const row = announcementRow(c.req.param('id'));
    db.prepare('DELETE FROM announcements WHERE id=?').run(row.id);
    audit(db, c.get('user').id, 'announcement.delete', row.id, row.title);
    return c.json({ ok: true });
  });
  app.patch('/api/admin/announcement-banner', async c => {
    const input = await json(c, z.object({ announcement: z.string().trim().max(500) }));
    db.prepare("UPDATE settings SET value=? WHERE key='announcement'").run(JSON.stringify(input.announcement));
    audit(db, c.get('user').id, 'announcement.banner', 'site', '更新图片页横条公告');
    return c.json(input);
  });

  app.get('/api/admin/settings',c=>c.json({ settings:getSettings(db) }));
  app.patch('/api/admin/settings',async c=>{
    const input=await json(c,z.object({ siteName:nameSchema,tagline:z.string().trim().max(120),registrationOpen:z.boolean(),defaultQuotaBytes:quotaSchema,maxUploadBytes:z.number().int().min(MiB).max(100*MiB),announcement:z.string().trim().max(500).optional() }));
    transaction(db,()=>{ const stmt=db.prepare('UPDATE settings SET value=? WHERE key=?');for (const [key,value] of Object.entries(input)) stmt.run(JSON.stringify(value),key);audit(db,c.get('user').id,'site.settings','site','更新站点设置'); });
    return c.json({ settings:getSettings(db) });
  });
  app.get('/api/admin/images',c=>{
    const page=z.coerce.number().int().min(1).parse(c.req.query('page')||1);
    const search=z.string().max(100).parse(c.req.query('search')||'');
    const pattern='%'+search.replace(/[\\%_]/g,'\\$&')+'%';
    const rows=db.prepare("SELECT i.*,u.name AS owner_name,s.name AS storage_name FROM images i JOIN users u ON u.id=i.user_id JOIN storage_providers s ON s.id=i.storage_id WHERE i.state='ready' AND (i.name LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\') ORDER BY i.created_at DESC LIMIT 30 OFFSET ?").all(pattern,pattern,(page-1)*30) as Row[];
    const total=(db.prepare("SELECT COUNT(*) AS count FROM images i JOIN users u ON u.id=i.user_id WHERE i.state='ready' AND (i.name LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')").get(pattern,pattern) as Row).count;
    return c.json({ images:rows.map(imageView),total,page });
  });
  app.delete('/api/admin/images/:id',async c=>{
    const row=db.prepare('SELECT * FROM images WHERE id=?').get(c.req.param('id')) as Row|undefined;
    if (!row) throw new HTTPException(404, { message:'图片不存在' });
    await deleteImage(row,c.get('user'));return c.json({ ok:true });
  });
  app.get('/api/admin/maintenance',c=>c.json({ pending:db.prepare("SELECT i.id,i.name,i.state,i.size,i.created_at AS createdAt,i.state_changed_at AS stateChangedAt,u.name AS ownerName,s.name AS storageName FROM images i JOIN users u ON u.id=i.user_id JOIN storage_providers s ON s.id=i.storage_id WHERE i.state!='ready' ORDER BY i.state_changed_at LIMIT 100").all() }));
  app.post('/api/admin/maintenance/:id/cleanup',async c=>{
    const row=db.prepare("SELECT * FROM images WHERE id=? AND state!='ready'").get(c.req.param('id')) as Row|undefined;
    if (!row) throw new HTTPException(404, { message:'待清理记录不存在' });
    const cutoff=new Date(Date.now()-10*60_000).toISOString();
    const claimedAt=now();
    // Claim before contacting storage. A second cleanup cannot return the same quota.
    const claimed=db.prepare("UPDATE images SET state_changed_at=? WHERE id=? AND state=? AND state_changed_at=? AND state_changed_at<=?").run(claimedAt,row.id,row.state,row.state_changed_at,cutoff);
    if (!claimed.changes) throw new HTTPException(409, { message:'任务仍在处理或停止不足 10 分钟，请稍后再试' });
    try { await providerStore(storageRow(row.storage_id)).delete(row.object_key); }
    catch {
      db.prepare('UPDATE images SET state_changed_at=? WHERE id=? AND state=? AND state_changed_at=?').run(row.state_changed_at,row.id,row.state,claimedAt);
      throw new HTTPException(502, { message:'清理失败，请检查存储连接后重试' });
    }
    transaction(db,()=>{
      const removed=db.prepare('DELETE FROM images WHERE id=? AND state=? AND state_changed_at=?').run(row.id,row.state,claimedAt);
      if (removed.changes) {
        const column=row.state==='uploading'?'reserved_bytes':'used_bytes';
        db.prepare(`UPDATE users SET ${column}=${column}-? WHERE id=?`).run(row.size,row.user_id);
        audit(db,c.get('user').id,'storage.cleanup',row.id,row.name);
      }
    });return c.json({ ok:true });
  });

  app.post('/api/integrations/quota',async c=>{
    if (!config.integrationToken) throw new HTTPException(404, { message:'配额集成接口未启用' });
    if (!equalSecret(c.req.header('Authorization')?.replace(/^Bearer /,'')||'',config.integrationToken)) throw new HTTPException(401, { message:'集成凭据无效' });
    limiter.hit('quota-integration',60,60_000);
    const input=await json(c,grantSchema.extend({ eventId:z.string().trim().min(1).max(128) }));
    return c.json(provisionIdempotent(db,input.eventId,input));
  });

  app.onError((error,c)=>{
    if (error instanceof HTTPException) return c.json({ error:error.message },error.status);
    if (error instanceof ZodError) return c.json({ error:error.issues[0]?.message||'输入内容无效' },400);
    console.error('请求处理失败:',error.name,error.message.replace(/https?:\/\/\S+/g,'[endpoint]'));
    return c.json({ error:'服务暂时不可用，请稍后再试' },500);
  });
  app.notFound(c=>c.json({ error:'页面或接口不存在' },404));
  return app;
}
