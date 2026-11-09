// The database revision changes in the SAME transaction as the data (see 0007).
// Never cache the revision: a completed edit must be visible in every location.
const VERSION = 'v1';
const TTL = 86400;
const revisionSql = 'SELECT revision FROM library_revision WHERE id=1';
const personalSql = 'SELECT revision FROM user_library_revision WHERE user_id=?';

export const catalogQueries = [
  revisionSql,
  'SELECT * FROM tracks WHERE import_batch_id IS NULL ORDER BY created_at DESC',
  'SELECT * FROM playlists ORDER BY created_at DESC',
  'SELECT playlist_id, track_id FROM playlist_tracks ORDER BY position, rowid',
  'SELECT * FROM albums ORDER BY created_at DESC',
  'SELECT album_id, track_id FROM album_tracks ORDER BY position, rowid',
  'SELECT id,display_name,avatar_key FROM users',
];

function cacheKey(request, scope, revision) {
  // Internal keys are never routed to clients; ignore arbitrary query strings.
  return new Request(`${new URL(request.url).origin}/__cache/library/${VERSION}/${scope}/${revision}`);
}

function cacheError(error) {
  console.error(JSON.stringify({ event: 'library_cache_error', message: String(error) }));
}

async function cached(key) {
  try { return await caches.default.match(key); } catch (error) { cacheError(error); }
}

function remember(ctx, key, response) {
  ctx.waitUntil(caches.default.put(key, response.clone()).catch(cacheError));
}

function storedResponse(body, revision) {
  return new Response(body, { headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': `public, max-age=${TTL}`,
    'X-Library-Revision': String(revision),
  } });
}

async function sharedCatalog(request, env, ctx, revision, serialize) {
  const key = cacheKey(request, 'shared', revision);
  const hit = await cached(key);
  if (hit) return { response: hit, source: 'EDGE' };

  // One bounded object per origin, not one object per edit. R2 survives edge
  // eviction and deploys. The revision check also makes out-of-order puts safe.
  const objectKey = `cache/library-${VERSION}/${encodeURIComponent(new URL(request.url).origin)}/shared.json`;
  try {
    const object = await env.MEDIA.get(objectKey);
    if (object?.customMetadata?.revision === String(revision)) {
      const response = storedResponse(object.body, revision);
      remember(ctx, key, response);
      return { response, source: 'R2' };
    }
    if (object?.body) await object.body.cancel();
  } catch (error) { cacheError(error); }

  // Read data and its version in a single D1 transaction, including when an
  // edit races the initial version check. Never label new data with an old tag.
  const rows = await env.DB.batch(catalogQueries.map(sql => env.DB.prepare(sql)));
  revision = rows[0].results[0].revision;
  // Store a JSON prefix so hot requests stream it without parsing/stringifying
  // every track again. Only the tiny private suffix varies between listeners.
  const prefix = JSON.stringify(serialize(request, rows.slice(1))).slice(0, -1) + ',';
  const response = storedResponse(prefix, revision);
  remember(ctx, cacheKey(request, 'shared', revision), response);
  ctx.waitUntil(env.MEDIA.put(objectKey, prefix, {
    customMetadata: { revision: String(revision) },
    httpMetadata: { contentType: 'application/json' },
  }).catch(cacheError));
  console.log(JSON.stringify({ event: 'library_catalog_rebuild', revision,
    rowsRead: rows.reduce((sum, row) => sum + (row.meta?.rows_read || 0), 0) }));
  return { response, source: 'D1' };
}

async function personalLibrary(request, env, ctx, userId, revision) {
  const key = cacheKey(request, `user/${userId}`, revision);
  const hit = await cached(key);
  if (hit) return { value: await hit.json(), revision: Number(hit.headers.get('X-Library-Revision')) };
  const [state, favorites, history] = await env.DB.batch([
    env.DB.prepare(personalSql).bind(userId),
    env.DB.prepare('SELECT track_id FROM user_favorites WHERE user_id=?').bind(userId),
    env.DB.prepare('SELECT track_id FROM user_history WHERE user_id=? ORDER BY played_at DESC, id DESC LIMIT 200').bind(userId),
  ]);
  revision = state.results[0]?.revision || 0;
  const value = { favorites: favorites.results.map(row => row.track_id), history: history.results.map(row => row.track_id) };
  remember(ctx, cacheKey(request, `user/${userId}`, revision), storedResponse(JSON.stringify(value), revision));
  return { value, revision };
}

function tag(userId, shared, personal) { return `W/"library-${VERSION}-${userId}-${shared}-${personal}"`; }

function matches(header, etag) {
  return (header || '').split(',').some(value => value.trim().replace(/^W\//, '') === etag.replace(/^W\//, '') || value.trim() === '*');
}

function withSuffix(body, suffix) {
  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (!done) { controller.enqueue(value); return; }
      controller.enqueue(new TextEncoder().encode(suffix));
      controller.close();
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

export async function cachedLibrary(request, env, ctx, user, serialize, responseHeaders) {
  const state = await env.DB.prepare(`SELECT library_revision.revision AS shared,
    COALESCE(user_library_revision.revision,0) AS personal
    FROM library_revision LEFT JOIN user_library_revision ON user_library_revision.user_id=?
    WHERE library_revision.id=1`).bind(user.id).first();
  let etag = tag(user.id, state.shared, state.personal);
  const headers = responseHeaders(request, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-cache', 'Vary': 'Origin, Authorization', 'ETag': etag,
    'X-Library-Cache': 'NOT-MODIFIED',
  });
  if (matches(request.headers.get('If-None-Match'), etag)) return new Response(null, { status: 304, headers });
  const [shared, personal] = await Promise.all([
    sharedCatalog(request, env, ctx, state.shared, serialize),
    personalLibrary(request, env, ctx, user.id, state.personal),
  ]);
  etag = tag(user.id, shared.response.headers.get('X-Library-Revision'), personal.revision);
  headers.set('ETag', etag);
  headers.set('X-Library-Cache', shared.source);
  return new Response(withSuffix(shared.response.body, JSON.stringify(personal.value).slice(1)), { headers });
}

export async function cachedCoverPool(request, ctx, load, responseHeaders) {
  const key = new Request(`${new URL(request.url).origin}/__cache/discovery-covers/v1`);
  const hit = await cached(key);
  if (hit) return new Response(hit.body, { headers: responseHeaders(request, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': hit.headers.get('Cache-Control'),
  }) });
  const response = await load();
  if (response.ok) {
    const internal = new Response(response.clone().body, { headers: {
      'Content-Type': 'application/json', 'Cache-Control': response.headers.get('Cache-Control'),
    } });
    remember(ctx, key, internal);
  }
  return response;
}
