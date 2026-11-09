import { importRoutes } from './import-workspace.js';
import { cachedLibrary, cachedCoverPool } from './library-cache.js';

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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range, If-Range, If-None-Match',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Length, ETag, X-Library-Cache',
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

function serializeCatalog(request, rows) {
  const [trackRows, playlistRows, itemRows, albumRows, albumItemRows, userRows] = rows;
  const tracksById = new Map(trackRows.results.map(track => [track.id, track]));
  const albumsById = new Map(albumRows.results.map(album => [album.id, album]));
  const metadataById = new Map(trackRows.results.map(track => [track.id, parseMetadata(track.metadata_json)]));
  const trackMetadata = track => metadataById.get(track?.id) || {};
  const usersById = new Map(userRows.results.map(person => [person.id, { id: person.id, displayName: person.display_name, avatar: mediaUrl(request, person.avatar_key) }]));
  const itemsByPlaylist = new Map();
  for (const item of itemRows.results) {
    const entries = itemsByPlaylist.get(item.playlist_id) || [];
    entries.push(item.track_id);
    itemsByPlaylist.set(item.playlist_id, entries);
  }
  const itemsByAlbum = new Map();
  for (const item of albumItemRows.results) { const entries = itemsByAlbum.get(item.album_id) || []; entries.push(item.track_id); itemsByAlbum.set(item.album_id, entries); }
  const albumCover = album => {
    if (!album) return '';
    const firstTrack = tracksById.get((itemsByAlbum.get(album.id) || [])[0]);
    return mediaUrl(request, album.cover_key) || album.cover_url || trackMetadata(firstTrack).coverUrl || mediaUrl(request, firstTrack?.cover_key) || '';
  };
  const primaryAlbum = track => albumsById.get(track.primary_album_id);
  const individualCover = track => trackMetadata(track).coverUrl || mediaUrl(request, track.cover_key) || '';
  return {
    tracks: trackRows.results.map(track => ({
      id: track.id, title: track.title, artist: track.artist, album: primaryAlbum(track)?.title || track.album,
      primaryAlbumId: track.primary_album_id, fileHash: track.content_hash || '', coverMode: trackMetadata(track).coverMode || 'individual', individualCover: individualCover(track),
      duration: formatTime(track.duration_seconds), seconds: track.duration_seconds,
      src: mediaUrl(request, track.audio_key),
      mainArt: mediaUrl(request, track.main_key) || trackMetadata(track).mainImageUrl || '',
      cover: trackMetadata(track).coverMode === 'album' ? albumCover(primaryAlbum(track)) || individualCover(track) : individualCover(track) || albumCover(primaryAlbum(track)),
      metadata: trackMetadata(track),
      addedBy: usersById.get(track.added_by) || null,
    })),
    playlists: playlistRows.results.map(list => ({
      id: list.id, name: list.name, trackIds: itemsByPlaylist.get(list.id) || [], addedBy: usersById.get(list.added_by) || null,
      cover: mediaUrl(request, tracksById.get((itemsByPlaylist.get(list.id) || [])[0])?.cover_key),
    })),
    albums: albumRows.results.map(album => {
      const trackIds=itemsByAlbum.get(album.id)||[];
      const firstTrack=tracksById.get(trackIds[0]);
      const firstTrackMetadata=trackMetadata(firstTrack);
      return { id:album.id, title:album.title, artist:album.artist, trackIds, addedBy: usersById.get(album.added_by) || null,
        cover:mediaUrl(request,album.cover_key)||album.cover_url||firstTrackMetadata.coverUrl||mediaUrl(request,firstTrack?.cover_key)||'',
        coverProof:parseMetadata(album.metadata_json).googleCoverProof||firstTrackMetadata.googleCoverProof||'',
        metadata:parseMetadata(album.metadata_json) };
    }),
  };
}

