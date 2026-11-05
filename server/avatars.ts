import { randomUUID } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { MiB, type AvatarLibrary } from '../shared/types.js';
import type { AppConfig } from './config.js';
import { audit, now, transaction, userView, type DB, type Row } from './db.js';
import { inspectImage } from './image.js';
import { decryptConfig } from './security.js';
import { createStore } from './storage.js';

export const AVATAR_LIMIT = 5 * MiB;
const DAY = 86400_000;

export function createAvatarService(db: DB, config: AppConfig) {
  const userRow = (id: string) => db.prepare('SELECT * FROM users WHERE id=?').get(id) as Row;
  const store = (id: string) => {
    const provider = db.prepare('SELECT * FROM storage_providers WHERE id=?').get(id) as Row;
    if (!provider) throw new Error('头像存储配置不存在');
    return createStore(provider.kind, decryptConfig(provider.config, config.encryptionKey), config.dataDir);
  };
  const snapshot = (userId: string): AvatarLibrary => {
    const user = userRow(userId);
    const rows = db.prepare("SELECT * FROM avatars WHERE user_id=? AND state IN ('current','history') ORDER BY created_at DESC,id").all(userId) as Row[];
    const view = (row: Row) => ({ id: row.id, name: row.name, size: row.size, url: row.state === 'current' ? '/a/' + row.id : '/api/account/avatars/' + row.id + '/content', createdAt: row.created_at });
    return { current: rows.find(row => row.state === 'current') ? view(rows.find(row => row.state === 'current')!) : null,
      history: rows.filter(row => row.state === 'history').map(view), enabled: Boolean(user.avatar_library_enabled), expiresAt: user.avatar_expires_at || null,
      pendingDeletes: (db.prepare("SELECT COUNT(*) AS count FROM avatars WHERE user_id=? AND state IN ('staging','garbage')").get(userId) as Row).count,
      user: userView(db, user) };
  };
  const withLock = async <T>(userId: string, work: (assertLock: () => void) => Promise<T>) => {
    const token = randomUUID();
    const claim = db.prepare('UPDATE users SET avatar_lock_token=?,avatar_lock_until=? WHERE id=? AND (avatar_lock_token IS NULL OR avatar_lock_until<?)').run(token, Date.now() + 120000, userId, Date.now());
    if (!claim.changes) throw new HTTPException(409, { message: '头像正在处理中，请稍后重试' });
    const heartbeat = setInterval(() => db.prepare('UPDATE users SET avatar_lock_until=? WHERE id=? AND avatar_lock_token=?').run(Date.now() + 120000, userId, token), 15000);
    heartbeat.unref();
    const assertLock = () => {
      if (userRow(userId)?.avatar_lock_token !== token) throw new HTTPException(409, { message: '头像操作已中断，请重试' });
    };
    try { return await work(assertLock); }
    finally { clearInterval(heartbeat); db.prepare('UPDATE users SET avatar_lock_token=NULL,avatar_lock_until=0 WHERE id=? AND avatar_lock_token=?').run(userId, token); }
  };
  const recover = (userId: string) => transaction(db, () => {
    // A lease can only be acquired after the old operation finished or expired.
    const reserved = (db.prepare("SELECT COALESCE(SUM(reserved_bytes),0) AS bytes FROM avatars WHERE user_id=? AND state='staging'").get(userId) as Row).bytes;
    db.prepare("UPDATE avatars SET state='garbage',reserved_bytes=0 WHERE user_id=? AND state='staging'").run(userId);
    if (reserved) db.prepare('UPDATE users SET reserved_bytes=reserved_bytes-? WHERE id=?').run(reserved, userId);
    const user = userRow(userId);
    if (!user.avatar_library_enabled && user.avatar_expires_at && user.avatar_expires_at <= now()) {
      db.prepare("UPDATE avatars SET state='garbage' WHERE user_id=? AND state='history'").run(userId);
      db.prepare('UPDATE users SET avatar_expires_at=NULL WHERE id=?').run(userId);
      audit(db, userId, 'avatar.expired', userId, '头像库保留期结束，清理历史头像');
    }
  });
  const drain = async (userId: string, assertLock: () => void) => {
    let complete = true;
    const garbage = db.prepare("SELECT * FROM avatars WHERE user_id=? AND state='garbage'").all(userId) as Row[];
    for (const row of garbage) {
      try { await store(row.storage_id).delete(row.object_key); }
      catch { complete = false; continue; }
      transaction(db, () => {
        assertLock();
        const removed = db.prepare("DELETE FROM avatars WHERE id=? AND state='garbage'").run(row.id);
        if (removed.changes && row.charged_bytes) db.prepare('UPDATE users SET used_bytes=used_bytes-? WHERE id=?').run(row.charged_bytes, userId);
      });
    }
    return complete;
  };
  const prepare = async (userId: string, assertLock: () => void) => {
    recover(userId);
    if (!await drain(userId, assertLock)) throw new HTTPException(502, { message: '旧头像尚未清理成功，请检查存储连接后重试；占用额度暂未归还' });
  };
  const changeQuota = (userId: string, delta: number, reservedDelta = 0) => {
    const changed = db.prepare('UPDATE users SET used_bytes=used_bytes+?,reserved_bytes=reserved_bytes+? WHERE id=? AND used_bytes+reserved_bytes+?+?<=quota_bytes AND used_bytes+?>=0 AND reserved_bytes+?>=0').run(delta, reservedDelta, userId, delta, reservedDelta, delta, reservedDelta);
    if (!changed.changes) throw new HTTPException(409, { message: '配额不足以保留原头像，请删除历史头像、关闭头像库或申请扩容' });
  };
  const upload = (userId: string, bytes: Buffer, name: string) => withLock(userId, async assertLock => {
    if (!bytes.length || bytes.length > AVATAR_LIMIT) throw new HTTPException(413, { message: '头像大小不能超过 5 MB' });
    const info = inspectImage(bytes);
    await prepare(userId, assertLock);
    const id = randomUUID();
    const key = `avatars/${userId}/${id}.${info.ext}`;
    const reservation = transaction(db, () => {
      assertLock();
      const user = userRow(userId);
      const current = db.prepare("SELECT * FROM avatars WHERE user_id=? AND state='current'").get(userId) as Row | undefined;
      const count = (db.prepare("SELECT COUNT(*) AS count FROM avatars WHERE user_id=? AND state='history'").get(userId) as Row).count;
      if (user.avatar_library_enabled && current && count >= 10) throw new HTTPException(409, { message: '头像库已保存 10 个历史头像，请先删除一个再上传' });
      const reserved = user.avatar_library_enabled && current ? current.size : 0;
      if (reserved) changeQuota(userId, 0, reserved);
      const provider = db.prepare('SELECT id FROM storage_providers WHERE active=1').get() as Row | undefined;
      if (!provider) throw new HTTPException(503, { message: '没有可用存储' });
      db.prepare("INSERT INTO avatars(id,user_id,storage_id,object_key,name,size,mime,state,reserved_bytes,created_at) VALUES(?,?,?,?,?,?,?,'staging',?,?)").run(id,userId,provider.id,key,name.slice(0,200),bytes.length,info.mime,reserved,now());
      return { provider: provider.id, reserved, previous: current?.id, keep: Boolean(user.avatar_library_enabled) };
    });
    try {
      await store(reservation.provider).put(key, bytes, info.mime);
      transaction(db, () => {
        assertLock();
        if (reservation.previous) db.prepare('UPDATE avatars SET state=?,charged_bytes=? WHERE id=?').run(reservation.keep ? 'history' : 'garbage',reservation.reserved,reservation.previous);
        if (reservation.reserved) changeQuota(userId,reservation.reserved,-reservation.reserved);
        db.prepare("UPDATE avatars SET state='current',reserved_bytes=0 WHERE id=?").run(id);
        audit(db,userId,'avatar.upload',id,'更新当前头像');
      });
    } catch (error) {
      transaction(db, () => {
        assertLock();
        const pending = db.prepare("SELECT reserved_bytes FROM avatars WHERE id=? AND state='staging'").get(id) as Row | undefined;
        if (pending) {
          db.prepare("UPDATE avatars SET state='garbage',reserved_bytes=0 WHERE id=?").run(id);
          if (pending.reserved_bytes) db.prepare('UPDATE users SET reserved_bytes=reserved_bytes-? WHERE id=?').run(pending.reserved_bytes,userId);
        }
      });
      await drain(userId,assertLock);
      if (error instanceof HTTPException) throw error;
      throw new HTTPException(502,{message:'头像上传失败，原头像已保留，请检查存储后重试'});
    }
    await drain(userId,assertLock);
    return snapshot(userId);
  });
  const select = (userId: string, id: string) => withLock(userId, async assertLock => {
    await prepare(userId,assertLock);
    transaction(db, () => {
      assertLock();
      const target = db.prepare("SELECT * FROM avatars WHERE id=? AND user_id=? AND state='history'").get(id,userId) as Row | undefined;
      if (!target) throw new HTTPException(404,{message:'历史头像不存在或已过期'});
      const current = db.prepare("SELECT * FROM avatars WHERE user_id=? AND state='current'").get(userId) as Row | undefined;
      const keep = Boolean(userRow(userId).avatar_library_enabled);
      const charge = keep && current ? current.size : 0;
      changeQuota(userId,charge-target.charged_bytes);
      if (current) db.prepare('UPDATE avatars SET state=?,charged_bytes=? WHERE id=?').run(keep?'history':'garbage',charge,current.id);
      db.prepare("UPDATE avatars SET state='current',charged_bytes=0 WHERE id=?").run(target.id);
      audit(db,userId,'avatar.select',id,'使用历史头像');
    });
    await drain(userId,assertLock);
    return snapshot(userId);
  });
  const remove = (userId: string, id: string) => withLock(userId, async assertLock => {
    await prepare(userId,assertLock);
    const changed = db.prepare("UPDATE avatars SET state='garbage' WHERE id=? AND user_id=? AND state IN ('history','current')").run(id,userId);
    if (!changed.changes) throw new HTTPException(404,{message:'头像不存在'});
    await drain(userId,assertLock);
    return snapshot(userId);
  });
  const setEnabled = (userId: string, enabled: boolean) => withLock(userId, async assertLock => {
    recover(userId); assertLock();
    const user=userRow(userId);
    const count=(db.prepare("SELECT COUNT(*) AS count FROM avatars WHERE user_id=? AND state='history'").get(userId) as Row).count;
    const expires=enabled||!count?null:user.avatar_expires_at||new Date(Date.now()+7*DAY).toISOString();
    db.prepare('UPDATE users SET avatar_library_enabled=?,avatar_expires_at=? WHERE id=?').run(enabled?1:0,expires,userId);
    audit(db,userId,'avatar.library',userId,enabled?'开启头像库并取消到期计划':'关闭头像库，历史头像保留 7 天');
    await drain(userId,assertLock);
    return snapshot(userId);
  });
  const maintain = (userId: string) => withLock(userId, async assertLock => { recover(userId); await drain(userId,assertLock); return snapshot(userId); });
  const sweep = async () => {
    const due=db.prepare("SELECT DISTINCT u.id FROM users u LEFT JOIN avatars a ON a.user_id=u.id WHERE (u.avatar_lock_token IS NULL OR u.avatar_lock_until<?) AND ((u.avatar_library_enabled=0 AND u.avatar_expires_at<=?) OR a.state IN ('staging','garbage')) LIMIT 100").all(Date.now(),now()) as Row[];
    for (const user of due) { try { await maintain(user.id); } catch (error) { if (!(error instanceof HTTPException && error.status===409)) throw error; } }
  };
  return { upload,select,remove,setEnabled,snapshot,maintain,sweep,store };
}
