import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) process.loadEnvFile('.env');

export interface AppConfig {
  dataDir: string;
  publicUrl: string;
  encryptionKey: Buffer;
  production: boolean;
  integrationToken: string;
}

export function loadConfig(): AppConfig {
  const dataDir = resolve(process.env.DATA_DIR || './data');
  const production = process.env.NODE_ENV === 'production';
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const keyFile = resolve(dataDir, '.encryption-key');
  let key = process.env.ENCRYPTION_KEY || '';
  if (!key) {
    if (production) throw new Error('生产环境必须设置 ENCRYPTION_KEY（64 位十六进制字符串）');
    if (existsSync(keyFile)) key = readFileSync(keyFile, 'utf8').trim();
    else {
      key = randomBytes(32).toString('hex');
      writeFileSync(keyFile, key, { mode: 0o600, flag: 'wx' });
    }
  }
  if (!/^[\da-f]{64}$/i.test(key)) throw new Error('ENCRYPTION_KEY 必须为 64 位十六进制字符串');
  const publicUrl = process.env.PUBLIC_URL || 'http://localhost:5173';
  const parsed = new URL(publicUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('PUBLIC_URL 必须为 HTTP(S) 地址');
  if (production && parsed.protocol !== 'https:') throw new Error('生产环境 PUBLIC_URL 必须使用 HTTPS');
  return {
    dataDir,
    publicUrl: parsed.origin,
    encryptionKey: Buffer.from(key, 'hex'),
    production,
    integrationToken: process.env.QUOTA_INTEGRATION_TOKEN || '',
  };
}
