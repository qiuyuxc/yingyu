import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { insertUser, openDatabase, transaction, type Row } from '../server/db.js';

test('a version-one database is migrated without losing an image or changing active storage', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'yingyu-migration-'));
  let db = openDatabase(dataDir);
  t.after(async () => { db.close(); await rm(dataDir, { recursive: true, force: true }); });
  const user = insertUser(db, { name: '旧用户', email: 'old@example.test', passwordHash: 'unused-in-migration-test' });
  const imageId = randomUUID();
  const createdAt = '2026-11-01T00:00:00.000Z';
  db.prepare('INSERT INTO images(id,user_id,storage_id,object_key,name,size,mime,created_at) VALUES(?,?,?,?,?,?,?,?)').run(imageId, user.id, 'local', 'old/image.png', 'image.png', 100, 'image/png', createdAt);
  transaction(db, () => {
    db.prepare('UPDATE storage_providers SET active=0').run();
    db.prepare("INSERT INTO storage_providers(id,name,kind,config,active,created_at) VALUES('external','External','s3','{}',1,?)").run(createdAt);
  });
  db.exec('ALTER TABLE images DROP COLUMN state_changed_at; ALTER TABLE users DROP COLUMN email_verified_at; PRAGMA user_version=1');
  db.close();
  db = openDatabase(dataDir);
  const image = db.prepare('SELECT * FROM images WHERE id=?').get(imageId) as Row;
  assert.equal(image.name, 'image.png');
  assert.equal(image.state_changed_at, createdAt);
  assert.equal((db.prepare('SELECT id FROM storage_providers WHERE active=1').get() as Row).id, 'external');
  assert.equal((db.prepare('PRAGMA user_version').get() as Row).user_version, 3);
  assert.ok((db.prepare('SELECT email_verified_at FROM users WHERE id=?').get(user.id) as Row).email_verified_at);
});
