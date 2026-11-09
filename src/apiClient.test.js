import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from './apiClient.js';

const payload = { tracks: [{ id: '1' }], albums: [], playlists: [], history: [], favorites: [] };
const response = (body = payload, etag = '"v1"') => Response.json(body, { headers: { ETag: etag } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('deduplicates simultaneous loads and preserves reference on 304', async () => {
  const gate = deferred(), requests = [];
  const api = createApiClient('https://api.test', { getSession: () => 'alice', fetcher: async (_, options) => {
    requests.push(options);
    if (requests.length === 1) { await gate.promise; return response(); }
    return new Response(null, { status: 304 });
  } });
  const first = api('/api/library'), second = api('/api/library');
  gate.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(requests.length, 1);
  assert.equal(a, b);
  assert.equal(await api('/api/library'), a);
  assert.equal(requests[1].headers.get('If-None-Match'), '"v1"');
  assert.equal(requests[1].headers.get('Authorization'), 'Bearer alice');
});

test('session switching clears validators and rejects late private data', async () => {
  let session = 'alice'; const gate = deferred(), requests = [];
  const api = createApiClient('https://api.test', { getSession: () => session, fetcher: async (_, options) => {
    requests.push(options); if (requests.length === 1) await gate.promise;
    return response();
  } });
  const old = api('/api/library');
  session = 'bob';
  await api('/api/library');
  gate.resolve();
  await assert.rejects(old, { name: 'AbortError' });
  assert.equal(requests[1].headers.has('If-None-Match'), false);
  assert.equal(requests[1].headers.get('Authorization'), 'Bearer bob');
});

test('a late pre-edit response cannot overwrite the post-edit library', async () => {
  const gate = deferred(); let reads = 0;
  const updated = { ...payload, tracks: [{ id: '1', title: 'Updated' }] };
  const api = createApiClient('https://api.test', { getSession: () => 'alice', fetcher: async (_, options) => {
    if (options.method === 'PUT') return Response.json({ ok: true });
    reads++; if (reads === 1) { await gate.promise; return response(); }
    return response(updated, '"v2"');
  } });
  const old = api('/api/library');
  await api('/api/tracks/1', { method: 'PUT' });
  const fresh = await api('/api/library');
  gate.resolve();
  assert.deepEqual(await old, fresh);
  assert.equal(fresh.tracks[0].title, 'Updated');
});

test('failed requests do not poison subsequent loads', async () => {
  let calls = 0;
  const api = createApiClient('https://api.test', { getSession: () => '', fetcher: async () => {
    if (++calls === 1) return Response.json({ error: 'Try again' }, { status: 503 });
    return response();
  } });
  await assert.rejects(api('/api/library'), /Try again/);
  assert.deepEqual(await api('/api/library'), payload);
});
