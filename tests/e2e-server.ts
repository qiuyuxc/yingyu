import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insertUser, openDatabase } from '../server/db.js';
import { hashPassword } from '../server/security.js';
import { createServer } from 'node:http';
import { startTestSmtp } from './smtp-fixture.js';

// Browser tests get a separate, temporary site. No development data is touched.
const dataDir = mkdtempSync(join(tmpdir(), 'yingyu-browser-'));
process.env.DATA_DIR = dataDir;
process.env.PUBLIC_URL = 'http://127.0.0.1:4173';
process.env.HOST = '127.0.0.1';
process.env.PORT = '4173';
process.env.NODE_ENV = 'test';
// Model independent clients behind a proxy so the full suite does not share
// one login rate-limit bucket on the local loopback address.
process.env.TRUST_PROXY = '1';
process.on('exit', () => rmSync(dataDir, { recursive: true, force: true }));

const db = openDatabase(dataDir);
const passwordHash = await hashPassword('browser-test-password-2026');
insertUser(db, { email: 'admin@example.test', name: '岛屿管理员', role: 'admin', passwordHash });
for (const device of ['desktop', 'mobile']) {
  insertUser(db, { email: `banner-admin-${device}@example.test`, name: '公告测试管理员', role: 'admin', passwordHash });
  for (const identity of ['tour-a', 'tour-b', 'gesture', 'notice', 'email-change', 'banner-a', 'banner-b']) {
    insertUser(db, { email: `${identity}-${device}@example.test`, name: '引导用户', passwordHash });
  }
}
db.prepare("INSERT INTO announcements(id,title,content,status,popup,created_at,updated_at,published_at) VALUES('fixture-notice','欢迎来到映屿','本站公告会在登录成功后展示。','published',1,?,?,?)").run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
db.close();
const smtp=await startTestSmtp();
const mailbox=createServer((request,response)=>{
  response.setHeader('Content-Type','application/json');
  if(request.url==='/settings')response.end(JSON.stringify(smtp.settings));
  else if(request.url==='/messages')response.end(JSON.stringify(smtp.messages));
  else{response.statusCode=404;response.end('{}');}
});
await new Promise<void>(resolve=>mailbox.listen(4199,'127.0.0.1',resolve));
await import('../server/index.js');
