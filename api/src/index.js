const allowedOrigins = new Set([
  'https://mounkcodas.github.io',
  'https://obgmusicplayer.aleixomaycon.workers.dev',
  'https://consona.live',
  'https://www.consona.live',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function responseHeaders(request, extra = {}) {
  const origin = request.headers.get('Origin');
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range, If-Range',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Length, ETag',
    'Vary': 'Origin',
    ...extra,
  });
  if (origin && allowedOrigins.has(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function json(request, value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: responseHeaders(request, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }) });
}

function fail(request, message, status = 400) {
  return json(request, { error: message }, status);
}

function mediaUrl(request, key) {
  return key ? `${new URL(request.url).origin}/api/media/${encodeURIComponent(key)}` : '';
}

async function getLibrary(request, env) {
  const [trackRows, playlistRows, itemRows, favoriteRows, historyRows] = await Promise.all([
    env.DB.prepare('SELECT * FROM tracks ORDER BY created_at DESC').all(),
    env.DB.prepare('SELECT * FROM playlists ORDER BY created_at DESC').all(),
    env.DB.prepare('SELECT playlist_id, track_id FROM playlist_tracks ORDER BY position, rowid').all(),
    env.DB.prepare('SELECT track_id FROM favorites').all(),
    env.DB.prepare('SELECT track_id FROM history ORDER BY played_at DESC, id DESC LIMIT 200').all(),
  ]);
  const itemsByPlaylist = new Map();
  for (const item of itemRows.results) {
    const entries = itemsByPlaylist.get(item.playlist_id) || [];
    entries.push(item.track_id);
    itemsByPlaylist.set(item.playlist_id, entries);
  }
  return json(request, {
    tracks: trackRows.results.map(track => ({
      id: track.id, title: track.title, artist: track.artist, album: track.album,
      duration: formatTime(track.duration_seconds), seconds: track.duration_seconds,
      src: mediaUrl(request, track.audio_key),
      mainArt: mediaUrl(request, track.main_key) || parseMetadata(track.metadata_json).mainImageUrl || '',
      cover: mediaUrl(request, track.cover_key) || parseMetadata(track.metadata_json).coverUrl || '',
      metadata: parseMetadata(track.metadata_json),
    })),
    playlists: playlistRows.results.map(list => ({
      id: list.id, name: list.name, trackIds: itemsByPlaylist.get(list.id) || [],
      cover: mediaUrl(request, trackRows.results.find(track => track.id === (itemsByPlaylist.get(list.id) || [])[0])?.cover_key),
    })),
    favorites: favoriteRows.results.map(row => row.track_id),
    history: historyRows.results.map(row => row.track_id),
  });
}

