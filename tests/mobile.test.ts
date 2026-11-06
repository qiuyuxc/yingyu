import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, TEST_PASSWORD, PNG } from './helpers.js';
import { hashToken } from '../server/security.js';
import type { Row } from '../server/db.js';
import { createMailService } from '../server/mail.js';
import { startTestSmtp } from './smtp-fixture.js';

const auth = '/api/mobile/v1/auth/';
const bearer = (token: string) => ({ Authorization: 'Bearer ' + token });
const post = (body: unknown, token?: string): RequestInit => ({ method:'POST',headers:{'Content-Type':'application/json',...(token?bearer(token):{})},body:JSON.stringify(body) });

test('native login issues a hashed, expiring bearer session without a cookie; rotates and revokes independently', async t => {
  const f=await fixture(t);
  const user=await f.user();
  const response=await f.request(auth+'login',post({email:user.email,password:TEST_PASSWORD}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('set-cookie'),null);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const {session}=await response.json();
  assert.match(session.accessToken,/^yy_app_/);
  const row=f.db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(hashToken(session.accessToken)) as Row;
  assert.equal(row.kind,'app');
  assert.equal(row.expires_at,session.expiresAt);
  assert.equal((await f.request('/api/auth/me',{headers:bearer(session.accessToken)})).status,200);
  assert.equal((await f.request('/api/auth/me',{headers:{Cookie:'yingyu_session='+session.accessToken}})).status,401);
  const renewed=await f.request(auth+'refresh',post({},session.accessToken));
  assert.equal(renewed.status,200);
  const next=(await renewed.json()).session.accessToken;
  assert.notEqual(next,session.accessToken);
  assert.equal((await f.request('/api/auth/me',{headers:bearer(session.accessToken)})).status,401);
  assert.equal((await f.request(auth+'logout',post({},next))).status,200);
  assert.equal((await f.request('/api/auth/me',{headers:bearer(next)})).status,401);
  assert.equal((await f.request('/api/auth/me',{headers:{Cookie:user.cookie}})).status,200);
});

test('mobile auth exemptions do not weaken browser origin checks or accept cookies/form posts', async t => {
  const f=await fixture(t);
  const user=await f.user();
  const body={email:user.email,password:TEST_PASSWORD};
  assert.equal((await f.request('/api/auth/login',post(body))).status,403);
  assert.equal((await f.request(auth+'login',{...post(body),headers:{'Content-Type':'application/json',Origin:'https://evil.test'}})).status,403);
  assert.equal((await f.request(auth+'login',{...post(body),headers:{'Content-Type':'text/plain'}})).status,400);
  assert.equal((await f.request(auth+'login',{...post(body),headers:{'Content-Type':'application/json',Cookie:user.cookie}})).status,400);
  assert.equal((await f.json(auth+'refresh','POST',{},user.cookie)).status,403);
  assert.equal((await f.request('/api/account/profile',{...post({name:'forged'}),method:'PATCH',headers:{'Content-Type':'application/json',Cookie:user.cookie}})).status,403);
});

test('mobile sessions support private images and only the explicitly allowed administration actions', async t => {
  const f=await fixture(t);
  const owner=await f.user(); const admin=await f.user({role:'admin'}); const stranger=await f.user();
  const login=async(email:string)=>(await (await f.request(auth+'login',post({email,password:TEST_PASSWORD}))).json()).session.accessToken;
  const ownerToken=await login(owner.email); const adminToken=await login(admin.email); const otherToken=await login(stranger.email);
  const image=(await (await f.upload(null,{token:ownerToken,visibility:'private'})).json()).image;
  assert.deepEqual(Buffer.from(await (await f.request('/i/'+image.id,{headers:bearer(ownerToken)})).arrayBuffer()),PNG);
  assert.equal((await f.request('/i/'+image.id,{headers:bearer(otherToken)})).status,404);
  assert.equal((await f.request('/i/'+image.id,{headers:bearer(adminToken)})).status,200);
  for(const path of ['overview','images','quota-requests']) {
    assert.equal((await f.request('/api/admin/'+path,{headers:bearer(adminToken)})).status,200);
    assert.equal((await f.request('/api/admin/'+path,{headers:bearer(ownerToken)})).status,403);
  }
  for(const path of ['settings','storage','mail','users','maintenance']) assert.equal((await f.request('/api/admin/'+path,{headers:bearer(adminToken)})).status,403);
  const quota=await f.request('/api/quota/requests',post({requestedBytes:2*1024**3,reason:'用于存放更多照片'},ownerToken));
  assert.equal(quota.status,201);
  const id=(await quota.json()).request.id;
  const review={...post({status:'approved',adminNote:'同意扩容'},adminToken),method:'PATCH'};
  assert.equal((await f.request('/api/admin/quota-requests/'+id,review)).status,200);
  assert.equal((await f.request('/api/admin/quota-requests/'+id,review)).status,409);
  assert.equal((await f.request('/api/admin/images/'+image.id,{method:'DELETE',headers:bearer(adminToken)})).status,200);
  const personal=(await (await f.json('/api/account/tokens','POST',{name:'personal'},admin.cookie)).json()).token;
  assert.equal((await f.request('/api/admin/images',{headers:bearer(personal)})).status,403);
});

test('registration, password changes, expiration and role changes preserve mobile session boundaries', async t => {
  const f=await fixture(t); const admin=await f.user({role:'admin'});
  const registration=await f.request(auth+'register',post({name:'App 用户',email:'native@example.test',password:TEST_PASSWORD}));
  assert.equal(registration.status,201); assert.equal(registration.headers.get('set-cookie'),null);
  const {user,session}=await registration.json();
  const changed=await f.request('/api/account/password',{...post({currentPassword:TEST_PASSWORD,password:'changed-password-2026'},session.accessToken),method:'PATCH'});
  assert.equal(changed.status,200); assert.equal(changed.headers.get('set-cookie'),null);
  const next=(await changed.json()).session.accessToken;
  assert.equal((await f.request('/api/auth/me',{headers:bearer(session.accessToken)})).status,401);
  assert.equal((await f.request('/api/auth/me',{headers:bearer(next)})).status,200);
  f.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run('2000-01-01T00:00:00.000Z',hashToken(next));
  assert.equal((await f.request(auth+'refresh',post({},next))).status,401);
  const login=await f.request(auth+'login',post({email:user.email,password:'changed-password-2026'}));
  const token=(await login.json()).session.accessToken;
  assert.equal((await f.json('/api/admin/users/'+user.id,'PATCH',{status:'suspended'},admin.cookie)).status,200);
  assert.equal((await f.request('/api/auth/me',{headers:bearer(token)})).status,401);
  assert.equal((await f.request(auth+'login',post({email:user.email,password:'changed-password-2026'}))).status,403);
});

test('native registration verifies email before issuing a session and changing email rotates native credentials', async t => {
  const f=await fixture(t); await f.user({role:'admin'});
  const smtp=await startTestSmtp(); t.after(smtp.close);
  createMailService(f.db,f.config).save(smtp.settings);
  const input={name:'手机注册',email:'verify-native@example.test',password:TEST_PASSWORD};
  const registration=await f.request(auth+'register',post(input));
  const pending=await registration.json();
  assert.equal(pending.verificationRequired,true); assert.equal(pending.session,undefined);
  assert.equal((await f.request(auth+'login',post(input))).status,403);
  const codeIn=(source:string)=>{
    const decoded=source.replace(/=\r\n/g,'').replace(/=([\da-f]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
    const code=decoded.match(/>(\d{6})<\/p>/)?.[1]; assert.ok(code); return code;
  };
  const verified=await f.request(auth+'verify-email',post({email:input.email,code:codeIn(smtp.messages[0])}));
  assert.equal(verified.status,200); assert.equal(verified.headers.get('set-cookie'),null);
  const {user,session}=await verified.json();
  const browser=f.session(f.db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as Row);
  const started=await f.request('/api/account/email-change',post({email:'changed-native@example.test',currentPassword:TEST_PASSWORD},session.accessToken));
  assert.equal(started.status,202);
  const requestId=(await started.json()).pending.requestId;
  const changed=await f.request('/api/account/email-change/confirm',post({requestId,code:codeIn(smtp.messages[1])},session.accessToken));
  assert.equal(changed.status,200); assert.equal(changed.headers.get('set-cookie'),null);
  const next=(await changed.json()).session.accessToken;
  assert.equal((await f.request('/api/auth/me',{headers:bearer(session.accessToken)})).status,401);
  assert.equal((await f.request('/api/auth/me',{headers:{Cookie:browser}})).status,401);
  const me=await f.request('/api/auth/me',{headers:bearer(next)});
  assert.equal((await me.json()).user.email,'changed-native@example.test');
});
