import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { HTTPException } from 'hono/http-exception';
import type { StorageConfig, StorageKind } from '../shared/types.js';

export interface ObjectStore {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<ReadableStream<Uint8Array> | Buffer>;
  delete(key: string): Promise<void>;
}

function safeKey(key: string) {
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(key) || key.split('/').includes('..') || key.startsWith('/')) throw new Error('无效的对象路径');
}

export function validateStorage(kind: StorageKind, config: StorageConfig) {
  if (kind === 'local') return;
  let url: URL;
  try { url = new URL(config.endpoint || ''); }
  catch { throw new HTTPException(400, { message: '请输入有效的存储端点地址' }); }
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new HTTPException(400, { message: '存储端点需使用 HTTP(S)，凭据请填写在独立字段中' });
  if (kind === 'r2' && (url.protocol !== 'https:' || url.port || url.pathname !== '/' || !/^(?:[a-f\d]{32})(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/i.test(url.hostname))) {
    throw new HTTPException(400, { message: 'R2 端点应为 https://<账户 ID>.r2.cloudflarestorage.com（可含区域）' });
  }
  if (kind === 's3' || kind === 'r2') {
    if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) throw new HTTPException(400, { message: '请填写存储桶、Access Key ID 和 Secret Access Key' });
    if (!/^[a-zA-Z0-9._-]{1,255}$/.test(config.bucket)) throw new HTTPException(400, { message: '存储桶名称无效' });
  }
  if (kind === 'webdav') {
    if (!config.username || !config.password) throw new HTTPException(400, { message: '请填写 WebDAV 用户名和密码' });
    if ((config.path || '').split('/').some(part => part === '..' || part === '.')) throw new HTTPException(400, { message: 'WebDAV 目录不能包含相对路径' });
  }
}

export function createStore(kind: StorageKind, config: StorageConfig, dataDir: string): ObjectStore {
  if (kind === 'local') {
    const base = resolve(dataDir, 'objects');
    const path = (key: string) => { safeKey(key); const file = resolve(base,key); if (!file.startsWith(base+sep)) throw new Error('无效路径'); return file; };
    return {
      async put(key,data) { const file=path(key); await mkdir(dirname(file), { recursive: true, mode: 0o700 }); await writeFile(file,data,{ flag:'wx',mode:0o600 }); },
      async get(key) { return readFile(path(key)); },
      async delete(key) { try { await unlink(path(key)); } catch (error: any) { if (error.code !== 'ENOENT') throw error; } },
    };
  }
  validateStorage(kind,config);
  if (kind === 's3' || kind === 'r2') {
    const client = new S3Client({
      endpoint: config.endpoint,
      region: kind === 'r2' ? 'auto' : config.region || 'us-east-1',
      credentials: { accessKeyId: config.accessKeyId!, secretAccessKey: config.secretAccessKey! },
      forcePathStyle: config.forcePathStyle ?? true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 2,
    });
    return {
      async put(key,data,mime) { safeKey(key); await client.send(new PutObjectCommand({ Bucket:config.bucket,Key:key,Body:data,ContentType:mime }), { abortSignal:AbortSignal.timeout(60_000) }); },
      async get(key) { safeKey(key); const object=await client.send(new GetObjectCommand({ Bucket:config.bucket,Key:key }), { abortSignal:AbortSignal.timeout(30_000) }); if (!object.Body) throw new Error('对象为空'); return object.Body.transformToWebStream(); },
      async delete(key) { safeKey(key); await client.send(new DeleteObjectCommand({ Bucket:config.bucket,Key:key }), { abortSignal:AbortSignal.timeout(30_000) }); },
    };
  }
  const base = new URL(config.endpoint!.replace(/\/?$/, '/'));
  const parts=(config.path||'').split('/').filter(Boolean);
  base.pathname=base.pathname.replace(/\/?$/,'/')+parts.map(encodeURIComponent).join('/')+(parts.length?'/':'');
  const authorization='Basic '+Buffer.from(`${config.username}:${config.password}`).toString('base64');
  const request = (url: URL, method: string, data?: Buffer, mime?: string, signal=AbortSignal.timeout(60_000)) => fetch(url, { method,headers:{ Authorization:authorization,...(mime?{ 'Content-Type':mime }:{} ) },body:data as unknown as BodyInit,signal,redirect:'error' });
  const objectUrl = (key: string) => { safeKey(key); return new URL(key.split('/').map(encodeURIComponent).join('/'),base); };
  return {
    async put(key,data,mime) {
      safeKey(key);
      const signal=AbortSignal.timeout(60_000);
      const target=objectUrl(key);
      // MKCOL each collection, including the configured root folder.
      const segments=target.pathname.split('/').filter(Boolean);
      let collection='/';
      for (const segment of segments.slice(0,-1)) {
        collection+=segment+'/';
        const url=new URL(base.origin+collection);
        const res=await request(url,'MKCOL',undefined,undefined,signal);
        if (![201,204,405].includes(res.status)) { await res.body?.cancel(); throw new Error(`WebDAV 创建目录失败 (${res.status})`); }
        await res.body?.cancel();
      }
      const res=await request(target,'PUT',data,mime,signal);
      await res.body?.cancel();
      if (!res.ok) throw new Error(`WebDAV 上传失败 (${res.status})`);
    },
    async get(key) { const res=await request(objectUrl(key),'GET'); if (!res.ok || !res.body) { await res.body?.cancel(); throw new Error(`WebDAV 读取失败 (${res.status})`); } return res.body; },
    async delete(key) { const res=await request(objectUrl(key),'DELETE'); await res.body?.cancel(); if (!res.ok && res.status!==404) throw new Error(`WebDAV 删除失败 (${res.status})`); },
  };
}
