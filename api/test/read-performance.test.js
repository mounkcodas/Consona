import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://api.test';
const tokenA = 'a'.repeat(64), tokenB = 'b'.repeat(64);
const userA = randomUUID(), userB = randomUUID(), albumId = randomUUID();
const trackIds = Array.from({ length: 750 }, () => randomUUID());

function sqlStatements(sql) {
  const result = []; let buffer = '';
  for (const line of sql.replace(/^--.*$/gm, '').split('\n')) {
    buffer += line + '\n';
    if (/CREATE TRIGGER/i.test(buffer) ? /END;\s*$/.test(buffer) : /;\s*$/.test(buffer)) {
      result.push(buffer.trim()); buffer = '';
    }
  }
  return result;
}

test('library caching preserves behavior while bounding D1 reads', async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: [
    'api/test/worker-harness.js', 'api/src/index.js', 'api/src/import-workspace.js', 'api/src/library-cache.js', 'api/src/social-api.js', 'api/src/social-core.js', 'api/src/social-realtime.js',
  ].map(path => ({ type: 'ESModule', path: resolve(path) })),
    compatibilityDate: '2026-11-03', d1Databases: ['DB'], r2Buckets: ['MEDIA'] }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const bucket = await mf.getR2Bucket('MEDIA');
  for (const file of (await readdir('api/migrations')).sort()) {
    for (const sql of sqlStatements(await readFile(`api/migrations/${file}`, 'utf8'))) await db.prepare(sql).run();
  }
  // Verify the new migration is safe to reapply on deployments without tracking.
  for (const sql of sqlStatements(await readFile('api/migrations/0007_read_optimization.sql', 'utf8'))) await db.prepare(sql).run();
  for (const [id, name, token] of [[userA, 'alice', tokenA], [userB, 'bob', tokenB]]) {
    await db.prepare("INSERT INTO users(id,username,display_name,password_salt,password_hash) VALUES(?,?,?,'','')").bind(id, name, name).run();
    await db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,datetime('now','+1 day'))").bind(createHash('sha256').update(token).digest('hex'), id).run();
  }
  await db.prepare("INSERT INTO albums(id,title,artist,cover_url,added_by) VALUES(?,'Album','Artist','https://coverartarchive.org/album.jpg',?)").bind(albumId, userA).run();
  for (let i = 0; i < trackIds.length; i += 40) {
    await db.batch(trackIds.slice(i, i + 40).flatMap((id, index) => [
      db.prepare("INSERT INTO tracks(id,title,artist,album,audio_key,duration_seconds,primary_album_id,added_by,metadata_json) VALUES(?,?,'Artist','Album',?,125,?,?,?)")
        .bind(id, `Track ${i + index}`, `tracks/${id}/audio.mp3`, albumId, userA, JSON.stringify({ coverMode: index ? 'album' : 'individual', coverUrl: 'https://coverartarchive.org/individual.jpg' })),
      db.prepare('INSERT INTO album_tracks(album_id,track_id,position) VALUES(?,?,?)').bind(albumId, id, i + index),
    ]));
  }
  async function request(path = '/api/library', { token = tokenA, etag, method = 'GET', body, origin: corsOrigin = 'https://consona.live' } = {}) {
    const headers = { Origin: corsOrigin };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (etag) headers['If-None-Match'] = etag;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await mf.dispatchFetch(`${origin}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text && response.headers.get('Content-Type')?.includes('json') ? JSON.parse(text) : text || null,
      reads: Number(response.headers.get('X-Test-D1-Rows-Read')) };
  }
  const initial = await request();
  assert.equal(initial.status, 200);
  assert.equal(initial.body.tracks.length, 750);
  assert.equal(initial.body.albums[0].trackIds.length, 750);
  assert.equal(initial.body.tracks[0].duration, '2:05');
  assert.equal(initial.headers.get('X-Library-Cache'), 'D1');
  assert.deepEqual(Object.keys(initial.body).sort(), ['albums', 'favorites', 'history', 'playlists', 'tracks']);
  const etag = initial.headers.get('ETag');

  await t.test('unchanged polls read only indexed session and revision rows', async () => {
    let reads = 0;
    for (let i = 0; i < 100; i++) {
      const response = await request('/api/library', { etag });
      assert.equal(response.status, 304);
      assert.equal(response.body, null);
      assert.ok(response.reads <= 6, `read ${response.reads} rows`);
      reads += response.reads;
    }
    console.log(JSON.stringify({ coldReads: initial.reads, unchangedRequests: 100, totalReads: reads, reductionPercent: 100 * (1 - reads / (100 * initial.reads)) }));
  });
  await t.test('legacy clients reuse shared cache and CORS is reconstructed per origin', async () => {
    const response = await request('/api/library?ignored=cache-buster', { origin: 'https://www.consona.live' });
    assert.deepEqual(response.body, initial.body);
    assert.equal(response.headers.get('X-Library-Cache'), 'EDGE');
    assert.ok(response.reads <= 6);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://www.consona.live');
    assert.match(response.headers.get('Cache-Control'), /private/);
  });
  await t.test('simultaneous cache hits do not rescan the catalog', async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, () => request()));
    assert.ok(responses.every(result => result.status === 200 && result.reads <= 6));
    assert.ok(responses.every(result => result.body.tracks.length === 750));
  });
  await t.test('rolled-back transactions cannot publish a cache revision', async () => {
    const before = await request();
    await assert.rejects(db.batch([
      db.prepare("UPDATE tracks SET title='Must roll back' WHERE id=?").bind(trackIds[0]),
      db.prepare("INSERT INTO album_tracks(album_id,track_id) VALUES('missing','missing')"),
    ]));
    assert.equal((await request('/api/library', { etag: before.headers.get('ETag') })).status, 304);
  });
  await t.test('private data and conditional requests stay isolated between users', async () => {
    await request(`/api/tracks/${trackIds[0]}/favorite`, { method: 'POST', body: { favorite: true } });
    const alice = await request('/api/library', { etag });
    assert.equal(alice.status, 200);
    assert.deepEqual(alice.body.favorites, [trackIds[0]]);
    assert.equal(alice.headers.get('X-Library-Cache'), 'EDGE');
    const bob = await request('/api/library', { token: tokenB, etag: alice.headers.get('ETag') });
    assert.equal(bob.status, 200);
    assert.deepEqual(bob.body.favorites, []);
    assert.deepEqual(bob.body.history, []);
    assert.equal((await request('/api/library', { token: null, etag })).status, 401);
  });
  await t.test('R2 snapshot survives eviction of the local edge entry', async () => {
    const { revision } = await db.prepare('SELECT revision FROM library_revision WHERE id=1').first();
    const cache = (await mf.getCaches()).default;
    await cache.delete(`${origin}/__cache/library/v1/shared/${revision}`);
    const response = await request();
    assert.equal(response.headers.get('X-Library-Cache'), 'R2');
    assert.ok(response.reads <= 6);
    const snapshot = await bucket.get(`cache/library-v1/${encodeURIComponent(origin)}/shared.json`);
    const text = await snapshot.text();
    assert.ok(!text.includes('"favorites"') && !text.includes('"history"') && !text.includes('password'));
    assert.equal((await request('/api/media/' + encodeURIComponent(snapshot.key))).status, 404);
  });
  await t.test('edits, profile updates, and deletions invalidate every affected view', async () => {
    const before = await request();
    await request(`/api/tracks/${trackIds[0]}`, { method: 'PUT', body: { title: 'Edited immediately' } });
    const edited = await request('/api/library', { etag: before.headers.get('ETag') });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.tracks.find(row => row.id === trackIds[0]).title, 'Edited immediately');
    await db.prepare("UPDATE users SET display_name='New name' WHERE id=?").bind(userA).run();
    assert.equal((await request()).body.tracks[0].addedBy.displayName, 'New name');
    await request(`/api/tracks/${trackIds[0]}/history`, { method: 'POST' });
    assert.deepEqual((await request()).body.history, [trackIds[0]]);
    await request(`/api/tracks/${trackIds[0]}`, { method: 'DELETE' });
    const deleted = await request();
    assert.ok(!deleted.body.tracks.some(row => row.id === trackIds[0]));
    assert.ok(!deleted.body.albums[0].trackIds.includes(trackIds[0]));
    assert.deepEqual(deleted.body.favorites, []);
    assert.deepEqual(deleted.body.history, []);
  });
  await t.test('staging remains hidden, commits are fresh and retry-safe, discards leave the catalog alone', async () => {
    const batchId = randomUUID(), stagedId = randomUUID(), key = randomUUID();
    const before = await request();
    await db.prepare("INSERT INTO tracks(id,title,artist,album,audio_key,added_by,import_batch_id,import_item_key) VALUES(?,'Staged','Artist','Album',?,?,?,?)")
      .bind(stagedId, `tracks/${stagedId}/audio.mp3`, userA, batchId, randomUUID()).run();
    assert.equal((await request('/api/library', { etag: before.headers.get('ETag') })).status, 304);
    const payload = { batchId, albums: [{ key, existingId: albumId, title: 'Album', artist: 'Artist', initialCover: 'https://coverartarchive.org/album.jpg', coverUrl: 'https://coverartarchive.org/album.jpg' }],
      tracks: [{ id: stagedId, title: 'Published', artist: 'Artist', albumKey: key, coverMode: 'album' }] };
    const commit = await request('/api/import/commit', { method: 'POST', body: payload });
    assert.equal(commit.status, 200);
    const published = await request('/api/library', { etag: before.headers.get('ETag') });
    assert.equal(published.status, 200);
    assert.equal(published.body.tracks.find(row => row.id === stagedId).title, 'Published');
    assert.deepEqual((await request('/api/import/commit', { method: 'POST', body: payload })).body, commit.body);
    const discardBatch = randomUUID(), discardTrack = randomUUID();
    await db.prepare("INSERT INTO tracks(id,title,artist,album,audio_key,added_by,import_batch_id) VALUES(?,'Discard','Artist','Album',?,?,?)")
      .bind(discardTrack, `tracks/${discardTrack}/audio.mp3`, userA, discardBatch).run();
    assert.equal((await request(`/api/import/batches/${discardBatch}`, { method: 'DELETE' })).status, 200);
    assert.equal((await request('/api/library', { etag: published.headers.get('ETag') })).status, 304);
  });
  await t.test('history trimming retains the 200 most recent entries and uses an index', async () => {
    for (let i = 0; i < 205; i++) await db.prepare('INSERT INTO user_history(user_id,track_id) VALUES(?,?)').bind(userA, trackIds[1]).run();
    assert.equal((await request(`/api/tracks/${trackIds[2]}/history`, { method: 'POST' })).status, 201);
    const rows = await db.prepare('SELECT track_id FROM user_history WHERE user_id=? ORDER BY played_at DESC,id DESC').bind(userA).all();
    assert.equal(rows.results.length, 200);
    assert.equal(rows.results[0].track_id, trackIds[2]);
    const plan = await db.prepare('EXPLAIN QUERY PLAN SELECT album_id FROM album_tracks WHERE track_id=?').bind(trackIds[1]).all();
    assert.ok(plan.results.some(row => row.detail.includes('idx_album_tracks_track')));
  });
  await t.test('discovery cover pool is cached and public routes skip authentication reads', async () => {
    await db.prepare("UPDATE discovery_album_covers SET artwork_url='https://coverartarchive.org/image.jpg',updated_at=?,last_attempt_at=?").bind(Date.now(), Date.now()).run();
    assert.equal((await request('/api/discover/album-covers')).status, 200);
    const hit = await request('/api/discover/album-covers?unused=2');
    assert.equal(hit.status, 200);
    assert.equal(hit.reads, 0);
    assert.equal((await request('/api/health')).reads, 0);
  });
  await t.test('logout revokes access even when a cached ETag matches', async () => {
    const before = await request();
    await request('/api/auth/logout', { method: 'POST' });
    assert.equal((await request('/api/library', { etag: before.headers.get('ETag') })).status, 401);
  });
});
