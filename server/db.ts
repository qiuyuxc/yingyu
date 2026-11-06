import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GiB, MiB, type SiteSettings, type User } from '../shared/types.js';

export const now = () => new Date().toISOString();
export type Row = Record<string, any>;

export function openDatabase(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(dataDir, 'yingyu.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
      quota_bytes INTEGER NOT NULL CHECK(quota_bytes >= 0),
      used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes >= 0),
      reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_bytes >= 0),
      tier TEXT NOT NULL DEFAULT '免费额度',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS storage_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('local','s3','r2','webdav')),
      config TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_storage ON storage_providers(active) WHERE active = 1;
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id,name)
    );
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      storage_id TEXT NOT NULL REFERENCES storage_providers(id),
      object_key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      album_id TEXT REFERENCES albums(id) ON DELETE SET NULL,
      visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private')),
      starred INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','ready','deleting')),
      created_at TEXT NOT NULL,
      state_changed_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS images_owner ON images(user_id,state,created_at);
    CREATE INDEX IF NOT EXISTS images_storage ON images(storage_id);
    CREATE INDEX IF NOT EXISTS images_album ON images(album_id,state,created_at,id);
    CREATE TABLE IF NOT EXISTS quota_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      requested_bytes INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      admin_note TEXT NOT NULL DEFAULT '',
      reviewer_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_request ON quota_requests(user_id) WHERE status = 'pending';
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','published')),
      popup INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT
    );
    CREATE INDEX IF NOT EXISTS announcements_published ON announcements(status,published_at);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT REFERENCES users(id),
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS integration_events (event_id TEXT PRIMARY KEY, response TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mail_config (id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS email_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),
      expires_at TEXT NOT NULL,
      UNIQUE(user_id,purpose)
    );
    CREATE TABLE IF NOT EXISTS email_change_requests (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL UNIQUE,
      source_email TEXT NOT NULL,
      password_fingerprint TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      delivered INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mail_logs (
      id TEXT PRIMARY KEY, recipient TEXT NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS avatars (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      storage_id TEXT NOT NULL REFERENCES storage_providers(id), object_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('staging','current','history','garbage')),
      charged_bytes INTEGER NOT NULL DEFAULT 0, reserved_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_current_avatar ON avatars(user_id) WHERE state='current';
    CREATE INDEX IF NOT EXISTS avatars_owner ON avatars(user_id,state);
  `);
  const imageColumns = db.prepare('PRAGMA table_info(images)').all() as Row[];
  const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as Row[];
  if (!sessionColumns.some(column => column.name === 'kind')) {
    db.exec("ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'web' CHECK(kind IN ('web','app'))");
  }
  db.exec('CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(user_id)');
  if (!imageColumns.some(column => column.name === 'state_changed_at')) {
    db.exec("ALTER TABLE images ADD COLUMN state_changed_at TEXT NOT NULL DEFAULT ''");
  }
  db.prepare("UPDATE images SET state_changed_at=created_at WHERE state_changed_at=''").run();
  const userColumns = db.prepare('PRAGMA table_info(users)').all() as Row[];
  if (!userColumns.some(column => column.name === 'email_verified_at')) {
    db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
    // Existing accounts and the bootstrap administrator keep working after upgrade.
    db.prepare('UPDATE users SET email_verified_at=created_at').run();
  }
  const additions: Record<string,string> = { avatar_library_enabled:'INTEGER NOT NULL DEFAULT 0',avatar_expires_at:'TEXT',avatar_lock_token:'TEXT',avatar_lock_until:'INTEGER NOT NULL DEFAULT 0' };
  for (const [name,type] of Object.entries(additions)) if (!userColumns.some(column=>column.name===name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  const tokenColumns=db.prepare('PRAGMA table_info(email_tokens)').all() as Row[];
  for (const [name,type] of Object.entries({code_hash:'TEXT',attempts:'INTEGER NOT NULL DEFAULT 0',sent_at:'TEXT'})) if (!tokenColumns.some(column=>column.name===name)) db.exec(`ALTER TABLE email_tokens ADD COLUMN ${name} ${type}`);
  const defaults: SiteSettings = {
    siteName: '映屿',
    tagline: '为每一张图片，留一个轻盈的住处。',
    registrationOpen: true,
    defaultQuotaBytes: GiB,
    maxUploadBytes: 20 * MiB,
    announcement: '免费使用，按需申请扩容。愿你的每一份创作，都有处可放。',
  };
  const insert = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
  for (const [key, value] of Object.entries(defaults)) insert.run(key, JSON.stringify(value));
  // Move the former single announcement into the center once, preserving edits.
  transaction(db, () => {
    const legacy = Object.fromEntries((db.prepare("SELECT key,value FROM settings WHERE key IN ('loginAnnouncementEnabled','loginAnnouncementTitle','loginAnnouncementContent')").all() as Row[]).map(row => [row.key, JSON.parse(row.value)]));
    if (typeof legacy.loginAnnouncementContent === 'string' && legacy.loginAnnouncementContent.trim()) {
      const time = now();
      db.prepare('INSERT OR IGNORE INTO announcements(id,title,content,status,popup,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?)')
        .run('legacy-announcement', legacy.loginAnnouncementTitle?.trim() || '站点公告', legacy.loginAnnouncementContent, legacy.loginAnnouncementEnabled ? 'published' : 'draft', legacy.loginAnnouncementEnabled ? 1 : 0, time, time, legacy.loginAnnouncementEnabled ? time : null);
    }
    db.prepare("DELETE FROM settings WHERE key IN ('loginAnnouncementEnabled','loginAnnouncementTitle','loginAnnouncementContent')").run();
    db.exec('PRAGMA user_version = 7');
  });
  db.prepare("INSERT OR IGNORE INTO storage_providers(id,name,kind,config,active,created_at) VALUES('local','本地存储','local','{}',1,?)").run(now());
  return db;
}

export type DB = ReturnType<typeof openDatabase>;

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getSettings(db: DB): SiteSettings {
  return Object.fromEntries((db.prepare('SELECT key,value FROM settings').all() as Row[]).map(row => [row.key, JSON.parse(row.value)])) as unknown as SiteSettings;
}

export function userView(db: DB, row: Row): User {
  const count = db.prepare("SELECT COUNT(*) AS count FROM images WHERE user_id=? AND state='ready'").get(row.id) as Row;
  const avatar=db.prepare("SELECT id FROM avatars WHERE user_id=? AND state='current'").get(row.id) as Row|undefined;
  const history=db.prepare("SELECT COUNT(*) AS count FROM avatars WHERE user_id=? AND state='history'").get(row.id) as Row;
  return {
    id: row.id, email: row.email, name: row.name, role: row.role, status: row.status,
    quotaBytes: row.quota_bytes, usedBytes: row.used_bytes, reservedBytes: row.reserved_bytes,
    tier: row.tier, imageCount: count.count, createdAt: row.created_at,
    avatarUrl:avatar?'/a/'+avatar.id:null,avatarLibraryEnabled:Boolean(row.avatar_library_enabled),avatarLibraryExpiresAt:row.avatar_expires_at||null,avatarHistoryCount:history.count,
  };
}

export function audit(db: DB, actorId: string | null, action: string, target: string, detail: string) {
  db.prepare('INSERT INTO audit(actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?)').run(actorId, action, target, detail, now());
}

export function insertUser(db: DB, input: { email: string; name: string; passwordHash: string; role?: 'user' | 'admin'; quotaBytes?: number; verified?: boolean }) {
  const id = randomUUID();
  db.prepare('INSERT INTO users(id,email,name,password_hash,role,quota_bytes,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id, input.email.toLowerCase(), input.name, input.passwordHash, input.role || 'user', input.quotaBytes ?? getSettings(db).defaultQuotaBytes, now());
  if (input.verified !== false) db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(now(), id);
  return db.prepare('SELECT * FROM users WHERE id=?').get(id) as Row;
}
