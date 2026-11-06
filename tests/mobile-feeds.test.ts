import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, TEST_PASSWORD } from './helpers.js';

const headers = (token: string) => ({ Authorization: 'Bearer ' + token });
const nativeLogin = async (f: Awaited<ReturnType<typeof fixture>>, email: string) => {
  const response = await f.request('/api/mobile/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).session.accessToken as string;
};

test('native album rename and covers preserve ownership, privacy and the image collection', async t => {
  const f = await fixture(t);
  const owner = await f.user();
  const other = await f.user();
  const token = await nativeLogin(f, owner.email);
  const secondToken = await nativeLogin(f, other.email);
  const create = async (name: string) => {
    const response = await f.json('/api/albums', 'POST', { name }, undefined, headers(token));
    assert.equal(response.status, 201);
    return (await response.json()).album;
  };
  const album = await create('旅行');
  await create('作品');
  let list = (await (await f.request('/api/albums', { headers: headers(token) })).json()).albums;
  assert.equal(list.find((entry: { id: string }) => entry.id === album.id).coverUrl, null);
  const imageIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const response = await f.upload(null, { token, albumId: album.id, name: 'frame-' + i + '.png', visibility: 'private' });
    assert.equal(response.status, 201);
    imageIds.push((await response.json()).image.id);
  }
  list = (await (await f.request('/api/albums', { headers: headers(token) })).json()).albums;
  const entry = list.find((item: { id: string }) => item.id === album.id);
  assert.equal(entry.count, 5);
  assert.ok(imageIds.some(id => entry.coverUrl.endsWith('/i/' + id)));
  assert.equal((await f.request(entry.coverUrl)).status, 401);
  assert.equal((await f.request(entry.coverUrl, { headers: headers(secondToken) })).status, 404);
  assert.equal((await f.request(entry.coverUrl, { headers: headers(token) })).status, 200);
  assert.equal((await f.json('/api/albums/' + album.id, 'PATCH', { name: '别人的相册' }, undefined, headers(secondToken))).status, 404);
  assert.equal((await f.json('/api/albums/' + album.id, 'PATCH', { name: '作品' }, undefined, headers(token))).status, 409);
  assert.equal((await f.json('/api/albums/' + album.id, 'PATCH', { name: ' ' }, undefined, headers(token))).status, 400);
  const renamed = await f.json('/api/albums/' + album.id, 'PATCH', { name: '  旅行记录  ' }, undefined, headers(token));
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).album.name, '旅行记录');
  const loaded: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const response = await f.request('/api/images?albumId=' + album.id + '&limit=2&page=' + page, { headers: headers(token) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.total, 5);
    loaded.push(...data.images.map((image: { id: string }) => image.id));
  }
  assert.equal(new Set(loaded).size, 5);
  assert.deepEqual(new Set(loaded), new Set(imageIds));
});

test('native announcements expose a continuous published history and the latest popup revision', async t => {
  const f = await fixture(t);
  const owner = await f.user();
  const token = await nativeLogin(f, owner.email);
  const records = [];
  for (let index = 1; index <= 25; index++) {
    const id = randomUUID();
    const date = '2026-01-' + String(index).padStart(2, '0') + 'T12:00:00.000Z';
    records.push(id);
    f.db.prepare("INSERT INTO announcements(id,title,content,status,popup,revision,created_at,updated_at,published_at) VALUES(?,?,?,'published',?,?,?,?,?)")
      .run(id, '公告 ' + index, '第一行\n第二行', index === 25 || index === 10 ? 1 : 0, index === 25 ? 2 : 1, date, date, date);
  }
  const draft = randomUUID();
  f.db.prepare("INSERT INTO announcements(id,title,content,status,popup,created_at,updated_at) VALUES(?,?,?,'draft',1,?,?)")
    .run(draft, '草稿', '不应展示', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
  const first = await (await f.request('/api/announcements?page=1', { headers: headers(token) })).json();
  const second = await (await f.request('/api/announcements?page=2', { headers: headers(token) })).json();
  assert.equal(first.total, 25);
  assert.equal(first.announcements.length, 20);
  assert.equal(second.announcements.length, 5);
  const ids = [...first.announcements, ...second.announcements].map(item => item.id);
  assert.equal(new Set(ids).size, 25);
  assert.ok(!ids.includes(draft));
  assert.deepEqual(new Set(ids), new Set(records));
  const popup = await (await f.request('/api/announcements/popup', { headers: headers(token) })).json();
  assert.equal(popup.announcement.id, records[24]);
  assert.equal(popup.announcement.revision, 2);
  assert.equal(popup.announcement.content, '第一行\n第二行');
  assert.equal((await f.request('/api/announcements/popup')).status, 401);
});