function parseMetadata(value) {
  try { const data = JSON.parse(value || '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; }
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

async function uploadTrack(request, env) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > 48 * 1024 * 1024) return fail(request, 'O envio ultrapassa o limite de 48 MB.', 413);
  const form = await request.formData();
  const title = String(form.get('title') || '').trim().slice(0, 180);
  const artist = String(form.get('artist') || '').trim().slice(0, 180);
  const album = String(form.get('album') || '').trim().slice(0, 180);
  const duration = Math.max(0, Math.floor(Number(form.get('duration')) || 0));
  const audio = form.get('audio');
  const cover = form.get('cover');
  const mainImage = form.get('mainImage');
  const coverUrl = safeRemoteImage(form.get('coverUrl'));
  const mainImageUrl = safeRemoteImage(form.get('mainImageUrl'));
  let metadata = {};
  try { metadata = JSON.parse(String(form.get('metadata') || '{}')); } catch { return fail(request, 'Metadados inválidos.'); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || JSON.stringify(metadata).length > 24000) return fail(request, 'Metadados inválidos ou muito extensos.');
  metadata.coverUrl = coverUrl;
  metadata.mainImageUrl = mainImageUrl;
  if (!title || !artist || !album || !(audio instanceof File)) return fail(request, 'Informe música, artista, álbum e arquivo de áudio.');
  if (audio.size < 1 || audio.size > 32 * 1024 * 1024) return fail(request, 'O áudio deve ter até 32 MB.', 413);
  if (!(audio.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(audio.name))) return fail(request, 'O arquivo enviado não parece ser um áudio.');
  for (const image of [cover, mainImage]) {
    if (image && image.size > 7 * 1024 * 1024) return fail(request, 'Cada imagem deve ter até 7 MB.', 413);
    if (image && !image.type.startsWith('image/')) return fail(request, 'As capas precisam ser arquivos de imagem.');
  }

  const id = crypto.randomUUID();
  const audioKey = `tracks/${id}/audio-${safeName(audio.name)}`;
  const coverKey = cover instanceof File && cover.size ? `tracks/${id}/cover-${safeName(cover.name)}` : null;
  const mainKey = mainImage instanceof File && mainImage.size ? `tracks/${id}/main-${safeName(mainImage.name)}` : null;
  try {
    await env.MEDIA.put(audioKey, audio.stream(), { httpMetadata: { contentType: audio.type || 'application/octet-stream', cacheControl: 'public, max-age=31536000, immutable' } });
    if (coverKey && cover instanceof File) await env.MEDIA.put(coverKey, cover.stream(), { httpMetadata: { contentType: cover.type, cacheControl: 'public, max-age=31536000, immutable' } });
    if (mainKey && mainImage instanceof File) await env.MEDIA.put(mainKey, mainImage.stream(), { httpMetadata: { contentType: mainImage.type, cacheControl: 'public, max-age=31536000, immutable' } });
    await env.DB.prepare('INSERT INTO tracks (id, title, artist, album, duration_seconds, audio_key, cover_key, main_key, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, title, artist, album, duration, audioKey, coverKey, mainKey, JSON.stringify(metadata)).run();
  } catch (error) {
    await Promise.all([audioKey, coverKey, mainKey].filter(Boolean).map(key => env.MEDIA.delete(key)));
    throw error;
  }
  return json(request, { id }, 201);
}

function safeRemoteImage(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname === 'upload.wikimedia.org' ? url.href.slice(0, 2000) : '';
  } catch { return ''; }
}

function safeName(name) {
  return String(name || 'file').toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(-80) || 'file';
}

async function mediaResponse(request, env, key) {
  if (!/^(tracks|artists)\/[a-f0-9-]{36}\/[a-z0-9._-]+$/i.test(key)) return new Response('Not found', { status: 404 });
  const object = await env.MEDIA.get(key, { range: request.headers });
  if (!object) return new Response('Not found', { status: 404 });
  const headers = responseHeaders(request);
  object.writeHttpMetadata(headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (object.range) {
    const start = object.range.offset ?? Math.max(0, object.size - object.range.length);
    const end = start + object.range.length - 1;
    headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
    headers.set('Content-Length', String(object.range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { headers });
}

async function createPlaylist(request, env) {
  const payload = await request.json();
  const name = String(payload.name || '').trim().slice(0, 100);
  const trackIds = Array.isArray(payload.trackIds) ? [...new Set(payload.trackIds.map(String))].slice(0, 500) : [];
  if (!name) return fail(request, 'Informe o nome da playlist.');
  const id = crypto.randomUUID();
  const statements = [env.DB.prepare('INSERT INTO playlists (id, name) VALUES (?, ?)').bind(id, name)];
  for (const [position, trackId] of trackIds.entries()) statements.push(env.DB.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) SELECT ?, id, ? FROM tracks WHERE id = ?').bind(id, position, trackId));
  await env.DB.batch(statements);
  return json(request, { id, name, trackIds }, 201);
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(request, { 'Access-Control-Max-Age': '86400' }) });
  if (path === '/api/health' && request.method === 'GET') return json(request, { ok: true });
  if (path === '/api/library' && request.method === 'GET') return getLibrary(request, env);
  if (path === '/api/tracks' && request.method === 'POST') return uploadTrack(request, env);
  const mediaMatch = path.match(/^\/api\/media\/(.+)$/);
  if (mediaMatch && request.method === 'GET') return mediaResponse(request, env, decodeURIComponent(mediaMatch[1]));
  if (path === '/api/playlists' && request.method === 'POST') return createPlaylist(request, env);
  const playlistMatch = path.match(/^\/api\/playlists\/([^/]+)$/);
  if (playlistMatch && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').bind(playlistMatch[1]).run();
    await env.DB.prepare('DELETE FROM playlists WHERE id = ?').bind(playlistMatch[1]).run();
    return json(request, { ok: true });
  }
  const playlistTrackMatch = path.match(/^\/api\/playlists\/([^/]+)\/tracks$/);
  if (playlistTrackMatch && request.method === 'POST') {
    const payload = await request.json();
    const trackIds = Array.isArray(payload.trackIds) ? [...new Set(payload.trackIds.map(String))].slice(0, 500) : [String(payload.trackId || '')];
    const statements = trackIds.filter(Boolean).map((id, position) => env.DB.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) SELECT ?, id, (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?) + ? FROM tracks WHERE id = ?').bind(playlistTrackMatch[1], playlistTrackMatch[1], position, id));
    if (statements.length) await env.DB.batch(statements);
    return json(request, { ok: true });
  }
  const favoriteMatch = path.match(/^\/api\/tracks\/([^/]+)\/favorite$/);
  if (favoriteMatch && request.method === 'POST') {
    const payload = await request.json();
    if (payload.favorite) await env.DB.prepare('INSERT OR IGNORE INTO favorites (track_id) SELECT id FROM tracks WHERE id = ?').bind(favoriteMatch[1]).run();
    else await env.DB.prepare('DELETE FROM favorites WHERE track_id = ?').bind(favoriteMatch[1]).run();
    return json(request, { ok: true });
  }
  const historyMatch = path.match(/^\/api\/tracks\/([^/]+)\/history$/);
  if (historyMatch && request.method === 'POST') {
    await env.DB.prepare('INSERT INTO history (track_id) SELECT id FROM tracks WHERE id = ?').bind(historyMatch[1]).run();
    await env.DB.prepare('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY played_at DESC, id DESC LIMIT 200)').run();
    return json(request, { ok: true }, 201);
  }
  const trackMatch = path.match(/^\/api\/tracks\/([^/]+)$/);
  if (trackMatch && request.method === 'DELETE') {
    const track = await env.DB.prepare('SELECT audio_key, cover_key, main_key FROM tracks WHERE id = ?').bind(trackMatch[1]).first();
    if (track) await Promise.all([track.audio_key, track.cover_key, track.main_key].filter(Boolean).map(key => env.MEDIA.delete(key)));
    await env.DB.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').bind(trackMatch[1]).run();
    await env.DB.prepare('DELETE FROM favorites WHERE track_id = ?').bind(trackMatch[1]).run();
    await env.DB.prepare('DELETE FROM history WHERE track_id = ?').bind(trackMatch[1]).run();
    await env.DB.prepare('DELETE FROM tracks WHERE id = ?').bind(trackMatch[1]).run();
    return json(request, { ok: true });
  }
  return fail(request, 'Rota não encontrada.', 404);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (origin && !allowedOrigins.has(origin)) return new Response('Origin not allowed', { status: 403 });
    try {
      return await route(request, env);
    } catch (error) {
      console.error(JSON.stringify({ event: 'api_error', message: error instanceof Error ? error.message : 'unknown' }));
      return fail(request, 'Não foi possível concluir a operação.', 500);
    }
  },
};
