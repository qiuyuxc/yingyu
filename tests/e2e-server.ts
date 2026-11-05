import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insertUser, openDatabase } from '../server/db.js';
import { hashPassword } from '../server/security.js';

// Browser tests get a separate, temporary site. No development data is touched.
const dataDir = mkdtempSync(join(tmpdir(), 'yingyu-browser-'));
process.env.DATA_DIR = dataDir;
process.env.PUBLIC_URL = 'http://127.0.0.1:4173';
process.env.HOST = '127.0.0.1';
process.env.PORT = '4173';
process.env.NODE_ENV = 'test';
process.on('exit', () => rmSync(dataDir, { recursive: true, force: true }));

const db = openDatabase(dataDir);
insertUser(db, { email: 'admin@example.test', name: '岛屿管理员', role: 'admin', passwordHash: await hashPassword('browser-test-password-2026') });
db.close();
await import('../server/index.js');
