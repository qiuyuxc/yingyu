import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createAvatarService } from '../server/avatars.js';
import { createStore } from '../server/storage.js';
import { type Row, now } from '../server/db.js';
import { fixture, PNG, webdav } from './helpers.js';

test('current avatars are free; history is charged, reusable, private and bounded to ten entries',async t=>{
  const f=await fixture(t),user=await f.user({quotaBytes:PNG.length*20}),other=await f.user();
  const avatars=createAvatarService(f.db,f.config);
  const first=await avatars.upload(user.id,PNG,'first.png');
  assert.equal(first.user.usedBytes,0);assert.equal(first.history.length,0);
  const second=await avatars.upload(user.id,PNG,'second.png');
  assert.equal(second.user.usedBytes,0);assert.equal(f.db.prepare('SELECT id FROM avatars WHERE id=?').get(first.current!.id),undefined);
  await avatars.setEnabled(user.id,true);
  const third=await avatars.upload(user.id,Buffer.concat([PNG,Buffer.alloc(10)]),'third.png');
  assert.equal(third.user.usedBytes,PNG.length);assert.equal(third.history.length,1);
  assert.equal((await f.request(third.history[0].url,{headers:{Cookie:other.cookie}})).status,404);
  assert.equal((await f.request(third.history[0].url,{headers:{Cookie:user.cookie}})).status,200);
  assert.equal((await f.request('/a/'+third.history[0].id)).status,404);
  const switched=await avatars.select(user.id,second.current!.id);
  assert.equal(switched.current!.id,second.current!.id);assert.equal(switched.user.usedBytes,PNG.length+10);
  for(let i=0;i<9;i++)await avatars.upload(user.id,PNG,'saved-'+i+'.png');
  const full=avatars.snapshot(user.id);assert.equal(full.history.length,10);
  assert.equal(f.db.prepare("SELECT id FROM avatars WHERE user_id=? AND state IN ('current','history')").all(user.id).length,11);
  await assert.rejects(avatars.upload(user.id,PNG,'too-many.png'),/10 个历史头像/);
  const removed=await avatars.remove(user.id,full.history[0].id);
  assert.equal(removed.user.usedBytes,full.user.usedBytes-full.history[0].size);
});

test('insufficient quota leaves the current avatar unchanged and image uploads respect avatar reservations',async t=>{
  const f=await fixture(t),user=await f.user({quotaBytes:PNG.length});
  const dav=await webdav(t,f);const avatars=createAvatarService(f.db,f.config);
  await avatars.upload(user.id,PNG,'one.png');await avatars.setEnabled(user.id,true);
  const held=dav.blockNext('PUT');
  const replacing=avatars.upload(user.id,PNG,'two.png');await held.entered;
  let normal:Response;
  try {
    await assert.rejects(avatars.upload(user.id,PNG,'concurrent.png'),/正在处理中/);
    normal=await f.upload(user.cookie);
  } finally {held.release();await replacing;}
  assert.equal(normal.status,409);
  const before=avatars.snapshot(user.id);
  await assert.rejects(avatars.upload(user.id,PNG,'three.png'),/配额不足/);
  assert.equal(avatars.snapshot(user.id).current!.id,before.current!.id);
  assert.equal((f.db.prepare('SELECT reserved_bytes FROM users WHERE id=?').get(user.id) as Row).reserved_bytes,0);
});

test('disabled libraries retain history for seven days, reopening cancels expiry, and expiry cleans only history',async t=>{
  const f=await fixture(t),user=await f.user(),avatars=createAvatarService(f.db,f.config);
  await avatars.upload(user.id,PNG,'one.png');await avatars.setEnabled(user.id,true);
  await avatars.upload(user.id,PNG,'two.png');
  const disabled=await avatars.setEnabled(user.id,false);
  assert.equal(disabled.history.length,1);assert.ok(Math.abs(Date.parse(disabled.expiresAt!)-Date.now()-7*86400_000)<2000);
  const disabledAgain=await avatars.setEnabled(user.id,false);assert.equal(disabledAgain.expiresAt,disabled.expiresAt);
  const enabled=await avatars.setEnabled(user.id,true);assert.equal(enabled.expiresAt,null);
  await avatars.setEnabled(user.id,false);
  f.db.prepare("UPDATE users SET avatar_expires_at='2000-01-01T00:00:00Z' WHERE id=?").run(user.id);
  await avatars.sweep();
  const cleaned=avatars.snapshot(user.id);assert.equal(cleaned.history.length,0);assert.equal(cleaned.current!.id,disabled.current!.id);assert.equal(cleaned.user.usedBytes,0);
});

test('failed deletion holds charged quota until retry; interrupted uploads release reservations exactly once',async t=>{
  const f=await fixture(t),user=await f.user(),dav=await webdav(t,f),avatars=createAvatarService(f.db,f.config);
  await avatars.upload(user.id,PNG,'one.png');await avatars.setEnabled(user.id,true);
  const uploaded=await avatars.upload(user.id,PNG,'two.png');
  dav.control.failDelete=true;
  const deleted=await avatars.remove(user.id,uploaded.history[0].id);
  assert.equal(deleted.pendingDeletes,1);assert.equal(deleted.user.usedBytes,PNG.length);
  await assert.rejects(avatars.upload(user.id,PNG,'blocked.png'),/尚未清理/);
  dav.control.failDelete=false;await avatars.maintain(user.id);await avatars.maintain(user.id);
  assert.equal(avatars.snapshot(user.id).user.usedBytes,0);
  const id=randomUUID(),key='avatars/'+user.id+'/'+id+'.png';
  f.db.prepare("INSERT INTO avatars(id,user_id,storage_id,object_key,name,size,mime,state,reserved_bytes,created_at) VALUES(?,?,?,?,?,?,?,'staging',?,?)").run(id,user.id,'local',key,'interrupted.png',PNG.length,'image/png',PNG.length,now());
  f.db.prepare('UPDATE users SET reserved_bytes=? WHERE id=?').run(PNG.length,user.id);
  await createStore('local',{},f.config.dataDir).put(key,PNG,'image/png');
  await avatars.maintain(user.id);await avatars.maintain(user.id);
  assert.equal((f.db.prepare('SELECT reserved_bytes FROM users WHERE id=?').get(user.id) as Row).reserved_bytes,0);
  assert.equal(f.db.prepare('SELECT id FROM avatars WHERE id=?').get(id),undefined);
});

test('a failed avatar upload keeps the old avatar and storage configuration cannot strand avatars',async t=>{
  const f=await fixture(t),admin=await f.user({role:'admin'}),user=await f.user(),dav=await webdav(t,f),avatars=createAvatarService(f.db,f.config);
  const old=await avatars.upload(user.id,PNG,'old.png');await avatars.setEnabled(user.id,true);
  dav.control.failPut=true;dav.control.persistFailedPut=true;
  await assert.rejects(avatars.upload(user.id,PNG,'failed.png'),/上传失败/);
  const state=avatars.snapshot(user.id);assert.equal(state.current!.id,old.current!.id);assert.equal(state.user.usedBytes,0);assert.equal(state.user.reservedBytes,0);
  const edit=await f.json('/api/admin/storage/'+dav.id,'PATCH',{name:'changed',kind:'webdav',config:{...dav.config,path:'other'}},admin.cookie);
  assert.equal(edit.status,409);
  await f.json('/api/admin/storage/local/activate','POST',{},admin.cookie);
  assert.equal((await f.request('/api/admin/storage/'+dav.id,{method:'DELETE',headers:{Origin:f.config.publicUrl,Cookie:admin.cookie}})).status,409);
});