function parseMetadata(value) {
  try { const data = JSON.parse(value || '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; }
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

const bytesToHex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
function randomHex(size) { const bytes = crypto.getRandomValues(new Uint8Array(size)); return [...bytes].map(value => value.toString(16).padStart(2, '0')).join(''); }
async function digestHex(value) { return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
function constantTimeEqual(left, right) {
  left = left instanceof Uint8Array ? left : new Uint8Array(left);
  right = right instanceof Uint8Array ? right : new Uint8Array(right);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}
async function passwordDigest(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/.{2}/g) || [], part => parseInt(part, 16));
  return bytesToHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256));
}
function publicUser(user, request) {
  return { id: user.id, username: user.username, displayName: user.display_name, avatar: mediaUrl(request, user.avatar_key) };
}
async function getUser(request, env) {
  const token = (request.headers.get('Authorization') || '').match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
  if (!token) return null;
  return env.DB.prepare(`SELECT users.id, users.username, users.display_name, users.avatar_key
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now')`).bind(await digestHex(token)).first();
}
async function startSession(user, request, env) {
  const token = randomHex(32), tokenHash = await digestHex(token);
  await env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+30 days'))").bind(tokenHash, user.id).run();
  return json(request, { token, user: publicUser(user, request) }, 201);
}
async function authRoutes(request, env, path) {
  if (path === '/api/auth/register' && request.method === 'POST') {
    const body = await request.json();
    const username = String(body.username || '').trim();
    const displayName = String(body.displayName || username).trim().slice(0, 40);
    const password = String(body.password || '');
    if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) return fail(request, 'Use um usuário de 3 a 24 caracteres: letras, números, ponto, hífen ou sublinhado.');
    if (password.length < 10 || password.length > 128) return fail(request, 'A senha deve ter de 10 a 128 caracteres.');
    if (await env.DB.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').bind(username).first()) return fail(request, 'Esse nome de usuário já está em uso.', 409);
    const user = { id: crypto.randomUUID(), username, display_name: displayName || username, avatar_key: null };
    const salt = randomHex(16), passwordHash = await passwordDigest(password, salt);
    await env.DB.prepare('INSERT INTO users (id,username,display_name,password_salt,password_hash) VALUES (?,?,?,?,?)').bind(user.id, username, user.display_name, salt, passwordHash).run();
    return startSession(user, request, env);
  }
  if (path === '/api/auth/login' && request.method === 'POST') {
    const body = await request.json();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const attemptKey = await digestHex(`${ip}|${username.toLocaleLowerCase()}`);
    const attempt = await env.DB.prepare("SELECT failures FROM auth_attempts WHERE attempt_key=? AND window_start > datetime('now','-15 minutes')").bind(attemptKey).first();
    if ((attempt?.failures || 0) >= 8) return fail(request, 'Muitas tentativas. Aguarde 15 minutos e tente novamente.', 429);
    const record = await env.DB.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').bind(username).first();
    const expected = record?.password_hash || '00'.repeat(32);
    const actual = await passwordDigest(password.slice(0, 128), record?.password_salt || '00'.repeat(16));
    const valid = constantTimeEqual(Uint8Array.from(expected.match(/.{2}/g), part => parseInt(part, 16)), Uint8Array.from(actual.match(/.{2}/g), part => parseInt(part, 16)));
    if (!record || !valid) {
      await env.DB.prepare(`INSERT INTO auth_attempts (attempt_key,failures,window_start) VALUES (?,1,datetime('now'))
        ON CONFLICT(attempt_key) DO UPDATE SET failures=CASE WHEN window_start <= datetime('now','-15 minutes') THEN 1 ELSE failures+1 END, window_start=CASE WHEN window_start <= datetime('now','-15 minutes') THEN datetime('now') ELSE window_start END`).bind(attemptKey).run();
      return fail(request, 'Usuário ou senha incorretos.', 401);
    }
    await env.DB.prepare('DELETE FROM auth_attempts WHERE attempt_key=?').bind(attemptKey).run();
    return startSession(record, request, env);
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const token = (request.headers.get('Authorization') || '').match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digestHex(token)).run();
    return json(request, { ok: true });
  }
  if (path === '/api/auth/me' && request.method === 'GET') {
    const user = await getUser(request, env);
    return user ? json(request, { user: publicUser(user, request) }) : fail(request, 'Entre na sua conta.', 401);
  }
  return null;
}

async function updateProfile(request, env, user) {
  const form = await request.formData();
  const displayName = String(form.get('displayName') || user.display_name).trim().slice(0, 40) || user.display_name;
  const avatar = form.get('avatar');
  if (avatar instanceof File && avatar.size) {
    if (avatar.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(avatar.type)) return fail(request, 'Use uma imagem JPG, PNG, WebP ou AVIF de até 5 MB.');
    const key = `users/${user.id}/avatar-${crypto.randomUUID()}.${avatar.type.split('/')[1]}`;
    await env.MEDIA.put(key, avatar.stream(), { httpMetadata: { contentType: avatar.type, cacheControl: 'public, max-age=3600' } });
    if (user.avatar_key) await env.MEDIA.delete(user.avatar_key);
    await env.DB.prepare('UPDATE users SET display_name=?,avatar_key=? WHERE id=?').bind(displayName, key, user.id).run();
    return json(request, { user: publicUser({ ...user, display_name: displayName, avatar_key: key }, request) });
  }
  await env.DB.prepare('UPDATE users SET display_name=? WHERE id=?').bind(displayName, user.id).run();
  return json(request, { user: publicUser({ ...user, display_name: displayName }, request) });
}

