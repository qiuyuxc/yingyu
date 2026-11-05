import { createHash, randomBytes, scrypt, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { HTTPException } from 'hono/http-exception';

const derive = promisify(scrypt);
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = await derive(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, value] = encoded.split(':');
  if (algorithm !== 'scrypt' || !salt || !value) return false;
  const expected = Buffer.from(value, 'hex');
  const actual = await derive(password, salt, 64) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function equalSecret(actual: string, expected: string) {
  const a = createHash('sha256').update(actual).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b) && Boolean(expected);
}

export function encryptConfig(value: unknown, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptConfig(value: string, key: Buffer) {
  if (value === '{}') return {};
  const [iv, tag, body] = value.split('.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8'));
}

export class RateLimiter {
  private buckets = new Map<string, { count: number; until: number }>();
  hit(key: string, limit: number, windowMs: number) {
    const time = Date.now();
    // Bound attacker-controlled keys, including long-running installations.
    if (this.buckets.size > 10000) {
      for (const [k, v] of this.buckets) if (v.until <= time) this.buckets.delete(k);
      if (this.buckets.size > 10000) throw new HTTPException(429, { message: '请求过多，请稍后再试' });
    }
    const previous = this.buckets.get(key);
    const current = previous && previous.until > time ? previous : { count: 0, until: time + windowMs };
    if (current.count >= limit) throw new HTTPException(429, { message: '请求过多，请稍后再试' });
    current.count++;
    this.buckets.set(key, current);
  }
}
