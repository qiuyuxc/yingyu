import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { openDatabase, insertUser, transaction, audit } from './db.js';
import { hashPassword } from './security.js';

const config=loadConfig();
const db=openDatabase(config.dataDir);
if (db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()) {
  console.log('管理员已经创建。请登录后台管理用户；初始化命令不会覆盖现有账号。');
  db.close();process.exit(0);
}
if (!stdin.isTTY) { console.error('请在交互终端运行 npm run setup，以创建首位管理员。');db.close();process.exit(1); }
const rl=createInterface({ input:stdin,output:stdout });
const email=await rl.question('管理员邮箱：');
const name=await rl.question('管理员名称：');
rl.close();

async function password(prompt:string):Promise<string> {
  stdout.write(prompt);
  stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');
  return new Promise((resolve,reject)=>{
    let value='';
    const finish=()=>{ stdin.setRawMode(false);stdin.off('data',handler);stdin.pause();stdout.write('\n'); };
    const handler=(chunk:string)=>{
      for (const char of chunk) {
        if (char==='\u0003') { finish();reject(new Error('已取消'));return; }
        if (char==='\r'||char==='\n') { finish();resolve(value);return; }
        if (char==='\u007f'||char==='\b') value=value.slice(0,-1);
        else if (char>=' ') value+=char;
      }
    };
    stdin.on('data',handler);
  });
}
try {
  const input=z.object({ email:z.string().trim().toLowerCase().email(),name:z.string().trim().min(1).max(40),password:z.string().min(10).max(128) }).parse({ email,name,password:await password('管理员密码（至少 10 字符，输入隐藏）：') });
  if (input.password!==await password('确认密码：')) throw new Error('两次密码不一致');
  const passwordHash=await hashPassword(input.password);
  transaction(db,()=>{
    if (db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()) throw new Error('管理员已被创建，请直接登录');
    const user=insertUser(db,{ ...input,passwordHash,role:'admin' });
    audit(db,user.id,'site.initialize','site','创建首位管理员');
  });
  console.log('管理员创建成功，可以通过登录页面进入后台。');
} catch (error) { console.error(error instanceof Error?error.message:'初始化失败');process.exitCode=1; }
finally { db.close(); }
