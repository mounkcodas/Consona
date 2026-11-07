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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range, If-Range',
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

async function getLibrary(request, env, user) {
  const [trackRows, playlistRows, itemRows, favoriteRows, historyRows, albumRows, albumItemRows, userRows] = await Promise.all([
    env.DB.prepare('SELECT * FROM tracks ORDER BY created_at DESC').all(),
    env.DB.prepare('SELECT * FROM playlists ORDER BY created_at DESC').all(),
    env.DB.prepare('SELECT playlist_id, track_id FROM playlist_tracks ORDER BY position, rowid').all(),
    user ? env.DB.prepare('SELECT track_id FROM user_favorites WHERE user_id=?').bind(user.id).all() : Promise.resolve({ results: [] }),
    user ? env.DB.prepare('SELECT track_id FROM user_history WHERE user_id=? ORDER BY played_at DESC, id DESC LIMIT 200').bind(user.id).all() : Promise.resolve({ results: [] }),
    env.DB.prepare('SELECT * FROM albums ORDER BY created_at DESC').all(),
    env.DB.prepare('SELECT album_id, track_id FROM album_tracks ORDER BY position, rowid').all(),
    env.DB.prepare('SELECT id,display_name,avatar_key FROM users').all(),
  ]);
  const usersById = new Map(userRows.results.map(person => [person.id, { id: person.id, displayName: person.display_name, avatar: mediaUrl(request, person.avatar_key) }]));
  const itemsByPlaylist = new Map();
  for (const item of itemRows.results) {
    const entries = itemsByPlaylist.get(item.playlist_id) || [];
    entries.push(item.track_id);
    itemsByPlaylist.set(item.playlist_id, entries);
  }
  const itemsByAlbum = new Map();
  for (const item of albumItemRows.results) { const entries = itemsByAlbum.get(item.album_id) || []; entries.push(item.track_id); itemsByAlbum.set(item.album_id, entries); }
  return json(request, {
    tracks: trackRows.results.map(track => ({
      id: track.id, title: track.title, artist: track.artist, album: track.album,
      duration: formatTime(track.duration_seconds), seconds: track.duration_seconds,
      src: mediaUrl(request, track.audio_key),
      mainArt: mediaUrl(request, track.main_key) || parseMetadata(track.metadata_json).mainImageUrl || '',
      cover: parseMetadata(track.metadata_json).coverUrl || mediaUrl(request, track.cover_key) || '',
      metadata: parseMetadata(track.metadata_json),
      addedBy: usersById.get(track.added_by) || null,
    })),
    playlists: playlistRows.results.map(list => ({
      id: list.id, name: list.name, trackIds: itemsByPlaylist.get(list.id) || [], addedBy: usersById.get(list.added_by) || null,
      cover: mediaUrl(request, trackRows.results.find(track => track.id === (itemsByPlaylist.get(list.id) || [])[0])?.cover_key),
    })),
    albums: albumRows.results.map(album => {
      const trackIds=itemsByAlbum.get(album.id)||[];
      const firstTrack=trackRows.results.find(track=>track.id===trackIds[0]);
      const firstTrackMetadata=parseMetadata(firstTrack?.metadata_json);
      return { id:album.id, title:album.title, artist:album.artist, trackIds, addedBy: usersById.get(album.added_by) || null,
        cover:mediaUrl(request,album.cover_key)||album.cover_url||firstTrackMetadata.coverUrl||mediaUrl(request,firstTrack?.cover_key)||'',
        coverProof:parseMetadata(album.metadata_json).googleCoverProof||firstTrackMetadata.googleCoverProof||'',
        metadata:parseMetadata(album.metadata_json) };
    }),
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

const bytesToHex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
function randomHex(size) { const bytes = crypto.getRandomValues(new Uint8Array(size)); return [...bytes].map(value => value.toString(16).padStart(2, '0')).join(''); }
async function digestHex(value) { return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
async function passwordDigest(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/.{2}/g) || [], part => parseInt(part, 16));
  return bytesToHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256));
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
    const valid = crypto.subtle.timingSafeEqual(Uint8Array.from(expected.match(/.{2}/g), part => parseInt(part, 16)), Uint8Array.from(actual.match(/.{2}/g), part => parseInt(part, 16)));
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

async function uploadTrack(request, env, user) {
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
    await env.DB.prepare('INSERT INTO tracks (id, title, artist, album, duration_seconds, audio_key, cover_key, main_key, metadata_json, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, title, artist, album, duration, audioKey, coverKey, mainKey, JSON.stringify(metadata), user.id).run();
  } catch (error) {
    await Promise.all([audioKey, coverKey, mainKey].filter(Boolean).map(key => env.MEDIA.delete(key)));
    throw error;
  }
  return json(request, { id }, 201);
}

function safeRemoteImage(value) {
  try {
    const url = new URL(String(value || ''));
    const allowedHost = ['upload.wikimedia.org', 'coverartarchive.org', 'lastfm.freetls.fastly.net', 'lastfm-img2.akamaized.net'].includes(url.hostname) || /^encrypted-tbn\d+\.gstatic\.com$/.test(url.hostname);
    return url.protocol === 'https:' && allowedHost ? url.href.slice(0, 2000) : '';
  } catch { return ''; }
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
  return crypto.subtle.timingSafeEqual(expectedHash,providedHash)?candidate:'';
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
  if (!/^(tracks|artists|users)\/[a-f0-9-]{36}\/[a-z0-9._-]+$/i.test(key)) return new Response('Not found', { status: 404 });
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
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata) ? JSON.stringify(payload.metadata).slice(0,12000) : current.metadata_json;
  if (!title) return fail(request, 'Informe o nome do álbum.');
  await env.DB.prepare('UPDATE albums SET title=?,artist=?,cover_url=?,metadata_json=? WHERE id=?').bind(title,artist,coverUrl,metadata,id).run();
  return json(request,{ok:true});
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(request, { 'Access-Control-Max-Age': '86400' }) });
  const authResponse = await authRoutes(request, env, path);
  if (authResponse) return authResponse;
  const user = await getUser(request, env);
  if (path === '/api/profile' && request.method === 'PUT') return user ? updateProfile(request, env, user) : fail(request, 'Entre na sua conta.', 401);
  if (path === '/api/lastfm' && request.method === 'GET') {
    const apiKey = env.LASTFM_API_SECRET;
    if (!apiKey) return fail(request, 'A busca Last.fm não está disponível.', 503);
    const method = url.searchParams.get('method') || '';
    const allowedMethods = new Set(['track.getInfo', 'artist.getInfo', 'album.getInfo', 'track.getSimilar']);
    if (!allowedMethods.has(method)) return fail(request, 'Método Last.fm não permitido.');
    const params = new URLSearchParams({ method, api_key: apiKey, format: 'json' });
    for (const key of ['artist', 'track', 'album', 'limit']) { const value = (url.searchParams.get(key) || '').slice(0, 180); if (value) params.set(key, value); }
    params.set('autocorrect', '1');
    const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) return fail(request, 'Last.fm não encontrou esses dados.', response.status >= 400 && response.status < 600 ? response.status : 502);
    return json(request, payload);
  }
  if (path === '/api/health' && request.method === 'GET') return json(request, { ok: true });
  if (path === '/api/library' && request.method === 'GET') return getLibrary(request, env, user);
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
    metadata.googleCoverProof = payload.coverProof || '';
    await env.DB.prepare('UPDATE tracks SET metadata_json = ? WHERE id = ?').bind(JSON.stringify(metadata), trackCoverMatch[1]).run();
    return json(request, { ok: true, coverUrl });
  }
  const mediaMatch = path.match(/^\/api\/media\/(.+)$/);
  if (mediaMatch && request.method === 'GET') return mediaResponse(request, env, decodeURIComponent(mediaMatch[1]));
  if (path === '/api/playlists' && request.method === 'POST') return user ? createPlaylist(request, env, user) : fail(request, 'Entre na sua conta para criar playlists.', 401);
  if (path === '/api/albums' && request.method === 'POST') return user ? createAlbum(request, env, user) : fail(request, 'Entre na sua conta para criar álbuns.', 401);
  const albumMatch=path.match(/^\/api\/albums\/([^/]+)$/);
  if(albumMatch&&request.method==='PUT') return user ? updateAlbum(request,env,albumMatch[1]) : fail(request, 'Entre na sua conta para editar álbuns.', 401);
  if(albumMatch&&request.method==='DELETE') { if(!user)return fail(request,'Entre na sua conta para excluir álbuns.',401); await env.DB.prepare('DELETE FROM album_tracks WHERE album_id=?').bind(albumMatch[1]).run(); await env.DB.prepare('DELETE FROM albums WHERE id=?').bind(albumMatch[1]).run(); return json(request,{ok:true}); }
  const albumTracksMatch=path.match(/^\/api\/albums\/([^/]+)\/tracks$/);
  if(albumTracksMatch&&request.method==='POST') { if(!user)return fail(request,'Entre na sua conta para alterar álbuns.',401); const payload=await request.json(); const trackIds=Array.isArray(payload.trackIds)?[...new Set(payload.trackIds.map(String))].slice(0,500):[]; await env.DB.prepare('DELETE FROM album_tracks WHERE album_id=?').bind(albumTracksMatch[1]).run(); const statements=trackIds.map((id,position)=>env.DB.prepare('INSERT OR IGNORE INTO album_tracks (album_id,track_id,position) SELECT ?,id,? FROM tracks WHERE id=?').bind(albumTracksMatch[1],position,id)); if(statements.length) await env.DB.batch(statements); return json(request,{ok:true,trackIds}); }
  const playlistMatch = path.match(/^\/api\/playlists\/([^/]+)$/);
  if (playlistMatch && request.method === 'DELETE') {
    if (!user) return fail(request, 'Entre na sua conta para excluir playlists.', 401);
    await env.DB.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').bind(playlistMatch[1]).run();
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
    await env.DB.prepare('DELETE FROM user_history WHERE user_id=? AND id NOT IN (SELECT id FROM user_history WHERE user_id=? ORDER BY played_at DESC,id DESC LIMIT 200)').bind(user.id,user.id).run();
    return json(request, { ok: true }, 201);
  }
  const trackMatch = path.match(/^\/api\/tracks\/([^/]+)$/);
  if (trackMatch && request.method === 'DELETE') {
    if (!user) return fail(request, 'Entre na sua conta para excluir músicas.', 401);
    const track = await env.DB.prepare('SELECT audio_key, cover_key, main_key FROM tracks WHERE id = ?').bind(trackMatch[1]).first();
    if (track) await Promise.all([track.audio_key, track.cover_key, track.main_key].filter(Boolean).map(key => env.MEDIA.delete(key)));
    await env.DB.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').bind(trackMatch[1]).run();
    await env.DB.prepare('DELETE FROM favorites WHERE track_id = ?').bind(trackMatch[1]).run();
    await env.DB.prepare('DELETE FROM history WHERE track_id = ?').bind(trackMatch[1]).run();
    await env.DB.prepare('DELETE FROM user_history WHERE track_id = ?').bind(trackMatch[1]).run();
    await env.DB.prepare('DELETE FROM user_favorites WHERE track_id = ?').bind(trackMatch[1]).run();
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