async function uploadTrack(request, env, user, staged = false) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > 48 * 1024 * 1024) return fail(request, 'O envio ultrapassa o limite de 48 MB.', 413);
  const form = await request.formData();
  const batchId = staged ? String(form.get('batchId') || '') : null, itemKey = staged ? String(form.get('itemKey') || '') : null;
  const fileHash = /^[a-f0-9]{64}$/i.test(String(form.get('fileHash') || '')) ? String(form.get('fileHash')).toLowerCase() : null;
  if (staged) {
    if (!/^[a-f0-9-]{36}$/i.test(batchId) || !/^[a-f0-9-]{36}$/i.test(itemKey)) return fail(request, 'Rascunho inválido.');
    const previous = await env.DB.prepare('SELECT id FROM tracks WHERE added_by=? AND import_batch_id=? AND import_item_key=?').bind(user.id, batchId, itemKey).first();
    if (previous) return json(request, { id: previous.id });
    if (fileHash && await env.DB.prepare('SELECT id FROM tracks WHERE content_hash=? AND import_batch_id IS NULL').bind(fileHash).first()) return fail(request, 'Este arquivo já está na biblioteca. Adicione a música existente ao rascunho.', 409);
  }
  const title = String(form.get('title') || '').trim().slice(0, 180);
  const artist = String(form.get('artist') || '').trim().slice(0, 180);
  const album = String(form.get('album') || '').trim().slice(0, 180);
  const duration = Math.max(0, Math.floor(Number(form.get('duration')) || 0));
  const audio = form.get('audio');
  const cover = form.get('cover');
  const mainImage = form.get('mainImage');
  const coverUrl = String(form.get('coverUrl')||'');
  const mainImageUrl = safeRemoteImage(form.get('mainImageUrl'));
  let metadata = {};
  try { metadata = JSON.parse(String(form.get('metadata') || '{}')); } catch { return fail(request, 'Metadados inválidos.'); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || JSON.stringify(metadata).length > 24000) return fail(request, 'Metadados inválidos ou muito extensos.');
  metadata.coverUrl = await approvedImageUrl(env,coverUrl||metadata.coverUrl,metadata.googleCoverProof);
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
    await env.DB.prepare('INSERT INTO tracks (id, title, artist, album, duration_seconds, audio_key, cover_key, main_key, metadata_json, added_by,content_hash,import_batch_id,import_item_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?)')
      .bind(id, title, artist, album, duration, audioKey, coverKey, mainKey, JSON.stringify(metadata), user.id, fileHash, batchId, itemKey).run();
  } catch (error) {
    await Promise.all([audioKey, coverKey, mainKey].filter(Boolean).map(key => env.MEDIA.delete(key)));
    if (staged) { const retry = await env.DB.prepare('SELECT id FROM tracks WHERE added_by=? AND import_batch_id=? AND import_item_key=?').bind(user.id, batchId, itemKey).first(); if (retry) return json(request, { id: retry.id }); }
    throw error;
  }
  return json(request, { id }, 201);
}

function safeRemoteImage(value) {
  try {
    const url = new URL(String(value || ''));
    const allowedHost = ['upload.wikimedia.org', 'coverartarchive.org', 'lastfm.freetls.fastly.net', 'lastfm-img2.akamaized.net', 'i.scdn.co'].includes(url.hostname) || /^encrypted-tbn\d+\.gstatic\.com$/.test(url.hostname);
    return url.protocol === 'https:' && allowedHost ? url.href.slice(0, 2000) : '';
  } catch { return ''; }
}

async function spotifyCatalogToken(env) {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return '';
  const credentials = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' }).catch(() => null);
  if (!response?.ok) return '';
  return (await response.json().catch(() => ({}))).access_token || '';
}

