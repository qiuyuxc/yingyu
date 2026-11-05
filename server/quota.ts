import { HTTPException } from 'hono/http-exception';
import { audit, now, transaction, type DB, type Row } from './db.js';

// Stable extension point for future membership, sponsorship, or other services.
export interface QuotaGrant {
  userId: string;
  quotaBytes: number;
  tier: string;
  reason: string;
}

export interface QuotaProvisioner {
  grant(input: QuotaGrant, actorId: string | null): Row;
}

export function createQuotaProvisioner(db: DB): QuotaProvisioner {
  return {
    grant(input, actorId) {
      const user=db.prepare('SELECT * FROM users WHERE id=?').get(input.userId) as Row | undefined;
      if (!user) throw new HTTPException(404, { message:'用户不存在' });
      if (input.quotaBytes < user.used_bytes+user.reserved_bytes) throw new HTTPException(409, { message:'新额度不能低于已用空间和正在上传的空间之和' });
      db.prepare('UPDATE users SET quota_bytes=?,tier=? WHERE id=?').run(input.quotaBytes,input.tier,input.userId);
      audit(db,actorId,'quota.grant',input.userId,JSON.stringify({ before:user.quota_bytes,after:input.quotaBytes,reason:input.reason }));
      return db.prepare('SELECT * FROM users WHERE id=?').get(input.userId) as Row;
    },
  };
}

export function provisionIdempotent(db: DB, eventId: string, grant: QuotaGrant) {
  return transaction(db,() => {
    const previous=db.prepare('SELECT response FROM integration_events WHERE event_id=?').get(eventId) as Row | undefined;
    if (previous) return JSON.parse(previous.response);
    const user=createQuotaProvisioner(db).grant(grant,null);
    const response={ userId:user.id,quotaBytes:user.quota_bytes,tier:user.tier,eventId };
    db.prepare('INSERT INTO integration_events(event_id,response,created_at) VALUES(?,?,?)').run(eventId,JSON.stringify(response),now());
    return response;
  });
}
