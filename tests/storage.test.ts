import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createStore, validateStorage } from '../server/storage.js';
import { fixture, PNG, readRequest, webdav } from './helpers.js';

test('local objects round-trip, cannot be overwritten, and reject traversal paths', async t => {
  const f = await fixture(t);
  const store = createStore('local', {}, f.config.dataDir);
  await store.put('user/image.png', PNG, 'image/png');
  assert.deepEqual(await store.get('user/image.png'), PNG);
  await assert.rejects(store.put('user/image.png', PNG, 'image/png'));
  for (const path of ['../secret', 'user/../secret', '/absolute', 'user/%2e%2e/secret']) {
    await assert.rejects(store.get(path));
    await assert.rejects(store.delete(path));
  }
  await store.delete('user/image.png');
  await store.delete('user/image.png');
  await assert.rejects(store.get('user/image.png'));
});

test('WebDAV creates collections, encodes folders, streams originals and treats a missing delete as successful', async t => {
  const dav = await webdav(t);
  const store = createStore('webdav', dav.config, 'unused');
  await store.put('user/image.png', PNG, 'image/png');
  const key = '/dav/' + encodeURIComponent('图片 library') + '/user/image.png';
  assert.deepEqual(dav.objects.get(key), PNG);
  assert.deepEqual(dav.calls.filter(call => call.method === 'MKCOL').map(call => call.path), ['/dav/', '/dav/' + encodeURIComponent('图片 library') + '/', '/dav/' + encodeURIComponent('图片 library') + '/user/']);
  const body = await store.get('user/image.png');
  assert.deepEqual(Buffer.from(await new Response(body as BodyInit).arrayBuffer()), PNG);
  await store.delete('user/image.png');
  await store.delete('user/image.png');
  assert.equal(dav.objects.size, 0);
});

test('WebDAV does not follow a redirect with storage credentials', async t => {
  const dav = await webdav(t);
  dav.control.redirect = true;
  const store = createStore('webdav', dav.config, 'unused');
  await assert.rejects(store.get('user/image.png'));
  assert.equal(dav.calls.length, 1);
});

test('S3-compatible storage signs path-style PUT/GET/DELETE and returns a readable original', async t => {
  const objects = new Map<string, Buffer>();
  const calls: { method: string; path: string; authorization: string; mime?: string }[] = [];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname;
    calls.push({ method: req.method!, path, authorization: req.headers.authorization || '', mime: req.headers['content-type'] });
    const data = await readRequest(req);
    if (req.method === 'PUT') { objects.set(path, data); res.writeHead(200, { ETag: '"test-etag"' }); res.end(); }
    else if (req.method === 'GET' && objects.has(path)) { const object = objects.get(path)!; res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(object.length), ETag: '"test-etag"' }); res.end(object); }
    else if (req.method === 'DELETE') { objects.delete(path); res.writeHead(204); res.end(); }
    else { res.writeHead(404, { 'Content-Type': 'application/xml' }); res.end('<Error><Code>NoSuchKey</Code></Error>'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const store = createStore('s3', { endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, region: 'us-east-1', bucket: 'images', accessKeyId: 'test-access', secretAccessKey: 'test-secret', forcePathStyle: true }, 'unused');
  await store.put('user/image.png', PNG, 'image/png');
  const body = await store.get('user/image.png');
  assert.deepEqual(Buffer.from(await new Response(body as BodyInit).arrayBuffer()), PNG);
  await store.delete('user/image.png');
  assert.deepEqual(calls.map(call => call.method), ['PUT', 'GET', 'DELETE']);
  assert.equal(calls.every(call => call.path === '/images/user/image.png'), true);
  assert.equal(calls.every(call => call.authorization.startsWith('AWS4-HMAC-SHA256 ') && call.authorization.includes('/us-east-1/s3/aws4_request')), true);
  assert.equal(calls[0].mime, 'image/png');
  assert.equal(objects.size, 0);
});

test('R2 accepts official HTTPS account endpoints and rejects invalid URLs and incomplete credentials', () => {
  const config = { endpoint: 'https://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com', bucket: 'images', accessKeyId: 'test-id', secretAccessKey: 'test-secret' };
  assert.doesNotThrow(() => validateStorage('r2', config));
  for (const endpoint of ['http://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com', config.endpoint + '/bucket', config.endpoint + ':8443', config.endpoint + '.evil.example', 'https://user:password@example.test']) {
    assert.throws(() => validateStorage('r2', { ...config, endpoint }));
  }
  assert.throws(() => validateStorage('r2', { ...config, secretAccessKey: '' }));
  assert.throws(() => validateStorage('webdav', { endpoint: 'https://dav.example.test', username: 'test', password: 'test', path: '../outside' }));
});