async function spotifyCatalogGet(token, path) {
  const response = await fetch(`https://api.spotify.com/v1/${path}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  return response?.ok ? response.json().catch(() => null) : null;
}

async function googleImageProof(env, url) {
  const secret=env.GOOGLE_CSE_API_KEY;
  if(!secret)return '';
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(url)));
  return btoa(String.fromCharCode(...signature)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function approvedImageUrl(env, value, proof) {
  const url=safeRemoteImage(value);
  if(url)return url;
  const candidate=String(value||'').slice(0,2000);
  if(!/^https:\/\//i.test(candidate)||!proof||!env.GOOGLE_CSE_API_KEY)return '';
  const expected=await googleImageProof(env,candidate);
  const encoder=new TextEncoder();
  const [expectedHash,providedHash]=await Promise.all([
    crypto.subtle.digest('SHA-256',encoder.encode(expected)),
    crypto.subtle.digest('SHA-256',encoder.encode(String(proof))),
  ]);
  return constantTimeEqual(expectedHash,providedHash)?candidate:'';
}

async function googleImageSearch(request, env) {
  if(!env.GOOGLE_CSE_API_KEY||!env.GOOGLE_CSE_CX)return fail(request,'A busca Google ainda não está configurada no backend.',503);
  const query=(new URL(request.url).searchParams.get('q')||'').trim().slice(0,180);
  if(!query)return fail(request,'Informe o que deseja pesquisar.');
  const params=new URLSearchParams({key:env.GOOGLE_CSE_API_KEY,cx:env.GOOGLE_CSE_CX,q:query,searchType:'image',num:'8',safe:'active'});
  const response=await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)return fail(request,payload.error?.message||'A pesquisa Google falhou.',response.status);
  const items=(await Promise.all((payload.items||[]).map(async item=>({
    title:item.title||'Imagem',url:/^https:\/\//i.test(item.link||'')?item.link:'',thumbnail:item.image?.thumbnailLink||item.link||'',
    source:item.image?.contextLink||item.displayLink||'',width:item.image?.width||0,height:item.image?.height||0,
    proof:await googleImageProof(env,item.link||''),
  })))).filter(item=>item.url);
  return json(request,{items});
}

function safeName(name) {
  return String(name || 'file').toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(-80) || 'file';
}

async function mediaResponse(request, env, key) {
  if (!/^(tracks|artists|users|albums)\/[a-f0-9-]{36}\/[a-z0-9._-]+$/i.test(key)) return new Response('Not found', { status: 404 });
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

async function createPlaylist(request, env, user) {
  const payload = await request.json();
  const name = String(payload.name || '').trim().slice(0, 100);
  const trackIds = Array.isArray(payload.trackIds) ? [...new Set(payload.trackIds.map(String))].slice(0, 500) : [];
  if (!name) return fail(request, 'Informe o nome da playlist.');
  const id = crypto.randomUUID();
  const statements = [env.DB.prepare('INSERT INTO playlists (id, name, added_by) VALUES (?, ?, ?)').bind(id, name, user.id)];
  for (const [position, trackId] of trackIds.entries()) statements.push(env.DB.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) SELECT ?, id, ? FROM tracks WHERE id = ?').bind(id, position, trackId));
  await env.DB.batch(statements);
  return json(request, { id, name, trackIds }, 201);
}

async function createAlbum(request, env, user) {
  const payload = await request.json();
  const title = String(payload.title || '').trim().slice(0,180);
  const artist = String(payload.artist || '').trim().slice(0,180);
  const trackIds = Array.isArray(payload.trackIds) ? [...new Set(payload.trackIds.map(String))].slice(0,500) : [];
  if (!title) return fail(request,'Informe o nome do álbum.');
  const id=crypto.randomUUID(), coverUrl=await approvedImageUrl(env,payload.coverUrl,payload.coverProof);
  const metadata=payload.metadata&&typeof payload.metadata==='object'&&!Array.isArray(payload.metadata)?JSON.stringify(payload.metadata).slice(0,12000):'{}';
  const statements=[env.DB.prepare('INSERT INTO albums (id,title,artist,cover_url,metadata_json,added_by) VALUES (?,?,?,?,?,?)').bind(id,title,artist,coverUrl,metadata,user.id)];
  for (const [position,trackId] of trackIds.entries()) statements.push(env.DB.prepare('INSERT OR IGNORE INTO album_tracks (album_id,track_id,position) SELECT ?,id,? FROM tracks WHERE id=?').bind(id,position,trackId));
  await env.DB.batch(statements);
  return json(request,{id,title,artist,trackIds,cover:coverUrl},201);
}

async function updateAlbum(request, env, id) {
  const payload = await request.json();
  const current = await env.DB.prepare('SELECT * FROM albums WHERE id=?').bind(id).first();
  if (!current) return fail(request, 'Álbum não encontrado.', 404);
  const title = String(payload.title ?? current.title).trim().slice(0,180);
  const artist = String(payload.artist ?? current.artist).trim().slice(0,180);
  const coverUrl = payload.coverUrl === undefined ? current.cover_url : await approvedImageUrl(env,payload.coverUrl,payload.coverProof);
  if (payload.coverUrl && !coverUrl) return fail(request, 'Escolha uma capa válida ou envie uma imagem em Configurações.');
  const coverKey = payload.coverUrl === undefined ? current.cover_key : null;
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata) ? JSON.stringify(payload.metadata).slice(0,12000) : current.metadata_json;
  if (!title) return fail(request, 'Informe o nome do álbum.');
  await env.DB.prepare('UPDATE albums SET title=?,artist=?,cover_key=?,cover_url=?,metadata_json=? WHERE id=?').bind(title,artist,coverKey,coverUrl,metadata,id).run();
  return json(request,{ok:true});
}

async function refreshAlbumCoverPool(env, rows) {
  try {
    for (let offset = 0; offset < rows.length; offset += 3) {
      await Promise.all(rows.slice(offset, offset + 3).map(async album => {
        const attemptedAt = Date.now();
        try {
          const response = await fetch(`https://coverartarchive.org/release-group/${album.id}`, {
            headers: { Accept: 'application/json', 'User-Agent': 'Consona/1.0 (https://consona.live)' }, signal: AbortSignal.timeout(6500),
          });
          if (!response.ok) throw new Error(`Cover source ${response.status}`);
          const payload = await response.json();
          const front = payload.images?.find(image => image.front && image.approved !== false);
          const cover = new URL(front?.thumbnails?.['250'] || front?.thumbnails?.small || '');
          if (!['coverartarchive.org', 'archive.org'].includes(cover.hostname)) throw new Error('Invalid cover host');
          cover.protocol = 'https:';
          await env.DB.prepare('UPDATE discovery_album_covers SET artwork_url=?,updated_at=?,last_attempt_at=? WHERE id=?')
            .bind(cover.href, attemptedAt, attemptedAt, album.id).run();
        } catch {
          await env.DB.prepare('UPDATE discovery_album_covers SET last_attempt_at=? WHERE id=?').bind(attemptedAt, album.id).run();
        }
      }));
    }
  } finally {
    await env.DB.prepare('UPDATE discovery_cover_refresh SET lease_until=0 WHERE id=1').run();
  }
}

