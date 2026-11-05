import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createApp } from './app.js';

const config=loadConfig();
const db=openDatabase(config.dataDir);
const app=createApp(db,config);
if (existsSync('./dist/index.html')) {
  app.use('*',async(c,next)=>{
    if (!c.req.path.startsWith('/api/') && !c.req.path.startsWith('/i/')) c.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    await next();
  });
  app.use('*',serveStatic({ root:'./dist' }));
  app.get('*',async(c,next)=>{
    if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/i/')) return c.json({ error:'接口不存在' },404);
    return serveStatic({ path:'./dist/index.html' })(c,next);
  });
}
const port=Number(process.env.PORT||8787);
const host=process.env.HOST||'127.0.0.1';
const server=serve({ fetch:app.fetch,port,hostname:host },()=>console.log(`映屿服务运行于 http://${host}:${port}`));
function shutdown() { server.close(()=>{ db.close();process.exit(0); }); }
process.once('SIGINT',shutdown);
process.once('SIGTERM',shutdown);