async function getAlbumCoverPool(request, env, ctx) {
  const readPool = () => env.DB.prepare("SELECT id,title,artist,artwork_url,source_url FROM discovery_album_covers WHERE artwork_url <> '' ORDER BY position,id LIMIT 24").all();
  let pool = await readPool();
  const now = Date.now();
  const stale = await env.DB.prepare("SELECT id FROM discovery_album_covers WHERE (artwork_url='' OR updated_at < ?) AND last_attempt_at < ? ORDER BY position LIMIT 12")
    .bind(now - 7 * 86400000, now - 3600000).all();
  if (stale.results.length) {
    const lease = await env.DB.prepare('UPDATE discovery_cover_refresh SET lease_until=? WHERE id=1 AND lease_until < ? RETURNING id').bind(now + 60000, now).first();
    if (lease) {
      const refresh = refreshAlbumCoverPool(env, stale.results).catch(error => console.error(JSON.stringify({ event: 'cover_pool_refresh_failed', message: String(error) })));
      if (pool.results.length < 6) { await refresh; pool = await readPool(); }
      else ctx.waitUntil(refresh);
    }
  }
  const result = json(request, { albums: pool.results.map(album => ({ id: album.id, title: album.title, artist: album.artist, cover: album.artwork_url, sourceUrl: album.source_url })) });
  result.headers.set('Cache-Control', pool.results.length ? 'public, max-age=300' : 'public, max-age=10');
  return result;
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(request, { 'Access-Control-Max-Age': '86400' }) });
  if (path === '/api/discover/album-covers' && request.method === 'GET') return cachedCoverPool(request, ctx, () => getAlbumCoverPool(request, env, ctx), responseHeaders);
  if (path === '/api/health' && request.method === 'GET') return json(request, { ok: true });
  const mediaMatch = path.match(/^\/api\/media\/(.+)$/);
  if (mediaMatch && request.method === 'GET') return mediaResponse(request, env, decodeURIComponent(mediaMatch[1]));
  const authResponse = await authRoutes(request, env, path);
  if (authResponse) return authResponse;
  const user = await getUser(request, env);
  if (path === '/api/import/tracks' && request.method === 'POST') return user ? uploadTrack(request, env, user, true) : fail(request, 'Entre na sua conta para importar músicas.', 401);
  const importResponse = await importRoutes(request, env, user, { json, fail, approvedImageUrl, mediaUrl, ctx });
  if (importResponse) return importResponse;
  if ((path === '/api/profile' || path === '/api/auth/profile') && request.method === 'PUT') return user ? updateProfile(request, env, user) : fail(request, 'Entre na sua conta.', 401);
  if (path === '/api/lastfm' && request.method === 'GET') {
    const apiKey = env.LASTFM_API_SECRET;
    if (!apiKey) return fail(request, 'A busca Last.fm não está disponível.', 503);
    const method = url.searchParams.get('method') || '';
    const allowedMethods = new Set(['track.getInfo', 'artist.getInfo', 'artist.getTopAlbums', 'album.getInfo', 'track.getSimilar']);
    if (!allowedMethods.has(method)) return fail(request, 'Método Last.fm não permitido.');
    const params = new URLSearchParams({ method, api_key: apiKey, format: 'json' });
    for (const key of ['artist', 'track', 'album', 'limit']) { const value = (url.searchParams.get(key) || '').slice(0, 180); if (value) params.set(key, value); }
    params.set('autocorrect', '1');
    const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) return fail(request, 'Last.fm não encontrou esses dados.', response.status >= 400 && response.status < 600 ? response.status : 502);
    return json(request, payload);
  }
  if (path === '/api/musicbrainz' && request.method === 'GET') {
    if (!user) return fail(request, 'Entre na sua conta para consultar o MusicBrainz.', 401);
    const entity = url.searchParams.get('entity') || '';
    if (!['recording', 'release', 'release-group'].includes(entity)) return fail(request, 'Consulta MusicBrainz inválida.');
    const id = url.searchParams.get('id') || '';
    if (id && !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) return fail(request, 'Identificador MusicBrainz inválido.');
    const query = (url.searchParams.get('query') || '').trim().slice(0, 250);
    const group = url.searchParams.get('release-group') || '';
    if (group && !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(group)) return fail(request, 'Grupo de lançamento inválido.');
    if (!id && !query && !(entity === 'release' && group)) return fail(request, 'Informe os dados da busca MusicBrainz.');
    const inc = (url.searchParams.get('inc') || '').trim();
    if (inc && !/^(?:genres|ratings|annotation|url-rels|recordings)(?: (?:genres|ratings|annotation|url-rels|recordings))*$/.test(inc)) return fail(request, 'Detalhes MusicBrainz inválidos.');
    const limit = Math.min(25, Math.max(1, Number(url.searchParams.get('limit')) || 8));
    const params = new URLSearchParams({ fmt: 'json', limit: String(limit) });
    if (query) params.set('query', query);
    if (group) params.set('release-group', group);
    if (inc) params.set('inc', inc);
    const target = `https://musicbrainz.org/ws/2/${entity}/${id}?${params}`;
    const response = await fetch(target, { headers: { Accept: 'application/json', 'User-Agent': 'Consona/1.0 (https://consona.live)' }, signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (!response?.ok) return fail(request, 'O MusicBrainz está temporariamente indisponível.', response?.status === 429 || response?.status === 503 ? response.status : 502);
    return json(request, await response.json());
  }
  if (path === '/api/spotify/albums/search' && request.method === 'GET') {
    if (!user) return fail(request, 'Entre na sua conta para buscar álbuns.', 401);
    const query = (url.searchParams.get('q') || '').trim().slice(0, 180);
    if (query.length < 2) return fail(request, 'Informe o nome do álbum.');
    const token = await spotifyCatalogToken(env);
    if (!token) return fail(request, 'A busca no Spotify não está disponível.', 503);
    const result = await spotifyCatalogGet(token, `search?${new URLSearchParams({ q: query, type: 'album', limit: '10', market: 'BR' })}`);
    if (!result) return fail(request, 'A busca no Spotify está temporariamente indisponível.', 502);
    return json(request, { albums: (result.albums?.items || []).filter(Boolean).map(item => ({ id: item.id, title: item.name, artist: (item.artists || []).map(artist => artist.name).join(', '), year: (item.release_date || '').slice(0, 4), coverUrl: item.images?.find(image => image.width >= 300)?.url || item.images?.[0]?.url || '', sourceUrl: item.external_urls?.spotify || '' })) });
  }
  const spotifyAlbumMatch = path.match(/^\/api\/spotify\/albums\/([A-Za-z0-9]+)$/);
  if (spotifyAlbumMatch && request.method === 'GET') {
    if (!user) return fail(request, 'Entre na sua conta para consultar álbuns.', 401);
    const token = await spotifyCatalogToken(env);
    if (!token) return fail(request, 'A busca no Spotify não está disponível.', 503);
    const album = await spotifyCatalogGet(token, `albums/${spotifyAlbumMatch[1]}?market=BR`);
    if (!album) return fail(request, 'Não foi possível consultar o álbum no Spotify.', 502);
    return json(request, { releaseDate: album.release_date || '', releaseDatePrecision: album.release_date_precision || '' });
  }
  const spotifyTracksMatch = path.match(/^\/api\/spotify\/albums\/([A-Za-z0-9]+)\/tracks$/);
  if (spotifyTracksMatch && request.method === 'GET') {
    if (!user) return fail(request, 'Entre na sua conta para ordenar álbuns.', 401);
    const token = await spotifyCatalogToken(env);
    if (!token) return fail(request, 'A busca no Spotify não está disponível.', 503);
    const tracks = [];
    for (let offset = 0; offset < 500; offset += 50) {
      const page = await spotifyCatalogGet(token, `albums/${spotifyTracksMatch[1]}/tracks?${new URLSearchParams({ limit: '50', offset: String(offset), market: 'BR' })}`);
      if (!page) return fail(request, 'Não foi possível ler a ordem das faixas no Spotify.', 502);
      const items = page.items || [];
      tracks.push(...items.filter(Boolean).map(item => ({ title: item.name, disc: item.disc_number || 1, position: item.track_number || 0, recordingId: '' })));
      if (items.length < 50 || tracks.length >= (page.total || 0)) break;
    }
    return json(request, { tracks, source: 'Spotify' });
  }
  if (path === '/api/library' && request.method === 'GET') return user ? cachedLibrary(request, env, ctx, user, serializeCatalog, responseHeaders) : fail(request, 'Entre na sua conta para acessar a biblioteca.', 401);
  if (path === '/api/covers/google' && request.method === 'GET') return googleImageSearch(request, env);
  if (path === '/api/tracks' && request.method === 'POST') return user ? uploadTrack(request, env, user) : fail(request, 'Entre na sua conta para adicionar músicas.', 401);
  const trackLyricsMatch = path.match(/^\/api\/tracks\/([^/]+)\/lyrics$/);
  if (trackLyricsMatch && request.method === 'PUT') {
    const payload = await request.json();
    if (typeof payload.lyrics !== 'string' || payload.lyrics.length > 20000) return fail(request, 'Letra inválida ou muito longa.');
    if (!user) return fail(request, 'Entre na sua conta para editar letras.', 401);
    const current = await env.DB.prepare('SELECT metadata_json FROM tracks WHERE id = ?').bind(trackLyricsMatch[1]).first();
    if (!current) return fail(request, 'Música não encontrada.', 404);
    const metadata = parseMetadata(current.metadata_json);
    metadata.lyrics = payload.lyrics;
    await env.DB.prepare('UPDATE tracks SET metadata_json = ? WHERE id = ?').bind(JSON.stringify(metadata), trackLyricsMatch[1]).run();
    return json(request, { ok: true });
  }
  const trackCoverMatch = path.match(/^\/api\/tracks\/([^/]+)\/cover$/);
  if (trackCoverMatch && request.method === 'PUT') {
    const payload = await request.json();
    const coverUrl = await approvedImageUrl(env,payload.coverUrl,payload.coverProof);
    if (!coverUrl) return fail(request, 'URL de capa inválida.');
    if (!user) return fail(request, 'Entre na sua conta para editar capas.', 401);
    const current = await env.DB.prepare('SELECT metadata_json FROM tracks WHERE id = ?').bind(trackCoverMatch[1]).first();
    if (!current) return fail(request, 'Música não encontrada.', 404);
    const metadata = parseMetadata(current.metadata_json);
    metadata.coverUrl = coverUrl;
    metadata.coverMode = 'individual';
    metadata.googleCoverProof = payload.coverProof || '';
    await env.DB.prepare('UPDATE tracks SET metadata_json = ? WHERE id = ?').bind(JSON.stringify(metadata), trackCoverMatch[1]).run();
    return json(request, { ok: true, coverUrl });
  }
  if (path === '/api/playlists' && request.method === 'POST') return user ? createPlaylist(request, env, user) : fail(request, 'Entre na sua conta para criar playlists.', 401);
  if (path === '/api/albums' && request.method === 'POST') return user ? createAlbum(request, env, user) : fail(request, 'Entre na sua conta para criar álbuns.', 401);
  const albumMatch=path.match(/^\/api\/albums\/([^/]+)$/);
  if(albumMatch&&request.method==='PUT') return user ? updateAlbum(request,env,albumMatch[1]) : fail(request, 'Entre na sua conta para editar álbuns.', 401);
  if(albumMatch&&request.method==='DELETE') { if(!user)return fail(request,'Entre na sua conta para excluir álbuns.',401); await env.DB.prepare('DELETE FROM albums WHERE id=?').bind(albumMatch[1]).run(); return json(request,{ok:true}); }
  const albumTracksMatch=path.match(/^\/api\/albums\/([^/]+)\/tracks$/);
  if (albumTracksMatch && request.method === 'POST') {
    if (!user) return fail(request, 'Entre na sua conta para alterar álbuns.', 401);
    const albumId = albumTracksMatch[1];
    if (!await env.DB.prepare('SELECT id FROM albums WHERE id=?').bind(albumId).first()) return fail(request, 'Álbum não encontrado.', 404);
    const payload = await request.json();
    const trackIds = Array.isArray(payload.trackIds) ? [...new Set(payload.trackIds.map(String))].slice(0, 500) : [];
    const found = [];
    for (let i = 0; i < trackIds.length; i += 80) { const ids = trackIds.slice(i, i + 80); found.push(...(await env.DB.prepare(`SELECT id FROM tracks WHERE import_batch_id IS NULL AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results); }
    if (found.length !== trackIds.length) return fail(request, 'Uma música não está mais na biblioteca. Atualize a página.', 409);
    const statements = [env.DB.prepare('DELETE FROM album_tracks WHERE album_id=?').bind(albumId), env.DB.prepare('UPDATE tracks SET primary_album_id=NULL WHERE primary_album_id=?').bind(albumId)];
    for (let i = 0; i < trackIds.length; i += 30) { const ids = trackIds.slice(i, i + 30); statements.push(env.DB.prepare(`INSERT INTO album_tracks (album_id,track_id,position) VALUES ${ids.map(() => '(?,?,?)').join(',')}`).bind(...ids.flatMap((id, index) => [albumId, id, i + index]))); }
    for (let i = 0; i < trackIds.length; i += 80) { const ids = trackIds.slice(i, i + 80); statements.push(env.DB.prepare(`UPDATE tracks SET primary_album_id=? WHERE primary_album_id IS NULL AND id IN (${ids.map(() => '?').join(',')})`).bind(albumId, ...ids)); }
    await env.DB.batch(statements);
    return json(request, { ok: true, trackIds });
  }
  const playlistMatch = path.match(/^\/api\/playlists\/([^/]+)$/);
  if (playlistMatch && request.method === 'DELETE') {
    if (!user) return fail(request, 'Entre na sua conta para excluir playlists.', 401);
    await env.DB.prepare('DELETE FROM playlists WHERE id = ?').bind(playlistMatch[1]).run();
    return json(request, { ok: true });
  }
  const playlistTrackMatch = path.match(/^\/api\/playlists\/([^/]+)\/tracks$/);
  if (playlistTrackMatch && request.method === 'POST') {
    if (!user) return fail(request, 'Entre na sua conta para editar playlists.', 401);
    const payload = await request.json();
    const trackIds = Array.isArray(payload.trackIds) ? [...new Set(payload.trackIds.map(String))].slice(0, 500) : [String(payload.trackId || '')];
    const statements = trackIds.filter(Boolean).map((id, position) => env.DB.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) SELECT ?, id, (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?) + ? FROM tracks WHERE id = ?').bind(playlistTrackMatch[1], playlistTrackMatch[1], position, id));
    if (statements.length) await env.DB.batch(statements);
    return json(request, { ok: true });
  }
  const favoriteMatch = path.match(/^\/api\/tracks\/([^/]+)\/favorite$/);
  if (favoriteMatch && request.method === 'POST') {
    if (!user) return fail(request, 'Entre na sua conta para salvar favoritos.', 401);
    const payload = await request.json();
    if (payload.favorite) await env.DB.prepare('INSERT OR IGNORE INTO user_favorites (user_id,track_id) SELECT ?,id FROM tracks WHERE id=?').bind(user.id,favoriteMatch[1]).run();
    else await env.DB.prepare('DELETE FROM user_favorites WHERE user_id=? AND track_id=?').bind(user.id,favoriteMatch[1]).run();
    return json(request, { ok: true });
  }
  const historyMatch = path.match(/^\/api\/tracks\/([^/]+)\/history$/);
  if (historyMatch && request.method === 'POST') {
    if (!user) return fail(request, 'Entre na sua conta para salvar o histórico.', 401);
    await env.DB.prepare('INSERT INTO user_history (user_id,track_id) SELECT ?,id FROM tracks WHERE id=?').bind(user.id,historyMatch[1]).run();
    await env.DB.prepare('DELETE FROM user_history WHERE user_id=? AND (played_at,id) < (SELECT played_at,id FROM user_history WHERE user_id=? ORDER BY played_at DESC,id DESC LIMIT 1 OFFSET 199)').bind(user.id,user.id).run();
    return json(request, { ok: true }, 201);
  }
  const trackMatch = path.match(/^\/api\/tracks\/([^/]+)$/);
  if (trackMatch && request.method === 'PUT') {
    if (!user) return fail(request, 'Entre na sua conta para editar músicas.', 401);
    const current = await env.DB.prepare('SELECT * FROM tracks WHERE id=? AND import_batch_id IS NULL').bind(trackMatch[1]).first();
    if (!current) return fail(request, 'Música não encontrada.', 404);
    const body = await request.json(), title = String(body.title ?? current.title).trim().slice(0, 180), artist = String(body.artist ?? current.artist).trim().slice(0, 180);
    const albumId = body.albumId === undefined ? current.primary_album_id : body.albumId || null;
    const album = albumId ? await env.DB.prepare('SELECT id,title FROM albums WHERE id=?').bind(albumId).first() : null;
    if (!title || !artist || (albumId && !album)) return fail(request, 'Preencha nome, artista e um álbum válido.');
    const meta = parseMetadata(current.metadata_json);
    if (['album', 'individual'].includes(body.coverMode)) meta.coverMode = body.coverMode;
    const statements = [env.DB.prepare('UPDATE tracks SET title=?,artist=?,album=?,primary_album_id=?,metadata_json=? WHERE id=?').bind(title, artist, album?.title || current.album, album?.id || null, JSON.stringify(meta), current.id)];
    if (body.albumId !== undefined && (body.albumId || null) !== current.primary_album_id) {
      statements.push(env.DB.prepare('DELETE FROM album_tracks WHERE track_id=?').bind(current.id));
      if (album) statements.push(env.DB.prepare('INSERT INTO album_tracks (album_id,track_id,position) VALUES (?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM album_tracks WHERE album_id=?))').bind(album.id, current.id, album.id));
    }
    await env.DB.batch(statements);
    return json(request, { ok: true });
  }
  if (trackMatch && request.method === 'DELETE') {
    if (!user) return fail(request, 'Entre na sua conta para excluir músicas.', 401);
    const track = await env.DB.prepare('SELECT audio_key, cover_key, main_key FROM tracks WHERE id = ?').bind(trackMatch[1]).first();
    if (track) await Promise.all([track.audio_key, track.cover_key, track.main_key].filter(Boolean).map(key => env.MEDIA.delete(key)));
    await env.DB.prepare('DELETE FROM tracks WHERE id = ?').bind(trackMatch[1]).run();
    return json(request, { ok: true });
  }
  return fail(request, 'Rota não encontrada.', 404);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    if (origin && !allowedOrigins.has(origin)) return new Response('Origin not allowed', { status: 403 });
    try {
      return await route(request, env, ctx);
    } catch (error) {
      console.error(JSON.stringify({ event: 'api_error', message: error instanceof Error ? error.message : 'unknown' }));
      return fail(request, 'Não foi possível concluir a operação.', 500);
    }
  },
};
