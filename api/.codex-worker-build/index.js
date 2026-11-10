var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/import-workspace.js
var uuid = /* @__PURE__ */ __name((value) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(value || "")), "uuid");
var chunks = /* @__PURE__ */ __name((values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size)), "chunks");
var metadata = /* @__PURE__ */ __name((value) => {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}, "metadata");
async function readTracks(env, ids) {
  const rows = [];
  for (const group of chunks(ids, 80)) rows.push(...(await env.DB.prepare(`SELECT * FROM tracks WHERE id IN (${group.map(() => "?").join(",")})`).bind(...group).all()).results);
  return rows;
}
__name(readTracks, "readTracks");
async function importRoutes(request, env, user, helpers) {
  const { json: json2, fail: fail2, approvedImageUrl: approvedImageUrl2, mediaUrl: mediaUrl2, ctx } = helpers;
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/import/")) return null;
  if (!user) return fail2(request, "Entre na sua conta para organizar a biblioteca.", 401);
  if (path === "/api/import/covers" && request.method === "POST") {
    if (Number(request.headers.get("Content-Length")) > 6 * 1024 * 1024) return fail2(request, "A capa deve ter at\xE9 5 MB.", 413);
    const form = await request.formData(), batchId = String(form.get("batchId") || ""), itemKey = String(form.get("itemKey") || ""), cover = form.get("cover");
    if (!uuid(batchId) || !itemKey || itemKey.length > 250) return fail2(request, "Rascunho inv\xE1lido.");
    const prior = await env.DB.prepare("SELECT id FROM import_assets WHERE user_id=? AND batch_id=? AND item_key=?").bind(user.id, batchId, itemKey).first();
    if (prior) return json2(request, { id: prior.id });
    if (!(cover instanceof File) || !cover.size || cover.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(cover.type)) return fail2(request, "Escolha uma capa JPG, PNG, WebP ou AVIF de at\xE9 5 MB.");
    const id = crypto.randomUUID(), key = `albums/${id}/cover.${cover.type.split("/")[1]}`;
    await env.MEDIA.put(key, cover.stream(), { httpMetadata: { contentType: cover.type, cacheControl: "public, max-age=31536000, immutable" } });
    try {
      await env.DB.prepare("INSERT INTO import_assets (id,batch_id,user_id,item_key,media_key) VALUES (?,?,?,?,?)").bind(id, batchId, user.id, itemKey, key).run();
    } catch (error) {
      await env.MEDIA.delete(key);
      const retry = await env.DB.prepare("SELECT id FROM import_assets WHERE user_id=? AND batch_id=? AND item_key=?").bind(user.id, batchId, itemKey).first();
      if (retry) return json2(request, { id: retry.id });
      throw error;
    }
    return json2(request, { id }, 201);
  }
  if (path === "/api/import/commit" && request.method === "POST") {
    if (Number(request.headers.get("Content-Length")) > 1024 * 1024) return fail2(request, "Este rascunho excede o limite de dados.", 413);
    const payload = await request.json(), batchId = String(payload.batchId || "");
    if (!uuid(batchId) || !Array.isArray(payload.albums) || !Array.isArray(payload.tracks) || !Array.isArray(payload.playlists || []) || !payload.albums.length && !(payload.playlists || []).length || payload.albums.length > 100 || (payload.playlists || []).length > 100 || payload.tracks.length > 500) return fail2(request, "Revise a quantidade de m\xFAsicas, \xE1lbuns e playlists do rascunho.");
    const committed = await env.DB.prepare("SELECT user_id,result_json FROM import_batches WHERE id=?").bind(batchId).first();
    if (committed) return committed.user_id === user.id ? json2(request, metadata(committed.result_json)) : fail2(request, "Este rascunho pertence a outra conta.", 403);
    const albumKeys = /* @__PURE__ */ new Set(), trackIds = /* @__PURE__ */ new Set(), existingIds = /* @__PURE__ */ new Set(), playlistKeys = /* @__PURE__ */ new Set(), existingPlaylistIds = /* @__PURE__ */ new Set();
    const albums = payload.albums.map((item) => ({ ...item, title: String(item.title || "").trim().slice(0, 180), artist: String(item.artist || "").trim().slice(0, 180) }));
    const playlists = (payload.playlists || []).map((item) => ({ ...item, name: String(item.name || "").trim().slice(0, 100) }));
    const tracks = payload.tracks.map((item) => ({ ...item, title: String(item.title || "").trim().slice(0, 180), artist: String(item.artist || "").trim().slice(0, 180) }));
    for (const album of albums) {
      if (!uuid(album.key) || albumKeys.has(album.key) || !album.title || album.existingId && !uuid(album.existingId)) return fail2(request, "Um dos \xE1lbuns est\xE1 incompleto ou repetido.");
      if (album.existingId && existingIds.has(album.existingId)) return fail2(request, "O mesmo \xE1lbum aparece duas vezes no rascunho.");
      if (album.existingId) existingIds.add(album.existingId);
      albumKeys.add(album.key);
    }
    for (const playlist of playlists) {
      if (!uuid(playlist.key) || playlistKeys.has(playlist.key) || !playlist.name || !Array.isArray(playlist.trackIds) || playlist.trackIds.length > 500 || new Set(playlist.trackIds).size !== playlist.trackIds.length || playlist.existingId && !uuid(playlist.existingId)) return fail2(request, "Uma playlist est\xE1 incompleta ou repetida.");
      if (playlist.existingId && existingPlaylistIds.has(playlist.existingId)) return fail2(request, "A mesma playlist aparece duas vezes no rascunho.");
      playlistKeys.add(playlist.key);
      if (playlist.existingId) existingPlaylistIds.add(playlist.existingId);
    }
    for (const track of tracks) {
      if (!uuid(track.id) || trackIds.has(track.id) || !track.title || !track.artist || track.albumKey && !albumKeys.has(track.albumKey) || !track.albumKey && !playlists.some((list) => list.trackIds.includes(track.id)) || !["album", "individual"].includes(track.coverMode)) return fail2(request, "Uma das m\xFAsicas est\xE1 incompleta, repetida ou sem \xE1lbum ou playlist.");
      if (track.identification && (typeof track.identification !== "object" || Array.isArray(track.identification) || JSON.stringify(track.identification).length > 16e3)) return fail2(request, "Os dados de identifica\xE7\xE3o de uma m\xFAsica s\xE3o inv\xE1lidos.");
      trackIds.add(track.id);
    }
    if (playlists.some((playlist) => playlist.trackIds.some((id) => !trackIds.has(id)))) return fail2(request, "Uma playlist cont\xE9m m\xFAsica fora do rascunho.");
    const storedTracks = await readTracks(env, [...trackIds]);
    if (storedTracks.length !== tracks.length) return fail2(request, "Uma m\xFAsica foi removida da biblioteca. Atualize o rascunho.", 409);
    if (storedTracks.some((row) => row.import_batch_id && (row.import_batch_id !== batchId || row.added_by !== user.id))) return fail2(request, "Uma m\xFAsica pertence a outro rascunho.", 403);
    const existingAlbums = [], memberships = [];
    for (const ids of chunks([...existingIds], 80)) {
      const placeholders = ids.map(() => "?").join(",");
      const [albumRows, membershipRows] = await env.DB.batch([
        env.DB.prepare(`SELECT * FROM albums WHERE id IN (${placeholders})`).bind(...ids),
        env.DB.prepare(`SELECT album_id,track_id,position FROM album_tracks WHERE album_id IN (${placeholders}) ORDER BY position,rowid`).bind(...ids)
      ]);
      existingAlbums.push(...albumRows.results);
      memberships.push(...membershipRows.results);
    }
    const existingPlaylists = [], playlistMemberships = [];
    for (const ids of chunks([...existingPlaylistIds], 80)) {
      const placeholders = ids.map(() => "?").join(",");
      const [playlistRows, membershipRows] = await env.DB.batch([
        env.DB.prepare(`SELECT id,name,cover_key FROM playlists WHERE id IN (${placeholders})`).bind(...ids),
        env.DB.prepare(`SELECT playlist_id,track_id FROM playlist_tracks WHERE playlist_id IN (${placeholders}) ORDER BY position,rowid`).bind(...ids)
      ]);
      existingPlaylists.push(...playlistRows.results);
      playlistMemberships.push(...membershipRows.results);
    }
    const assets = (await env.DB.prepare("SELECT * FROM import_assets WHERE user_id=? AND batch_id=?").bind(user.id, batchId).all()).results;
    if (tracks.some((track) => track.coverAssetId && !assets.some((asset) => asset.id === track.coverAssetId))) return fail2(request, "Selecione novamente uma das capas individuais.", 409);
    const pendingTracks = (await env.DB.prepare("SELECT id,audio_key,cover_key,main_key FROM tracks WHERE import_batch_id=? AND added_by=?").bind(batchId, user.id).all()).results;
    const statements = [], albumIds = /* @__PURE__ */ new Map(), playlistIds = /* @__PURE__ */ new Map();
    for (const album of albums) {
      const stored = album.existingId ? existingAlbums.find((item) => item.id === album.existingId) : null;
      if (album.existingId && !stored) return fail2(request, `O \xE1lbum \u201C${album.title}\u201D foi removido. Escolha outro destino.`, 409);
      if (stored && (album.initialTitle !== void 0 && album.initialTitle !== stored.title || album.initialArtist !== void 0 && album.initialArtist !== stored.artist)) return fail2(request, `O \xE1lbum \u201C${stored.title}\u201D mudou desde a abertura deste rascunho. Remova o cart\xE3o e adicione-o novamente.`, 409);
      if (stored && (stored.cover_key || stored.cover_url) && album.initialCover !== void 0 && album.initialCover !== (mediaUrl2(request, stored.cover_key) || stored.cover_url)) return fail2(request, `A capa de \u201C${stored.title}\u201D foi alterada. Adicione esse \xE1lbum novamente ao rascunho.`, 409);
      const id = stored?.id || crypto.randomUUID();
      albumIds.set(album.key, id);
      const asset = album.coverAssetId ? assets.find((item) => item.id === album.coverAssetId) : null;
      if (album.coverAssetId && !asset) return fail2(request, `Selecione novamente a capa de \u201C${album.title}\u201D.`, 409);
      let coverKey = stored?.cover_key || null, coverUrl = stored?.cover_url || "";
      const unchangedCover = stored && album.coverUrl === album.initialCover;
      if (asset) {
        coverKey = asset.media_key;
        coverUrl = "";
      } else if (!unchangedCover) {
        coverUrl = album.coverUrl ? await approvedImageUrl2(env, album.coverUrl, "") : "";
        if (album.coverUrl && !coverUrl) return fail2(request, `A capa de \u201C${album.title}\u201D n\xE3o p\xF4de ser validada. Escolha uma imagem do seu dispositivo.`);
        coverKey = null;
      }
      const meta = { ...metadata(stored?.metadata_json), releaseGroupId: album.releaseGroupId ? String(album.releaseGroupId).slice(0, 60) : "", spotifyId: album.spotifyId ? String(album.spotifyId).slice(0, 40) : "", releaseYear: album.releaseYear && /^\d{4}$/.test(String(album.releaseYear)) ? String(album.releaseYear) : "", releaseYearSource: album.releaseYearSource === "Spotify" ? "Spotify" : "MusicBrainz", sourceUrl: album.sourceUrl && /^https:\/\/open\.spotify\.com\/album\/[A-Za-z0-9]+/.test(album.sourceUrl) ? String(album.sourceUrl).slice(0, 200) : "" };
      if (stored) statements.push(env.DB.prepare("UPDATE albums SET title=?,artist=?,cover_key=?,cover_url=?,metadata_json=? WHERE id=?").bind(album.title, album.artist, coverKey, coverUrl, JSON.stringify(meta), id));
      else statements.push(env.DB.prepare("INSERT INTO albums (id,title,artist,cover_key,cover_url,metadata_json,added_by) VALUES (?,?,?,?,?,?,?)").bind(id, album.title, album.artist, coverKey, coverUrl, JSON.stringify(meta), user.id));
    }
    const albumTracks = tracks.filter((track) => track.albumKey);
    for (const group of chunks(albumTracks, 14)) {
      const values = group.flatMap((row) => [row.id, row.title, row.artist, albumIds.get(row.albumKey), albums.find((album) => album.key === row.albumKey).title, JSON.stringify({ ...metadata(storedTracks.find((track) => track.id === row.id)?.metadata_json), ...row.identification ? { identification: row.identification } : {}, coverMode: row.coverMode })]);
      statements.push(env.DB.prepare(`WITH incoming(id,title,artist,album_id,album_title,meta_json) AS (VALUES ${group.map(() => "(?,?,?,?,?,?)").join(",")}) UPDATE tracks SET title=(SELECT title FROM incoming WHERE incoming.id=tracks.id),artist=(SELECT artist FROM incoming WHERE incoming.id=tracks.id),album=(SELECT album_title FROM incoming WHERE incoming.id=tracks.id),primary_album_id=(SELECT album_id FROM incoming WHERE incoming.id=tracks.id),metadata_json=(SELECT meta_json FROM incoming WHERE incoming.id=tracks.id),import_batch_id=NULL,import_item_key=NULL WHERE id IN (SELECT id FROM incoming)`).bind(...values));
    }
    const playlistOnlyEdits = tracks.filter((track) => !track.albumKey).map((track) => {
      const stored = storedTracks.find((row) => row.id === track.id);
      const oldMeta = metadata(stored.metadata_json);
      const nextMeta = { ...oldMeta, ...track.identification ? { identification: track.identification } : {}, ...track.coverAssetId ? { coverMode: "individual" } : {} };
      return { ...track, meta: JSON.stringify(nextMeta), changed: !!stored.import_batch_id || stored.title !== track.title || stored.artist !== track.artist || JSON.stringify(oldMeta) !== JSON.stringify(nextMeta) };
    }).filter((track) => track.changed);
    for (const group of chunks(playlistOnlyEdits, 20)) {
      const values = group.flatMap((track) => [track.id, track.title, track.artist, track.meta]);
      statements.push(env.DB.prepare(`WITH incoming(id,title,artist,meta_json) AS (VALUES ${group.map(() => "(?,?,?,?)").join(",")}) UPDATE tracks SET title=(SELECT title FROM incoming WHERE incoming.id=tracks.id),artist=(SELECT artist FROM incoming WHERE incoming.id=tracks.id),metadata_json=(SELECT meta_json FROM incoming WHERE incoming.id=tracks.id),import_batch_id=NULL,import_item_key=NULL WHERE id IN (SELECT id FROM incoming)`).bind(...values));
    }
    for (const ids of chunks(albumTracks.map((track) => track.id), 80)) statements.push(env.DB.prepare(`DELETE FROM album_tracks WHERE track_id IN (${ids.map(() => "?").join(",")})`).bind(...ids));
    for (const track of tracks.filter((track2) => track2.coverAssetId)) {
      const asset = assets.find((asset2) => asset2.id === track.coverAssetId);
      statements.push(env.DB.prepare("UPDATE tracks SET cover_key=?,metadata_json=json_remove(metadata_json,'$.coverUrl','$.googleCoverProof') WHERE id=?").bind(asset.media_key, track.id));
    }
    const links = [];
    for (const album of albums) {
      const id = albumIds.get(album.key);
      const preserved = memberships.filter((row) => row.album_id === id && !trackIds.has(row.track_id));
      const next = tracks.filter((row) => row.albumKey === album.key);
      const start = preserved.length ? Math.max(...preserved.map((row) => row.position)) + 1 : 0;
      next.forEach((row, position) => links.push([id, row.id, start + position]));
    }
    for (const group of chunks(links, 30)) statements.push(env.DB.prepare(`INSERT INTO album_tracks (album_id,track_id,position) VALUES ${group.map(() => "(?,?,?)").join(",")}`).bind(...group.flat()));
    for (const playlist of playlists) {
      const stored = playlist.existingId ? existingPlaylists.find((item) => item.id === playlist.existingId) : null;
      if (playlist.existingId && !stored) return fail2(request, `A playlist \u201C${playlist.name}\u201D foi removida. Adicione-a novamente.`, 409);
      if (stored) {
        const access = await env.DB.prepare(`SELECT c.owner_id,EXISTS(SELECT 1 FROM social_playlist_collaborators m WHERE m.playlist_id=c.playlist_id AND m.user_id=? AND EXISTS(SELECT 1 FROM friendships f WHERE f.user_id=c.owner_id AND f.friend_id=m.user_id) AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=c.owner_id AND b.blocked_id=m.user_id) OR (b.user_id=m.user_id AND b.blocked_id=c.owner_id))) AS can_edit FROM social_collaborative_playlists c WHERE c.playlist_id=?`).bind(user.id, stored.id).first();
        if (access && access.owner_id !== user.id && !access.can_edit) return fail2(request, "Voc\xEA n\xE3o \xE9 colaborador desta playlist.", 403);
      }
      const originalIds = playlistMemberships.filter((item) => item.playlist_id === stored?.id).map((item) => item.track_id);
      if (stored && (stored.name !== playlist.initialName || JSON.stringify(originalIds) !== JSON.stringify(playlist.initialTrackIds || []))) return fail2(request, `A playlist \u201C${stored.name}\u201D mudou desde a abertura do rascunho. Adicione-a novamente.`, 409);
      if (stored && playlist.initialCustomCover !== void 0 && playlist.initialCustomCover !== (mediaUrl2(request, stored.cover_key) || "")) return fail2(request, `A capa de \u201C${stored.name}\u201D mudou desde a abertura do rascunho. Adicione a playlist novamente.`, 409);
      const id = stored?.id || crypto.randomUUID();
      playlistIds.set(playlist.key, id);
      const cover = playlist.coverAssetId ? assets.find((asset) => asset.id === playlist.coverAssetId) : null;
      if (playlist.coverAssetId && !cover) return fail2(request, `Selecione novamente a capa de \u201C${playlist.name}\u201D.`, 409);
      const coverKey = cover?.media_key || stored?.cover_key || null;
      if (stored) statements.push(env.DB.prepare("UPDATE playlists SET name=?,cover_key=? WHERE id=?").bind(playlist.name, coverKey, id));
      else statements.push(env.DB.prepare("INSERT INTO playlists (id,name,added_by,cover_key) VALUES (?,?,?,?)").bind(id, playlist.name, user.id, coverKey));
      if (stored) statements.push(env.DB.prepare("DELETE FROM playlist_tracks WHERE playlist_id=?").bind(id));
      for (const group of chunks(playlist.trackIds.map((trackId, position) => [id, trackId, position]), 30)) {
        statements.push(env.DB.prepare(`INSERT INTO playlist_tracks (playlist_id,track_id,position) VALUES ${group.map(() => "(?,?,?)").join(",")}`).bind(...group.flat()));
      }
    }
    const result = { ok: true, tracks: tracks.length, albums: albums.length, playlists: playlists.length, albumIds: Object.fromEntries(albumIds), playlistIds: Object.fromEntries(playlistIds) };
    statements.push(env.DB.prepare("DELETE FROM tracks WHERE import_batch_id=? AND added_by=?").bind(batchId, user.id));
    statements.push(env.DB.prepare("DELETE FROM import_assets WHERE user_id=? AND batch_id=?").bind(user.id, batchId));
    statements.push(env.DB.prepare("INSERT INTO import_batches (id,user_id,result_json) VALUES (?,?,?)").bind(batchId, user.id, JSON.stringify(result)));
    await env.DB.batch(statements);
    const usedCovers = new Set([...albums.map((album) => album.coverAssetId), ...playlists.map((playlist) => playlist.coverAssetId), ...tracks.map((track) => track.coverAssetId)].filter(Boolean));
    const unusedMedia = [...pendingTracks.filter((row) => !trackIds.has(row.id)).flatMap((row) => [row.audio_key, row.cover_key, row.main_key]), ...assets.filter((asset) => !usedCovers.has(asset.id)).map((asset) => asset.media_key)].filter(Boolean);
    if (unusedMedia.length) ctx.waitUntil((async () => {
      for (const group of chunks(unusedMedia, 100)) await env.MEDIA.delete(group);
    })().catch((error) => console.error(JSON.stringify({ event: "import_cleanup_failed", message: String(error) }))));
    return json2(request, result);
  }
  const discard = path.match(/^\/api\/import\/batches\/([a-f0-9-]{36})$/i);
  if (discard && request.method === "DELETE") {
    const batchId = discard[1];
    const tracks = (await env.DB.prepare("SELECT audio_key,cover_key,main_key FROM tracks WHERE import_batch_id=? AND added_by=?").bind(batchId, user.id).all()).results;
    const assets = (await env.DB.prepare("SELECT media_key FROM import_assets WHERE batch_id=? AND user_id=?").bind(batchId, user.id).all()).results;
    await env.DB.batch([env.DB.prepare("DELETE FROM tracks WHERE import_batch_id=? AND added_by=?").bind(batchId, user.id), env.DB.prepare("DELETE FROM import_assets WHERE batch_id=? AND user_id=?").bind(batchId, user.id)]);
    const keys = [...tracks.flatMap((row) => [row.audio_key, row.cover_key, row.main_key]), ...assets.map((row) => row.media_key)].filter(Boolean);
    for (const group of chunks(keys, 100)) await env.MEDIA.delete(group);
    return json2(request, { ok: true });
  }
  return null;
}
__name(importRoutes, "importRoutes");

// src/library-cache.js
var VERSION = "v1";
var TTL = 86400;
var revisionSql = "SELECT revision FROM library_revision WHERE id=1";
var personalSql = "SELECT revision FROM user_library_revision WHERE user_id=?";
var catalogQueries = [
  revisionSql,
  "SELECT * FROM tracks WHERE import_batch_id IS NULL ORDER BY created_at DESC",
  "SELECT * FROM playlists ORDER BY created_at DESC",
  "SELECT playlist_id, track_id FROM playlist_tracks ORDER BY position, rowid",
  "SELECT * FROM albums ORDER BY created_at DESC",
  "SELECT album_id, track_id FROM album_tracks ORDER BY position, rowid",
  "SELECT id,display_name,avatar_key FROM users"
];
function cacheKey(request, scope, revision) {
  return new Request(`${new URL(request.url).origin}/__cache/library/${VERSION}/${scope}/${revision}`);
}
__name(cacheKey, "cacheKey");
function cacheError(error) {
  console.error(JSON.stringify({ event: "library_cache_error", message: String(error) }));
}
__name(cacheError, "cacheError");
async function cached(key) {
  try {
    return await caches.default.match(key);
  } catch (error) {
    cacheError(error);
  }
}
__name(cached, "cached");
function remember(ctx, key, response) {
  ctx.waitUntil(caches.default.put(key, response.clone()).catch(cacheError));
}
__name(remember, "remember");
function storedResponse(body2, revision) {
  return new Response(body2, { headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=${TTL}`,
    "X-Library-Revision": String(revision)
  } });
}
__name(storedResponse, "storedResponse");
async function sharedCatalog(request, env, ctx, revision, serialize) {
  const key = cacheKey(request, "shared", revision);
  const hit = await cached(key);
  if (hit) return { response: hit, source: "EDGE" };
  const objectKey = `cache/library-${VERSION}/${encodeURIComponent(new URL(request.url).origin)}/shared.json`;
  try {
    const object = await env.MEDIA.get(objectKey);
    if (object?.customMetadata?.revision === String(revision)) {
      const response2 = storedResponse(object.body, revision);
      remember(ctx, key, response2);
      return { response: response2, source: "R2" };
    }
    if (object?.body) await object.body.cancel();
  } catch (error) {
    cacheError(error);
  }
  const rows = await env.DB.batch(catalogQueries.map((sql) => env.DB.prepare(sql)));
  revision = rows[0].results[0].revision;
  const prefix = JSON.stringify(serialize(request, rows.slice(1))).slice(0, -1) + ",";
  const response = storedResponse(prefix, revision);
  remember(ctx, cacheKey(request, "shared", revision), response);
  ctx.waitUntil(env.MEDIA.put(objectKey, prefix, {
    customMetadata: { revision: String(revision) },
    httpMetadata: { contentType: "application/json" }
  }).catch(cacheError));
  console.log(JSON.stringify({
    event: "library_catalog_rebuild",
    revision,
    rowsRead: rows.reduce((sum, row) => sum + (row.meta?.rows_read || 0), 0)
  }));
  return { response, source: "D1" };
}
__name(sharedCatalog, "sharedCatalog");
async function personalLibrary(request, env, ctx, userId, revision) {
  const key = cacheKey(request, `user/${userId}`, revision);
  const hit = await cached(key);
  if (hit) return { value: await hit.json(), revision: Number(hit.headers.get("X-Library-Revision")) };
  const [state, favorites, history] = await env.DB.batch([
    env.DB.prepare(personalSql).bind(userId),
    env.DB.prepare("SELECT track_id FROM user_favorites WHERE user_id=?").bind(userId),
    env.DB.prepare("SELECT track_id FROM user_history WHERE user_id=? ORDER BY played_at DESC, id DESC LIMIT 200").bind(userId)
  ]);
  revision = state.results[0]?.revision || 0;
  const value = { favorites: favorites.results.map((row) => row.track_id), history: history.results.map((row) => row.track_id) };
  remember(ctx, cacheKey(request, `user/${userId}`, revision), storedResponse(JSON.stringify(value), revision));
  return { value, revision };
}
__name(personalLibrary, "personalLibrary");
function tag(userId, shared, personal) {
  return `W/"library-${VERSION}-${userId}-${shared}-${personal}"`;
}
__name(tag, "tag");
function matches(header, etag) {
  return (header || "").split(",").some((value) => value.trim().replace(/^W\//, "") === etag.replace(/^W\//, "") || value.trim() === "*");
}
__name(matches, "matches");
function withSuffix(body2, suffix) {
  const reader = body2.getReader();
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (!done) {
        controller.enqueue(value);
        return;
      }
      controller.enqueue(new TextEncoder().encode(suffix));
      controller.close();
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
}
__name(withSuffix, "withSuffix");
async function cachedLibrary(request, env, ctx, user, serialize, responseHeaders2) {
  const state = await env.DB.prepare(`SELECT library_revision.revision AS shared,
    COALESCE(user_library_revision.revision,0) AS personal
    FROM library_revision LEFT JOIN user_library_revision ON user_library_revision.user_id=?
    WHERE library_revision.id=1`).bind(user.id).first();
  let etag = tag(user.id, state.shared, state.personal);
  const headers = responseHeaders2(request, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-cache",
    "Vary": "Origin, Authorization",
    "ETag": etag,
    "X-Library-Cache": "NOT-MODIFIED"
  });
  if (matches(request.headers.get("If-None-Match"), etag)) return new Response(null, { status: 304, headers });
  const [shared, personal] = await Promise.all([
    sharedCatalog(request, env, ctx, state.shared, serialize),
    personalLibrary(request, env, ctx, user.id, state.personal)
  ]);
  etag = tag(user.id, shared.response.headers.get("X-Library-Revision"), personal.revision);
  headers.set("ETag", etag);
  headers.set("X-Library-Cache", shared.source);
  return new Response(withSuffix(shared.response.body, JSON.stringify(personal.value).slice(1)), { headers });
}
__name(cachedLibrary, "cachedLibrary");
async function cachedCoverPool(request, ctx, load, responseHeaders2) {
  const key = new Request(`${new URL(request.url).origin}/__cache/discovery-covers/v1`);
  const hit = await cached(key);
  if (hit) return new Response(hit.body, { headers: responseHeaders2(request, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": hit.headers.get("Cache-Control")
  }) });
  const response = await load();
  if (response.ok) {
    const internal = new Response(response.clone().body, { headers: {
      "Content-Type": "application/json",
      "Cache-Control": response.headers.get("Cache-Control")
    } });
    remember(ctx, key, internal);
  }
  return response;
}
__name(cachedCoverPool, "cachedCoverPool");

// src/social-core.js
var defaults = Object.freeze({ requests: "everyone", messages: "friends", dm_requests: 1, show_presence: 1, show_activity: 0, share_history: 0, share_favorites: 0, public_music_profile: 0, listening_invites: "friends", call_invites: "none", presence: "online", status_text: "", browser_notifications: 0 });
var uuid2 = /* @__PURE__ */ __name((value) => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(String(value || "")), "uuid");
var pairId = /* @__PURE__ */ __name((a, b) => [a, b].sort().join(":"), "pairId");
var parse = /* @__PURE__ */ __name((value) => {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}, "parse");
function problem(message2, status = 400) {
  return Object.assign(new Error(message2), { status });
}
__name(problem, "problem");
function person(row, origin) {
  return { id: row.id, username: row.username, displayName: row.display_name, avatar: row.avatar_key ? `${origin}/api/media/${encodeURIComponent(row.avatar_key)}` : "", joinedAt: row.created_at };
}
__name(person, "person");
function message(row) {
  return { id: row.id, seq: row.seq, conversationId: row.conversation_id, senderId: row.sender_id, clientId: row.client_id, text: row.body, kind: row.kind, payload: parse(row.payload_json), createdAt: row.created_at, editedAt: row.edited_at, deletedAt: row.deleted_at, replyTo: row.reply_to || null };
}
__name(message, "message");
async function settings(env, id) {
  return { ...defaults, ...await env.DB.prepare("SELECT * FROM user_social_settings WHERE user_id=?").bind(id).first() };
}
__name(settings, "settings");
async function relationship(env, a, b) {
  return env.DB.prepare(`SELECT
    EXISTS(SELECT 1 FROM friendships WHERE user_id=? AND friend_id=?) AS friends,
    EXISTS(SELECT 1 FROM user_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)) AS blocked`).bind(a, b, a, b, b, a).first();
}
__name(relationship, "relationship");
async function requireFriend(env, a, b) {
  const relation = await relationship(env, a, b);
  if (!relation.friends || relation.blocked) throw problem("Esta a\xE7\xE3o est\xE1 dispon\xEDvel apenas entre amigos.", 403);
}
__name(requireFriend, "requireFriend");
async function member(env, id, userId) {
  const row = await env.DB.prepare("SELECT * FROM conversation_members WHERE conversation_id=? AND user_id=?").bind(id, userId).first();
  if (!row) throw problem("Conversa n\xE3o encontrada.", 404);
  const relation = await relationship(env, userId, row.peer_id);
  if (relation.blocked || !relation.friends && !await env.DB.prepare("SELECT pair_id FROM social_dm_requests WHERE pair_id=? AND status='accepted'").bind(pairId(userId, row.peer_id)).first()) throw problem("Esta conversa est\xE1 indispon\xEDvel.", 403);
  return row;
}
__name(member, "member");
async function groupMember(env, groupId, userId) {
  const row = await env.DB.prepare(`SELECT gm.group_id FROM social_group_members gm WHERE gm.group_id=? AND gm.user_id=?
    AND NOT EXISTS (SELECT 1 FROM social_group_members other JOIN user_blocks b ON (b.user_id=gm.user_id AND b.blocked_id=other.user_id) OR (b.user_id=other.user_id AND b.blocked_id=gm.user_id) WHERE other.group_id=gm.group_id)`).bind(groupId, userId).first();
  if (!row) throw problem("Grupo indispon\xEDvel.", 404);
}
__name(groupMember, "groupMember");
async function rate(env, userId, scope, count = 60, seconds = 60) {
  if (!await env.SOCIAL.getByName(userId).consume(scope, count, seconds)) throw problem("Muitas tentativas. Aguarde um momento e tente novamente.", 429);
}
__name(rate, "rate");
async function notify(env, recipient, actor, kind, payload, id = crypto.randomUUID()) {
  await env.DB.prepare("INSERT OR IGNORE INTO social_notifications(id,user_id,actor_id,kind,payload_json,created_at) VALUES(?,?,?,?,?,?)").bind(id, recipient, actor, kind, JSON.stringify(payload), Date.now()).run();
  await env.SOCIAL.getByName(recipient).deliver({ type: "notification", id, actorId: actor, kind, payload, createdAt: Date.now() });
}
__name(notify, "notify");
async function emit(env, ids, event) {
  await Promise.all([...new Set(ids)].map((id) => env.SOCIAL.getByName(id).deliver(event)));
}
__name(emit, "emit");
async function refreshPeople(env, ids) {
  await Promise.all([...new Set(ids)].map((id) => env.SOCIAL.getByName(id).refresh(id)));
}
__name(refreshPeople, "refreshPeople");
var authorizedSql = `(EXISTS(SELECT 1 FROM friendships f WHERE f.user_id=? AND f.friend_id=?) OR EXISTS(SELECT 1 FROM social_dm_requests r WHERE r.pair_id=CASE WHEN ? < ? THEN ?||':'||? ELSE ?||':'||? END AND r.status='accepted'))
  AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=? AND b.blocked_id=?) OR (b.user_id=? AND b.blocked_id=?))`;
var authBindings = /* @__PURE__ */ __name((a, b) => [a, b, a, b, a, b, b, a, a, b, b, a], "authBindings");

// src/social-api.js
import { createHash } from "node:crypto";
var columns = "u.id,u.username,u.display_name,u.avatar_key,u.created_at";
var maxBody = 32e3;
async function body(request) {
  if (Number(request.headers.get("Content-Length")) > maxBody) throw problem("Mensagem muito extensa.", 413);
  const text = await request.text();
  if (text.length > maxBody) throw problem("Mensagem muito extensa.", 413);
  try {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== "object") throw 0;
    return value;
  } catch {
    throw problem("Dados inv\xE1lidos.");
  }
}
__name(body, "body");
function safeText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}
__name(safeText, "safeText");
var sevenTvId = /* @__PURE__ */ __name((value) => /^(?:[a-f0-9]{24}|[0-9a-hjkmnp-tv-z]{26})$/i.test(String(value || "")), "sevenTvId");
async function validReaction(env, emoji, allowMissing = false) {
  if (emoji.startsWith("7tv:")) return sevenTvId(emoji.slice(4));
  if (emoji.startsWith("consona:")) return uuid2(emoji.slice(8)) && (allowMissing || Boolean(await env.DB.prepare("SELECT id FROM social_custom_emojis WHERE id=?").bind(emoji.slice(8)).first()));
  return Boolean(emoji && [...emoji].length <= 12 && /^[\p{Extended_Pictographic}\p{Emoji_Component}\p{Regional_Indicator}\u200d\ufe0f]+$/u.test(emoji));
}
__name(validReaction, "validReaction");
async function limitRepeatedText(env, userId, text) {
  if (!text) return;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text.toLocaleLowerCase().replace(/\s+/g, " ").trim()));
  const hash = Array.from(new Uint8Array(bytes).slice(0, 12), (value) => value.toString(16).padStart(2, "0")).join("");
  await rate(env, userId, `repeat:${hash}`, 5, 120);
}
__name(limitRepeatedText, "limitRepeatedText");
function lastfmConfigured(env) {
  return Boolean(env.LASTFM_API_SECRET && env.LASTFM_SHARED_SECRET);
}
__name(lastfmConfigured, "lastfmConfigured");
async function lastfmCall(env, values, post = false) {
  if (!lastfmConfigured(env)) throw problem("Last.fm n\xE3o configurado para scrobbling.", 503);
  const params = { ...values, api_key: env.LASTFM_API_SECRET }, signature = Object.keys(params).sort().map((k) => k + params[k]).join("") + env.LASTFM_SHARED_SECRET;
  params.api_sig = createHash("md5").update(signature, "utf8").digest("hex");
  params.format = "json";
  const body2 = new URLSearchParams(params);
  let response;
  try {
    response = await fetch(post ? "https://ws.audioscrobbler.com/2.0/" : `https://ws.audioscrobbler.com/2.0/?${body2}`, post ? { method: "POST", body: body2, signal: AbortSignal.timeout(8e3), redirect: "error" } : { signal: AbortSignal.timeout(8e3), redirect: "error" });
  } catch {
    throw problem("Last.fm indispon\xEDvel.", 502);
  }
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > 65536) throw problem("Last.fm indispon\xEDvel.", 502);
  const reader = response.body.getReader(), chunks2 = [];
  let size = 0, value;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > 65536) throw new Error("large");
      chunks2.push(item.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks2) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    await reader.cancel().catch(() => {
    });
    throw problem("Resposta Last.fm inv\xE1lida.", 502);
  }
  if (value.error) throw problem("Last.fm recusou a solicita\xE7\xE3o. Confira a autoriza\xE7\xE3o.", 502);
  return value;
}
__name(lastfmCall, "lastfmCall");
async function lastfmKey(env) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`consona:lastfm:session:v1:${env.LASTFM_SHARED_SECRET}`));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
__name(lastfmKey, "lastfmKey");
var b64 = /* @__PURE__ */ __name((bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))), "b64");
var unb64 = /* @__PURE__ */ __name((value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0)), "unb64");
async function lastfmEncrypt(env, userId, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) }, await lastfmKey(env), new TextEncoder().encode(value));
  return { iv: b64(iv), ciphertext: b64(cipher) };
}
__name(lastfmEncrypt, "lastfmEncrypt");
async function lastfmDecrypt(env, userId, row) {
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(row.iv), additionalData: new TextEncoder().encode(userId) }, await lastfmKey(env), unb64(row.ciphertext)));
  } catch {
    throw problem("Conex\xE3o Last.fm indispon\xEDvel; conecte novamente.", 409);
  }
}
__name(lastfmDecrypt, "lastfmDecrypt");
function trackKlipyShare(ctx, env, userId, payload, query) {
  if (payload.provider !== "klipy" || !env.KLIPY_API_KEY) return;
  const type = payload.type === "gif" ? "gifs" : "stickers";
  const endpoint = `https://api.klipy.com/api/v1/${encodeURIComponent(env.KLIPY_API_KEY)}/${type}/share/${encodeURIComponent(payload.id)}`;
  ctx.waitUntil(fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer_id: userId, q: safeText(query, 80) }), signal: AbortSignal.timeout(5e3), redirect: "error" }).catch(() => {
  }));
}
__name(trackKlipyShare, "trackKlipyShare");
var PREVIEW_HOSTS = ["youtube.com", "youtu.be", "spotify.com", "bandcamp.com", "soundcloud.com", "musicbrainz.org", "last.fm", "wikipedia.org"];
function previewUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw problem("Link inv\xE1lido.");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || !PREVIEW_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) throw problem("Pr\xE9via indispon\xEDvel para este dom\xEDnio.", 400);
  url.hash = "";
  return url;
}
__name(previewUrl, "previewUrl");
async function linkPreview(value) {
  const url = previewUrl(value);
  let response;
  try {
    response = await fetch(url.href, { redirect: "error", signal: AbortSignal.timeout(5e3), headers: { Accept: "text/html", "User-Agent": "Consona/1.0 link preview" } });
  } catch {
    throw problem("Pr\xE9via indispon\xEDvel.", 502);
  }
  if (!response.ok || !response.body || !response.headers.get("content-type")?.toLowerCase().includes("text/html")) throw problem("Pr\xE9via indispon\xEDvel.", 502);
  const reader = response.body.getReader();
  let size = 0;
  const chunks2 = [];
  try {
    while (size < 262144) {
      const { value: value2, done } = await reader.read();
      if (done) break;
      const part = value2.slice(0, 262144 - size);
      chunks2.push(part);
      size += part.length;
      if (part.length < value2.length) break;
    }
  } finally {
    await reader.cancel().catch(() => {
    });
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks2) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const meta = {}, rewriter = new HTMLRewriter().on("meta", { element(element) {
    const key = (element.getAttribute("property") || element.getAttribute("name") || "").toLowerCase();
    if (["og:title", "og:description", "og:image", "twitter:title", "twitter:description"].includes(key) && !meta[key]) meta[key] = safeText(element.getAttribute("content"), 600);
  } }).on("title", { text(text) {
    if (!meta.title) meta.title = "";
    meta.title += text.text;
  } });
  await rewriter.transform(new Response(bytes, { headers: { "content-type": "text/html;charset=utf-8" } })).text();
  let image = "";
  try {
    if (meta["og:image"]) {
      const parsed = new URL(meta["og:image"], url);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port) image = parsed.href;
    }
  } catch {
  }
  return { url: url.href, domain: url.hostname, title: safeText(meta["og:title"] || meta["twitter:title"] || meta.title, 200), description: safeText(meta["og:description"] || meta["twitter:description"], 400), image };
}
__name(linkPreview, "linkPreview");
async function providerJson(url) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5e3), redirect: "error", headers: { Accept: "application/json" } });
  } catch {
    throw problem("Servi\xE7o de m\xEDdia indispon\xEDvel.", 503);
  }
  if (!response.ok || !response.body) throw problem("Servi\xE7o de m\xEDdia indispon\xEDvel.", 503);
  const reader = response.body.getReader();
  let length = 0;
  const chunks2 = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 1024 * 1024) throw new Error("large");
      chunks2.push(value);
    }
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks2) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    await reader.cancel().catch(() => {
    });
    throw problem("Resposta de m\xEDdia inv\xE1lida.", 502);
  }
}
__name(providerJson, "providerJson");
async function stopSessions(env, a, b) {
  const rows = await env.DB.prepare("SELECT id FROM listening_sessions WHERE ((host_id=? AND guest_id=?) OR (host_id=? AND guest_id=?)) AND status IN ('pending','active')").bind(a, b, b, a).all();
  for (const row of rows.results) await env.LISTENING.getByName(row.id).end(a);
}
__name(stopSessions, "stopSessions");
var groupMessage = /* @__PURE__ */ __name((row) => ({ id: row.id, seq: row.seq, groupId: row.group_id, senderId: row.sender_id, senderName: row.display_name, clientId: row.client_id, text: row.body, kind: row.kind, payload: parse(row.payload_json), createdAt: row.created_at, editedAt: row.edited_at, deletedAt: row.deleted_at, replyTo: row.reply_to, attachment: row.attachment_id ? { id: row.attachment_id, name: row.attachment_name, mime: row.attachment_mime, size: row.attachment_size } : null }), "groupMessage");
async function groupRecipients(env, groupId) {
  const rows = await env.DB.prepare("SELECT user_id FROM social_group_members WHERE group_id=?").bind(groupId).all();
  return rows.results.map((row) => row.user_id);
}
__name(groupRecipients, "groupRecipients");
async function openConversation(env, a, b) {
  const relation = await relationship(env, a, b);
  if (relation.blocked || !relation.friends && !await env.DB.prepare("SELECT pair_id FROM social_dm_requests WHERE pair_id=? AND status='accepted'").bind(pairId(a, b)).first()) throw problem("Esta conversa est\xE1 indispon\xEDvel.", 403);
  const id = pairId(a, b), now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO conversations(id,created_at,updated_at) VALUES(?,?,?)").bind(id, now, now),
    env.DB.prepare("INSERT OR IGNORE INTO conversation_members(conversation_id,user_id,peer_id) VALUES(?,?,?)").bind(id, a, b),
    env.DB.prepare("INSERT OR IGNORE INTO conversation_members(conversation_id,user_id,peer_id) VALUES(?,?,?)").bind(id, b, a),
    env.DB.prepare("UPDATE conversation_members SET archived=0 WHERE conversation_id=? AND user_id=?").bind(id, a)
  ]);
  return id;
}
__name(openConversation, "openConversation");
async function conversations(env, userId) {
  const rows = await env.DB.prepare(`SELECT c.*,cm.peer_id,cm.last_read_seq,cm.last_delivered_seq,cm.unread_count,cm.manual_unread,cm.muted,cm.archived,
    peer.last_read_seq AS peer_read_seq,peer.last_delivered_seq AS peer_delivered_seq,
    m.body AS preview,m.kind AS last_kind,m.sender_id AS last_sender,m.deleted_at AS last_deleted
    FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id
    JOIN conversation_members peer ON peer.conversation_id=c.id AND peer.user_id=cm.peer_id
    LEFT JOIN messages m ON m.seq=c.last_seq
    WHERE cm.user_id=? AND (EXISTS(SELECT 1 FROM friendships f WHERE f.user_id=cm.user_id AND f.friend_id=cm.peer_id) OR EXISTS(SELECT 1 FROM social_dm_requests d WHERE d.pair_id=c.id AND d.status='accepted'))
      AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=cm.user_id AND b.blocked_id=cm.peer_id) OR (b.user_id=cm.peer_id AND b.blocked_id=cm.user_id))
    ORDER BY c.updated_at DESC LIMIT 200`).bind(userId).all();
  return rows.results.map((row) => ({
    id: row.id,
    peerId: row.peer_id,
    updatedAt: row.updated_at,
    lastSeq: row.last_seq,
    lastReadSeq: row.last_read_seq,
    peerReadSeq: row.peer_read_seq,
    peerDeliveredSeq: row.peer_delivered_seq,
    unread: Math.max(row.unread_count, row.manual_unread),
    muted: Boolean(row.muted),
    archived: Boolean(row.archived),
    preview: row.last_deleted ? "Mensagem exclu\xEDda" : row.preview || (row.last_kind && row.last_kind !== "text" ? "Compartilhou um arquivo ou m\xFAsica" : "Comece uma conversa")
  }));
}
__name(conversations, "conversations");
async function bootstrap(request, env, user) {
  const origin = new URL(request.url).origin;
  const [friends, incoming, outgoing, blocked, notifications, unread, prefs, threads, dmContacts, dmIncoming, dmOutgoing] = await Promise.all([
    env.DB.prepare(`SELECT ${columns} FROM friendships f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? ORDER BY u.display_name COLLATE NOCASE`).bind(user.id).all(),
    env.DB.prepare(`SELECT ${columns},f.created_at AS requested_at FROM friend_requests f JOIN users u ON u.id=f.sender_id WHERE f.receiver_id=? ORDER BY f.created_at DESC LIMIT 100`).bind(user.id).all(),
    env.DB.prepare(`SELECT ${columns},f.created_at AS requested_at FROM friend_requests f JOIN users u ON u.id=f.receiver_id WHERE f.sender_id=? ORDER BY f.created_at DESC LIMIT 100`).bind(user.id).all(),
    env.DB.prepare(`SELECT ${columns} FROM user_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=? LIMIT 500`).bind(user.id).all(),
    env.DB.prepare("SELECT * FROM social_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(user.id).all(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM social_notifications WHERE user_id=? AND read_at IS NULL").bind(user.id).first(),
    settings(env, user.id),
    conversations(env, user.id),
    env.DB.prepare(`SELECT ${columns} FROM social_dm_requests d JOIN users u ON u.id=CASE WHEN d.sender_id=? THEN d.receiver_id ELSE d.sender_id END WHERE (d.sender_id=? OR d.receiver_id=?) AND d.status='accepted' AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=? AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?))`).bind(user.id, user.id, user.id, user.id, user.id).all(),
    env.DB.prepare(`SELECT ${columns} FROM social_dm_requests d JOIN users u ON u.id=d.sender_id WHERE d.receiver_id=? AND d.status='pending'`).bind(user.id).all(),
    env.DB.prepare(`SELECT ${columns} FROM social_dm_requests d JOIN users u ON u.id=d.receiver_id WHERE d.sender_id=? AND d.status='pending'`).bind(user.id).all()
  ]);
  await env.SOCIAL.getByName(user.id).ensure(user.id);
  return {
    friends: friends.results.map((row) => person(row, origin)),
    incoming: incoming.results.map((row) => person(row, origin)),
    outgoing: outgoing.results.map((row) => person(row, origin)),
    blocked: blocked.results.map((row) => person(row, origin)),
    dmContacts: dmContacts.results.map((row) => person(row, origin)),
    dmIncoming: dmIncoming.results.map((row) => person(row, origin)),
    dmOutgoing: dmOutgoing.results.map((row) => person(row, origin)),
    conversations: threads,
    settings: prefs,
    notifications: notifications.results.map((row) => ({ id: row.id, actorId: row.actor_id, kind: row.kind, payload: parse(row.payload_json), createdAt: row.created_at, readAt: row.read_at })),
    notificationCount: unread.total,
    presence: await env.SOCIAL.getByName(user.id).snapshot()
  };
}
__name(bootstrap, "bootstrap");
async function attachmentType(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = new TextDecoder().decode(bytes);
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) return "image/png";
  if (/^GIF8[79]a/.test(ascii)) return "image/gif";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  if (ascii.startsWith("%PDF-")) return "application/pdf";
  if (/\.txt$/i.test(file.name) && file.type === "text/plain") return "text/plain";
  throw problem("Envie JPG, PNG, GIF, WebP, PDF ou TXT.");
}
__name(attachmentType, "attachmentType");
async function socialSocket(request, env) {
  const url = new URL(request.url);
  if (!uuid2(url.searchParams.get("user")) || !uuid2(url.searchParams.get("ticket"))) return new Response("N\xE3o autorizado", { status: 401 });
  return env.SOCIAL.getByName(url.searchParams.get("user")).fetch(request);
}
__name(socialSocket, "socialSocket");
async function socialRoutes(request, env, user, helpers) {
  const { json: json2, responseHeaders: responseHeaders2, ctx } = helpers;
  const url = new URL(request.url), path = url.pathname.replace(/^\/api\/social/, ""), method = request.method;
  if (!url.pathname.startsWith("/api/social/")) return null;
  if (!user) return json2(request, { error: "Entre na sua conta para acessar os amigos." }, 401);
  try {
    const origin = url.origin;
    if (path === "/state" && method === "GET") return json2(request, await bootstrap(request, env, user));
    if (path === "/lastfm/state" && method === "GET") {
      const row = await env.DB.prepare("SELECT username,connected_at FROM social_lastfm_links WHERE user_id=?").bind(user.id).first();
      return json2(request, { configured: lastfmConfigured(env), connected: Boolean(row), username: row?.username || "" });
    }
    if (path === "/lastfm/authorize" && method === "POST") {
      await rate(env, user.id, "lastfm_authorize", 10, 300);
      const data = await lastfmCall(env, { method: "auth.getToken" });
      if (!/^[a-f0-9]{32}$/i.test(data.token || "")) throw problem("Token Last.fm inv\xE1lido.", 502);
      const tokenHash = createHash("sha256").update(data.token).digest("hex");
      await env.DB.prepare("INSERT INTO social_lastfm_pending(user_id,token_hash,expires_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at").bind(user.id, tokenHash, Date.now() + 36e5).run();
      const link = new URL("https://www.last.fm/api/auth/");
      link.searchParams.set("api_key", env.LASTFM_API_SECRET);
      link.searchParams.set("token", data.token);
      return json2(request, { url: link.href, token: data.token });
    }
    if (path === "/lastfm/connect" && method === "POST") {
      await rate(env, user.id, "lastfm_connect", 10, 300);
      if (!lastfmConfigured(env)) throw problem("Last.fm n\xE3o configurado para scrobbling.", 503);
      const data = await body(request), token = String(data.token || "");
      if (!/^[a-f0-9]{32}$/i.test(token)) throw problem("Token inv\xE1lido.");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const pending = await env.DB.prepare("SELECT token_hash FROM social_lastfm_pending WHERE user_id=? AND token_hash=? AND expires_at>?").bind(user.id, tokenHash, Date.now()).first();
      if (!pending) throw problem("Autoriza\xE7\xE3o expirada.", 403);
      const value = await lastfmCall(env, { method: "auth.getSession", token });
      if (!value.session?.key || !value.session?.name) throw problem("Autoriza\xE7\xE3o Last.fm indispon\xEDvel.", 502);
      const encrypted = await lastfmEncrypt(env, user.id, value.session.key);
      await env.DB.batch([env.DB.prepare("INSERT INTO social_lastfm_links(user_id,username,iv,ciphertext,connected_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,iv=excluded.iv,ciphertext=excluded.ciphertext,connected_at=excluded.connected_at").bind(user.id, safeText(value.session.name, 100), encrypted.iv, encrypted.ciphertext, Date.now()), env.DB.prepare("DELETE FROM social_lastfm_pending WHERE user_id=?").bind(user.id)]);
      return json2(request, { ok: true, username: safeText(value.session.name, 100) });
    }
    if (path === "/lastfm/link" && method === "DELETE") {
      await env.DB.batch([env.DB.prepare("DELETE FROM social_lastfm_links WHERE user_id=?").bind(user.id), env.DB.prepare("DELETE FROM social_lastfm_pending WHERE user_id=?").bind(user.id)]);
      return json2(request, { ok: true });
    }
    if (path === "/lastfm/scrobble" && method === "POST") {
      await rate(env, user.id, "lastfm_scrobble", 40, 60);
      if (!lastfmConfigured(env)) throw problem("Last.fm n\xE3o configurado para scrobbling.", 503);
      const data = await body(request), started = Math.floor(Number(data.startedAt)), played = Number(data.playedSeconds);
      if (!uuid2(data.clientId) || !Number.isFinite(started) || started > Date.now() + 3e5 || started < Date.now() - 14 * 864e5) throw problem("Reprodu\xE7\xE3o inv\xE1lida.");
      const [track, link] = await Promise.all([env.DB.prepare("SELECT id,title,artist,duration_seconds FROM tracks WHERE id=? AND import_batch_id IS NULL").bind(String(data.trackId || "")).first(), env.DB.prepare("SELECT * FROM social_lastfm_links WHERE user_id=?").bind(user.id).first()]);
      if (!track || !link) throw problem("Faixa ou conex\xE3o Last.fm indispon\xEDvel.", 404);
      const duration = Number(track.duration_seconds);
      if (!Number.isFinite(duration) || duration < 30 || !Number.isFinite(played) || played < Math.min(duration / 2, 240) || Date.now() - started < Math.min(duration / 2, 240) * 1e3 - 5e3) throw problem("Reprodu\xE7\xE3o ainda n\xE3o atingiu o limite de scrobble.", 400);
      const claim = await env.DB.prepare("INSERT OR IGNORE INTO social_lastfm_scrobbles(user_id,client_id,created_at) VALUES(?,?,?)").bind(user.id, data.clientId, Date.now()).run();
      if (!claim.meta.changes) return json2(request, { ok: true, duplicate: true });
      try {
        const sk = await lastfmDecrypt(env, user.id, link);
        const result = await lastfmCall(env, { method: "track.scrobble", artist: track.artist, track: track.title, timestamp: String(Math.floor(started / 1e3)), duration: String(Math.floor(duration)), sk }, true);
        if (Number(result.scrobbles?.["@attr"]?.accepted) === 0) return json2(request, { ok: true, ignored: true });
      } catch (error) {
        await env.DB.prepare("DELETE FROM social_lastfm_scrobbles WHERE user_id=? AND client_id=?").bind(user.id, data.clientId).run();
        throw error;
      }
      return json2(request, { ok: true });
    }
    const dmRequest = path.match(/^\/dm-requests\/([^/]+)$/);
    if (dmRequest && method === "POST") {
      const other = dmRequest[1];
      if (!uuid2(other) || other === user.id) throw problem("Usu\xE1rio inv\xE1lido.");
      await rate(env, user.id, "dm_request", 10, 300);
      const data = await body(request), relation = await relationship(env, user.id, other);
      if (relation.blocked) throw problem("Solicita\xE7\xE3o indispon\xEDvel.", 403);
      const key = pairId(user.id, other);
      if (data.action === "request") {
        if (!(await settings(env, other)).dm_requests) throw problem("Usu\xE1rio n\xE3o recebe solicita\xE7\xF5es de mensagem.", 403);
        const insert = await env.DB.prepare("INSERT OR IGNORE INTO social_dm_requests(pair_id,sender_id,receiver_id,status,created_at) SELECT ?,?,id,'pending',? FROM users WHERE id=? AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?))").bind(key, user.id, Date.now(), other, user.id, other, other, user.id).run();
        if (!insert.meta.changes) throw problem("Solicita\xE7\xE3o j\xE1 existe ou est\xE1 indispon\xEDvel.", 409);
        await notify(env, other, user.id, "dm_request", { displayName: user.display_name });
      } else if (data.action === "accept") {
        const update = await env.DB.prepare("UPDATE social_dm_requests SET status='accepted' WHERE pair_id=? AND sender_id=? AND receiver_id=? AND status='pending'").bind(key, other, user.id).run();
        if (!update.meta.changes) throw problem("Solicita\xE7\xE3o indispon\xEDvel.", 404);
      } else if (data.action === "decline" || data.action === "cancel") {
        const deleteResult = await env.DB.prepare("DELETE FROM social_dm_requests WHERE pair_id=? AND status='pending' AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))").bind(key, user.id, other, other, user.id).run();
        if (!deleteResult.meta.changes) throw problem("Solicita\xE7\xE3o indispon\xEDvel.", 404);
      } else throw problem("A\xE7\xE3o inv\xE1lida.");
      await refreshPeople(env, [user.id, other]);
      await emit(env, [user.id, other], { type: "social_changed" });
      return json2(request, { ok: true });
    }
    const playlistCollab = path.match(/^\/playlists\/([^/]+)\/collaborators$/);
    if (playlistCollab && method === "GET") {
      const id = playlistCollab[1];
      const list = await env.DB.prepare("SELECT p.added_by,c.owner_id FROM playlists p LEFT JOIN social_collaborative_playlists c ON c.playlist_id=p.id WHERE p.id=?").bind(id).first();
      if (!list) throw problem("Playlist indispon\xEDvel.", 404);
      const rows = await env.DB.prepare(`SELECT ${columns} FROM social_playlist_collaborators c JOIN users u ON u.id=c.user_id WHERE c.playlist_id=? ORDER BY u.display_name`).bind(id).all();
      return json2(request, { ownerId: list.owner_id || list.added_by, enabled: Boolean(list.owner_id), members: rows.results.map((row) => person(row, origin)) });
    }
    if (playlistCollab && method === "POST") {
      await rate(env, user.id, "playlist_collaborator", 20);
      const id = playlistCollab[1], data = await body(request), other = String(data.userId || "");
      if (!uuid2(other) || other === user.id) throw problem("Amigo inv\xE1lido.");
      await requireFriend(env, user.id, other);
      const list = await env.DB.prepare("SELECT id FROM playlists WHERE id=? AND added_by=?").bind(id, user.id).first();
      if (!list) throw problem("Somente o criador pode convidar colaboradores.", 403);
      await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO social_collaborative_playlists(playlist_id,owner_id) VALUES(?,?)").bind(id, user.id), env.DB.prepare("INSERT OR IGNORE INTO social_playlist_collaborators(playlist_id,user_id,added_at) VALUES(?,?,?)").bind(id, other, Date.now())]);
      await emit(env, [user.id, other], { type: "social_changed" });
      return json2(request, { ok: true });
    }
    const removePlaylistCollab = path.match(/^\/playlists\/([^/]+)\/collaborators\/([^/]+)$/);
    if (removePlaylistCollab && method === "DELETE") {
      const [, id, other] = removePlaylistCollab;
      const list = await env.DB.prepare("SELECT owner_id FROM social_collaborative_playlists WHERE playlist_id=?").bind(id).first();
      if (!list || list.owner_id !== user.id && other !== user.id) throw problem("A\xE7\xE3o n\xE3o autorizada.", 403);
      await env.DB.prepare("DELETE FROM social_playlist_collaborators WHERE playlist_id=? AND user_id=?").bind(id, other).run();
      await emit(env, [user.id, other], { type: "social_changed" });
      return json2(request, { ok: true });
    }
    if (path === "/link-preview" && method === "GET") {
      await rate(env, user.id, "link_preview", 30);
      return json2(request, await linkPreview(url.searchParams.get("url") || ""));
    }
    if (path === "/custom-emojis" && method === "GET") {
      const rows = await env.DB.prepare("SELECT id,owner_id,name,pack,mime,type FROM social_custom_emojis ORDER BY created_at DESC LIMIT 300").all();
      return json2(request, { items: rows.results.map((row) => ({ provider: "consona", id: row.id, ownerId: row.owner_id, name: row.name, pack: row.pack, mime: row.mime, type: row.type })) });
    }
    if (path === "/custom-emojis" && method === "POST") {
      await rate(env, user.id, "custom_emoji_upload", 10, 3600);
      if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data;") || Number(request.headers.get("Content-Length")) > 1024 * 1024) throw problem("Imagem inv\xE1lida.");
      const form = await request.formData(), file = form.get("file"), name = safeText(form.get("name"), 40), pack = safeText(form.get("pack"), 60), type = form.get("type") === "sticker" ? "sticker" : "emoji";
      if (!(file instanceof File) || !file.size || file.size > 512 * 1024 || !/^[a-z0-9_]{2,40}$/i.test(name)) throw problem("Escolha imagem de at\xE9 512 KB e nome com letras, n\xFAmeros ou sublinhado.");
      const mime = await attachmentType(file);
      if (!["image/png", "image/gif", "image/webp"].includes(mime)) throw problem("Use PNG, GIF ou WebP.");
      const id = crypto.randomUUID(), key = `social/${user.id}/${id}`;
      await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: mime } });
      try {
        await env.DB.prepare("INSERT INTO social_custom_emojis(id,owner_id,name,pack,mime,media_key,created_at,type) VALUES(?,?,?,?,?,?,?,?)").bind(id, user.id, name, pack, mime, key, Date.now(), type).run();
      } catch (error) {
        await env.MEDIA.delete(key);
        throw problem("Nome j\xE1 utilizado.", 409);
      }
      return json2(request, { id, provider: "consona", ownerId: user.id, name, pack, mime, type }, 201);
    }
    const customEmoji = path.match(/^\/custom-emojis\/([^/]+)$/);
    if (customEmoji && method === "GET") {
      const row = await env.DB.prepare("SELECT * FROM social_custom_emojis WHERE id=?").bind(customEmoji[1]).first();
      if (!row) throw problem("Emoji indispon\xEDvel.", 404);
      const object = await env.MEDIA.get(row.media_key);
      if (!object) throw problem("Emoji indispon\xEDvel.", 404);
      return new Response(object.body, { headers: responseHeaders2(request, { "Content-Type": row.mime, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" }) });
    }
    if (customEmoji && method === "DELETE") {
      const row = await env.DB.prepare("SELECT * FROM social_custom_emojis WHERE id=? AND owner_id=?").bind(customEmoji[1], user.id).first();
      if (!row) throw problem("Emoji indispon\xEDvel.", 404);
      await env.DB.prepare("DELETE FROM social_custom_emojis WHERE id=? AND owner_id=?").bind(row.id, user.id).run();
      await env.MEDIA.delete(row.media_key);
      return json2(request, { ok: true });
    }
    if (path === "/groups" && method === "GET") {
      const rows = await env.DB.prepare(`SELECT g.*,gm.last_read_seq,(SELECT COUNT(*) FROM social_group_messages m WHERE m.group_id=g.id AND m.sender_id<>gm.user_id AND m.seq>gm.last_read_seq AND m.deleted_at IS NULL) AS unread
        FROM social_groups g JOIN social_group_members gm ON gm.group_id=g.id WHERE gm.user_id=? AND NOT EXISTS (SELECT 1 FROM social_group_members other JOIN user_blocks b ON (b.user_id=gm.user_id AND b.blocked_id=other.user_id) OR (b.user_id=other.user_id AND b.blocked_id=gm.user_id) WHERE other.group_id=g.id) ORDER BY g.updated_at DESC LIMIT 100`).bind(user.id).all();
      return json2(request, { groups: rows.results.map((row) => ({ id: row.id, name: row.name, ownerId: row.owner_id, unread: row.unread, updatedAt: row.updated_at })) });
    }
    if (path === "/groups" && method === "POST") {
      await rate(env, user.id, "create_group", 10, 300);
      const data = await body(request), name = safeText(data.name, 80), invited = [...new Set(Array.isArray(data.members) ? data.members : [])];
      if (!name || invited.length < 2 || invited.length > 20 || invited.some((id2) => !uuid2(id2) || id2 === user.id)) throw problem("Escolha um nome e entre 2 e 20 amigos.");
      for (const id2 of invited) {
        await requireFriend(env, user.id, id2);
        if ((await settings(env, id2)).messages !== "friends") throw problem("Um participante desativou mensagens.", 403);
      }
      const participants = [user.id, ...invited], id = crypto.randomUUID(), now = Date.now();
      for (let i = 0; i < participants.length; i++) for (let j = i + 1; j < participants.length; j++) if ((await relationship(env, participants[i], participants[j])).blocked) throw problem("N\xE3o foi poss\xEDvel criar este grupo.", 403);
      await env.DB.batch([env.DB.prepare("INSERT INTO social_groups(id,name,owner_id,created_at,updated_at) VALUES(?,?,?,?,?)").bind(id, name, user.id, now, now), ...participants.map((memberId) => env.DB.prepare("INSERT INTO social_group_members(group_id,user_id) VALUES(?,?)").bind(id, memberId))]);
      await emit(env, participants, { type: "group_update", groupId: id });
      return json2(request, { id }, 201);
    }
    const groupMembers = path.match(/^\/groups\/([^/]+)\/members$/);
    if (groupMembers && method === "GET") {
      const id = groupMembers[1];
      await groupMember(env, id, user.id);
      const rows = await env.DB.prepare(`SELECT ${columns} FROM social_group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=? ORDER BY u.display_name`).bind(id).all();
      return json2(request, { members: rows.results.map((row) => person(row, origin)) });
    }
    if (groupMembers && method === "POST") {
      const id = groupMembers[1];
      await groupMember(env, id, user.id);
      await rate(env, user.id, "group_members", 20);
      const group = await env.DB.prepare("SELECT * FROM social_groups WHERE id=? AND owner_id=?").bind(id, user.id).first();
      if (!group) throw problem("Somente o anfitri\xE3o pode adicionar participantes.", 403);
      const data = await body(request), other = String(data.userId || "");
      if (!uuid2(other) || other === user.id) throw problem("Usu\xE1rio inv\xE1lido.");
      await requireFriend(env, user.id, other);
      if ((await settings(env, other)).messages !== "friends") throw problem("Participante desativou mensagens.", 403);
      const current = await groupRecipients(env, id);
      if (current.length >= 21) throw problem("Grupo atingiu o limite.", 409);
      for (const participant of current) if ((await relationship(env, participant, other)).blocked) throw problem("N\xE3o foi poss\xEDvel adicionar este participante.", 403);
      await env.DB.prepare("INSERT OR IGNORE INTO social_group_members(group_id,user_id) VALUES(?,?)").bind(id, other).run();
      await emit(env, [...current, other], { type: "group_update", groupId: id });
      return json2(request, { ok: true });
    }
    const removeGroupMember = path.match(/^\/groups\/([^/]+)\/members\/([^/]+)$/);
    if (removeGroupMember && method === "DELETE") {
      const [, , other] = removeGroupMember, id = removeGroupMember[1];
      await groupMember(env, id, user.id);
      const group = await env.DB.prepare("SELECT owner_id FROM social_groups WHERE id=?").bind(id).first();
      if (other === group.owner_id) throw problem("O anfitri\xE3o n\xE3o pode ser removido.", 403);
      if (other !== user.id && group.owner_id !== user.id) throw problem("A\xE7\xE3o n\xE3o autorizada.", 403);
      const current = await groupRecipients(env, id);
      await env.DB.prepare("DELETE FROM social_group_members WHERE group_id=? AND user_id=?").bind(id, other).run();
      await emit(env, current, { type: "group_update", groupId: id });
      return json2(request, { ok: true });
    }
    const groupMessages = path.match(/^\/groups\/([^/]+)\/messages$/);
    if (groupMessages && method === "GET") {
      const id = groupMessages[1];
      await groupMember(env, id, user.id);
      const before = Math.max(1, Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER);
      const q = safeText(url.searchParams.get("q"), 120).replace(/[\\%_]/g, "\\$&");
      const sender = url.searchParams.get("sender"), kind = url.searchParams.get("kind"), since = Math.max(0, Number(url.searchParams.get("since")) || 0), filter = q.length >= 2 || sender || kind || since, conditions = ["m.group_id=?", "m.seq<?"], params = [id, before];
      if (filter) conditions.push("m.deleted_at IS NULL");
      if (q.length >= 2) {
        conditions.push("m.body LIKE ? ESCAPE '\\'");
        params.push(`%${q}%`);
      }
      if (sender === "me") {
        conditions.push("m.sender_id=?");
        params.push(user.id);
      } else if (sender === "other") {
        conditions.push("m.sender_id<>?");
        params.push(user.id);
      }
      if (["text", "attachment", "track", "album", "playlist", "external_media", "custom_emoji"].includes(kind)) {
        conditions.push("m.kind=?");
        params.push(kind);
      }
      if (since) {
        conditions.push("m.created_at>=?");
        params.push(since);
      }
      const rows = await env.DB.prepare(`SELECT m.*,u.display_name,a.name AS attachment_name,a.mime AS attachment_mime,a.size AS attachment_size FROM social_group_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN social_group_attachments a ON a.id=m.attachment_id AND a.message_id=m.id WHERE ${conditions.join(" AND ")} ORDER BY m.seq DESC LIMIT 41`).bind(...params).all();
      const page = rows.results.slice(0, 40).reverse();
      return json2(request, { messages: page.map(groupMessage), hasMore: rows.results.length > 40, nextBefore: page[0]?.seq || null });
    }
    if (groupMessages && method === "POST") {
      const id = groupMessages[1];
      await groupMember(env, id, user.id);
      await rate(env, user.id, "send_group_message", 45);
      const data = await body(request), text = safeText(data.text, 4e3), attachmentId = data.attachmentId || null, kind = data.kind || (attachmentId ? "attachment" : "text");
      if (!["text", "attachment", "track", "album", "playlist", "custom_emoji", "external_media"].includes(kind) || kind === "text" && !text || kind === "attachment" !== Boolean(attachmentId) || !uuid2(data.clientId)) throw problem("Mensagem inv\xE1lida.");
      const prior = await env.DB.prepare("SELECT m.*,u.display_name,a.name AS attachment_name,a.mime AS attachment_mime,a.size AS attachment_size FROM social_group_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN social_group_attachments a ON a.id=m.attachment_id AND a.message_id=m.id WHERE m.group_id=? AND m.sender_id=? AND m.client_id=?").bind(id, user.id, data.clientId).first();
      if (prior) return json2(request, { message: groupMessage(prior) }, 201);
      await limitRepeatedText(env, user.id, text);
      let payload = {};
      if (["track", "album", "playlist"].includes(kind)) {
        const table = { track: "tracks", album: "albums", playlist: "playlists" }[kind];
        const item = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?${kind === "track" ? " AND import_batch_id IS NULL" : ""}`).bind(String(data.itemId || "")).first();
        if (!item) throw problem("Item indispon\xEDvel.", 404);
        payload = { id: item.id, title: item.title || item.name, artist: item.artist || "", kind };
        if (kind === "track" && data.position != null && Number.isFinite(Number(data.position))) payload.position = Math.min(Math.max(0, Number(data.position)), Number(item.duration_seconds) > 0 ? Number(item.duration_seconds) : 86400);
      }
      if (kind === "custom_emoji") {
        const item = await env.DB.prepare("SELECT id,name,mime,pack,type FROM social_custom_emojis WHERE id=?").bind(String(data.emojiId || "")).first();
        if (!item) throw problem("Emoji indispon\xEDvel.", 404);
        payload = item;
      }
      if (kind === "external_media") {
        const item = data.payload || {};
        if (item.provider === "7tv" && sevenTvId(item.id)) payload = { provider: "7tv", id: item.id, name: safeText(item.name, 80), url: `https://cdn.7tv.app/emote/${item.id}/2x.webp` };
        else if (item.provider === "klipy" && ["gif", "sticker"].includes(item.type) && /^[a-z0-9_-]{1,150}$/i.test(item.id || "")) {
          let parsed;
          try {
            parsed = new URL(item.url);
          } catch {
            throw problem("M\xEDdia inv\xE1lida.");
          }
          if (parsed.protocol !== "https:" || parsed.hostname !== "static.klipy.com" || parsed.username || parsed.password || parsed.port) throw problem("M\xEDdia inv\xE1lida.");
          payload = { provider: "klipy", type: item.type, id: item.id, name: safeText(item.name, 150), url: parsed.href };
        } else throw problem("M\xEDdia inv\xE1lida.");
      }
      if (attachmentId) {
        const item = await env.DB.prepare("SELECT * FROM social_group_attachments WHERE id=? AND group_id=? AND owner_id=?").bind(attachmentId, id, user.id).first();
        if (!item || item.created_at < Date.now() - 864e5) throw problem("Anexo indispon\xEDvel.", 404);
        if (item.message_id) {
          const old = await env.DB.prepare("SELECT client_id FROM social_group_messages WHERE id=?").bind(item.message_id).first();
          if (old?.client_id !== data.clientId) throw problem("Anexo j\xE1 enviado.", 409);
        }
      }
      const replyTo = data.replyTo || null;
      if (replyTo && !await env.DB.prepare("SELECT id FROM social_group_messages WHERE id=? AND group_id=? AND deleted_at IS NULL").bind(replyTo, id).first()) throw problem("Mensagem respondida indispon\xEDvel.", 404);
      const now = Date.now(), msgId = crypto.randomUUID();
      await env.DB.batch([env.DB.prepare(`INSERT OR IGNORE INTO social_group_messages(id,group_id,sender_id,client_id,body,created_at,reply_to,attachment_id,kind,payload_json)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM social_group_members gm WHERE gm.group_id=? AND gm.user_id=?
          AND NOT EXISTS(SELECT 1 FROM social_group_members other JOIN user_blocks b ON (b.user_id=gm.user_id AND b.blocked_id=other.user_id) OR (b.user_id=other.user_id AND b.blocked_id=gm.user_id) WHERE other.group_id=gm.group_id))
          AND NOT EXISTS(SELECT 1 FROM social_group_members other JOIN user_social_settings s ON s.user_id=other.user_id WHERE other.group_id=? AND other.user_id<>? AND s.messages='none') AND (? IS NULL OR EXISTS(SELECT 1 FROM social_group_attachments WHERE id=? AND message_id IS NULL))`).bind(msgId, id, user.id, data.clientId, text, now, replyTo, attachmentId, kind, JSON.stringify(payload), id, user.id, id, user.id, attachmentId, attachmentId), env.DB.prepare("UPDATE social_groups SET updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM social_group_messages WHERE group_id=? AND sender_id=? AND client_id=?)").bind(now, id, id, user.id, data.clientId), env.DB.prepare("UPDATE social_group_attachments SET message_id=(SELECT id FROM social_group_messages WHERE group_id=? AND sender_id=? AND client_id=?) WHERE id=? AND message_id IS NULL").bind(id, user.id, data.clientId, attachmentId)]);
      const row = await env.DB.prepare("SELECT m.*,u.display_name,a.name AS attachment_name,a.mime AS attachment_mime,a.size AS attachment_size FROM social_group_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN social_group_attachments a ON a.id=m.attachment_id AND a.message_id=m.id WHERE m.group_id=? AND m.sender_id=? AND m.client_id=?").bind(id, user.id, data.clientId).first();
      if (!row) throw problem("As permiss\xF5es do grupo mudaram.", 403);
      if (row.id === msgId && kind === "external_media") trackKlipyShare(ctx, env, user.id, payload, data.query);
      if (row.id === msgId) {
        const names = [...new Set([...text.matchAll(/(?:^|\s)@([a-z0-9_.-]{2,40})/gi)].map((match) => match[1].toLowerCase()))].slice(0, 20);
        if (names.length) {
          const recipients = await env.DB.prepare(`SELECT u.id FROM users u JOIN social_group_members gm ON gm.user_id=u.id WHERE gm.group_id=? AND u.id<>? AND lower(u.username) IN (${names.map(() => "?").join(",")})`).bind(id, user.id, ...names).all();
          for (const target of recipients.results) {
            try {
              await groupMember(env, id, target.id);
              await notify(env, target.id, user.id, "group_mention", { groupId: id, messageId: row.id, displayName: user.display_name }, `mention:${row.id}:${target.id}`);
            } catch (error) {
              if (!error.status) throw error;
            }
          }
        }
      }
      await emit(env, await groupRecipients(env, id), { type: "group_update", groupId: id });
      return json2(request, { message: groupMessage(row) }, 201);
    }
    const groupReceipt = path.match(/^\/groups\/([^/]+)\/receipt$/);
    const groupUpload = path.match(/^\/groups\/([^/]+)\/attachments$/);
    if (groupUpload && method === "POST") {
      const id = groupUpload[1];
      await groupMember(env, id, user.id);
      await rate(env, user.id, "upload", 12);
      if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data;") || Number(request.headers.get("Content-Length")) > 9 * 1024 * 1024) throw problem("Anexo inv\xE1lido.", 413);
      const form = await request.formData(), file = form.get("file");
      if (!(file instanceof File) || !file.size || file.size > 8 * 1024 * 1024) throw problem("Escolha um arquivo de at\xE9 8 MB.");
      const mime = await attachmentType(file), attachmentId = crypto.randomUUID(), key = `social/${user.id}/${attachmentId}`;
      await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: mime } });
      try {
        await env.DB.prepare("INSERT INTO social_group_attachments(id,group_id,owner_id,media_key,name,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(attachmentId, id, user.id, key, safeText(file.name, 180), mime, file.size, Date.now()).run();
      } catch (error) {
        await env.MEDIA.delete(key);
        throw error;
      }
      return json2(request, { id: attachmentId, name: file.name, mime, size: file.size }, 201);
    }
    const groupAttachment = path.match(/^\/group-attachments\/([^/]+)$/);
    if (groupAttachment && method === "GET") {
      const item = await env.DB.prepare("SELECT * FROM social_group_attachments WHERE id=?").bind(groupAttachment[1]).first();
      if (!item) throw problem("Anexo indispon\xEDvel.", 404);
      await groupMember(env, item.group_id, user.id);
      if (!item.message_id && item.owner_id !== user.id) throw problem("Anexo indispon\xEDvel.", 403);
      const object = await env.MEDIA.get(item.media_key);
      if (!object) throw problem("Anexo indispon\xEDvel.", 404);
      return new Response(object.body, { headers: responseHeaders2(request, { "Content-Type": item.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`, "Content-Security-Policy": "default-src 'none'; sandbox" }) });
    }
    const groupTyping = path.match(/^\/groups\/([^/]+)\/typing$/);
    if (groupTyping && method === "POST") {
      const id = groupTyping[1];
      await groupMember(env, id, user.id);
      await rate(env, user.id, "group_typing", 20);
      const data = await body(request);
      const recipients = [];
      for (const other of await groupRecipients(env, id)) {
        if (other === user.id) continue;
        try {
          await groupMember(env, id, other);
          recipients.push(other);
        } catch {
        }
      }
      await emit(env, recipients, { type: "group_typing", groupId: id, actorId: user.id, displayName: safeText(user.display_name, 80), typing: Boolean(data.typing) });
      return json2(request, { ok: true });
    }
    if (groupReceipt && method === "POST") {
      const id = groupReceipt[1];
      await groupMember(env, id, user.id);
      const data = await body(request);
      const last = await env.DB.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM social_group_messages WHERE group_id=?").bind(id).first();
      const seq = Math.min(last.seq, Math.max(0, Math.floor(Number(data.seq) || 0)));
      await env.DB.prepare("UPDATE social_group_members SET last_read_seq=MAX(last_read_seq,?) WHERE group_id=? AND user_id=?").bind(seq, id, user.id).run();
      return json2(request, { ok: true });
    }
    const groupMessageMatch = path.match(/^\/group-messages\/([^/]+)$/);
    const groupReminder = path.match(/^\/group-messages\/([^/]+)\/reminders$/);
    if (groupReminder && method === "POST") {
      await rate(env, user.id, "reminder", 20, 300);
      const row = await env.DB.prepare("SELECT * FROM social_group_messages WHERE id=? AND deleted_at IS NULL").bind(groupReminder[1]).first();
      if (!row) throw problem("Mensagem indispon\xEDvel.", 404);
      await groupMember(env, row.group_id, user.id);
      const data = await body(request), due = Math.floor(Number(data.dueAt));
      if (!Number.isFinite(due) || due < Date.now() + 3e4 || due > Date.now() + 366 * 864e5) throw problem("Escolha uma data entre 30 segundos e um ano.");
      const reminderId = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO social_group_reminders(id,user_id,message_id,group_id,due_at,created_at) VALUES(?,?,?,?,?,?)").bind(reminderId, user.id, row.id, row.group_id, due, Date.now()).run();
      const actor = env.SOCIAL.getByName(user.id);
      await actor.ensure(user.id);
      await actor.scheduleReminder(due);
      return json2(request, { id: reminderId, dueAt: due }, 201);
    }
    const groupLocation = path.match(/^\/group-messages\/([^/]+)\/location$/);
    if (groupLocation && method === "GET") {
      const row = await env.DB.prepare("SELECT group_id,seq FROM social_group_messages WHERE id=?").bind(groupLocation[1]).first();
      if (!row) throw problem("Mensagem indispon\xEDvel.", 404);
      await groupMember(env, row.group_id, user.id);
      return json2(request, { groupId: row.group_id, seq: row.seq });
    }
    const groupFeatureMatch = path.match(/^\/group-messages\/([^/]+)\/(reaction|pin|favorite)$/);
    if (groupFeatureMatch && ["PUT", "DELETE"].includes(method)) {
      await rate(env, user.id, "group_feature", 60);
      const row = await env.DB.prepare("SELECT * FROM social_group_messages WHERE id=? AND deleted_at IS NULL").bind(groupFeatureMatch[1]).first();
      if (!row) throw problem("Mensagem indispon\xEDvel.", 404);
      await groupMember(env, row.group_id, user.id);
      const feature = groupFeatureMatch[2];
      if (feature === "reaction") {
        const data = await body(request), emoji = String(data.emoji || "");
        if (!await validReaction(env, emoji, method === "DELETE")) throw problem("Rea\xE7\xE3o inv\xE1lida.");
        if (method === "PUT") await env.DB.prepare("INSERT INTO social_group_reactions(message_id,user_id,emoji,is_super) VALUES(?,?,?,?) ON CONFLICT(message_id,user_id,emoji) DO UPDATE SET is_super=excluded.is_super").bind(row.id, user.id, emoji, data.super ? 1 : 0).run();
        else await env.DB.prepare("DELETE FROM social_group_reactions WHERE message_id=? AND user_id=? AND emoji=?").bind(row.id, user.id, emoji).run();
      } else await env.DB.prepare(method === "PUT" ? "INSERT OR IGNORE INTO social_group_marks(message_id,user_id,kind) VALUES(?,?,?)" : "DELETE FROM social_group_marks WHERE message_id=? AND user_id=? AND kind=?").bind(row.id, user.id, feature).run();
      await emit(env, feature === "favorite" ? [user.id] : await groupRecipients(env, row.group_id), { type: "group_update", groupId: row.group_id });
      return json2(request, { ok: true });
    }
    const groupFeatures = path.match(/^\/groups\/([^/]+)\/features$/);
    const groupMarked = path.match(/^\/groups\/([^/]+)\/marked$/);
    if (groupMarked && method === "GET") {
      const id = groupMarked[1];
      await groupMember(env, id, user.id);
      const kind = url.searchParams.get("kind");
      if (!["pin", "favorite"].includes(kind)) throw problem("Filtro inv\xE1lido.");
      const before = Math.max(1, Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER);
      const rows = await env.DB.prepare("SELECT m.*,u.display_name,a.name AS attachment_name,a.mime AS attachment_mime,a.size AS attachment_size FROM social_group_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN social_group_attachments a ON a.id=m.attachment_id AND a.message_id=m.id WHERE m.group_id=? AND m.seq<? AND m.deleted_at IS NULL AND EXISTS(SELECT 1 FROM social_group_marks x WHERE x.message_id=m.id AND x.kind=? AND (x.kind='pin' OR x.user_id=?)) ORDER BY m.seq DESC LIMIT 41").bind(id, before, kind, user.id).all();
      const page = rows.results.slice(0, 40);
      return json2(request, { messages: page.map(groupMessage), hasMore: rows.results.length > 40, nextBefore: page.at(-1)?.seq || null });
    }
    if (groupFeatures && method === "GET") {
      const id = groupFeatures[1];
      await groupMember(env, id, user.id);
      const [reactions, marks] = await Promise.all([env.DB.prepare("SELECT r.message_id,r.user_id,r.emoji,r.is_super FROM social_group_reactions r JOIN social_group_messages m ON m.id=r.message_id WHERE m.group_id=? AND m.deleted_at IS NULL ORDER BY m.seq DESC LIMIT 1000").bind(id).all(), env.DB.prepare("SELECT x.message_id,x.user_id,x.kind FROM social_group_marks x JOIN social_group_messages m ON m.id=x.message_id WHERE m.group_id=? AND m.deleted_at IS NULL AND (x.kind='pin' OR x.user_id=?) ORDER BY m.seq DESC LIMIT 1000").bind(id, user.id).all()]);
      return json2(request, { reactions: reactions.results, marks: marks.results });
    }
    if (groupMessageMatch && ["PUT", "DELETE"].includes(method)) {
      await rate(env, user.id, "edit_group_message", 40);
      const row = await env.DB.prepare("SELECT * FROM social_group_messages WHERE id=? AND sender_id=? AND deleted_at IS NULL").bind(groupMessageMatch[1], user.id).first();
      if (!row) throw problem("Mensagem indispon\xEDvel.", 404);
      await groupMember(env, row.group_id, user.id);
      if (method === "PUT") {
        const data = await body(request), text = safeText(data.text, 4e3);
        if (!text) throw problem("Digite uma mensagem.");
        await env.DB.prepare("UPDATE social_group_messages SET body=?,edited_at=? WHERE id=? AND sender_id=?").bind(text, Date.now(), row.id, user.id).run();
      } else {
        await env.DB.prepare("UPDATE social_group_messages SET body='',deleted_at=? WHERE id=? AND sender_id=?").bind(Date.now(), row.id, user.id).run();
        const attachment = await env.DB.prepare("SELECT media_key FROM social_group_attachments WHERE message_id=?").bind(row.id).first();
        if (attachment) {
          await env.MEDIA.delete(attachment.media_key);
          await env.DB.prepare("DELETE FROM social_group_attachments WHERE message_id=?").bind(row.id).run();
        }
      }
      await emit(env, await groupRecipients(env, row.group_id), { type: "group_update", groupId: row.group_id });
      return json2(request, { ok: true });
    }
    if (path === "/media/search" && method === "GET") {
      await rate(env, user.id, "media_search", 30);
      const provider = url.searchParams.get("provider"), query = safeText(url.searchParams.get("q"), 80).toLowerCase();
      if (provider === "7tv") {
        const data2 = await providerJson("https://7tv.io/v3/emote-sets/global");
        const items2 = (data2.emotes || []).filter((item) => sevenTvId(item.id) && (!query || String(item.name).toLowerCase().includes(query))).slice(0, 80).map((item) => ({ provider: "7tv", id: item.id, name: safeText(item.name, 80), url: `https://cdn.7tv.app/emote/${item.id}/2x.webp` }));
        return json2(request, { items: items2 });
      }
      if (!["gif", "sticker"].includes(provider)) throw problem("Provedor inv\xE1lido.");
      if (!env.KLIPY_API_KEY) throw problem("KLIPY n\xE3o configurado no servidor.", 503);
      const type = provider === "gif" ? "gifs" : "stickers";
      const endpoint = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(env.KLIPY_API_KEY)}/${type}/${query ? "search" : "trending"}`);
      endpoint.searchParams.set("per_page", "24");
      endpoint.searchParams.set("locale", "br");
      endpoint.searchParams.set("customer_id", user.id);
      if (query) endpoint.searchParams.set("q", query);
      const data = await providerJson(endpoint.href);
      const items = (data?.data?.data || []).map((item) => {
        const source = item.file?.sm?.gif?.url || item.file?.md?.gif?.url || item.file?.hd?.gif?.url;
        try {
          const parsed = new URL(source);
          if (parsed.protocol !== "https:" || parsed.hostname !== "static.klipy.com") return null;
          return { provider: "klipy", type: provider, id: safeText(item.slug, 150), name: safeText(item.title, 150), url: parsed.href };
        } catch {
          return null;
        }
      }).filter((item) => item?.id);
      return json2(request, { items });
    }
    if (path === "/ticket" && method === "POST") {
      const ticket = await env.SOCIAL.getByName(user.id).ticket(user.id, user.session_hash, user.session_expires_at);
      return json2(request, { url: `${origin.replace(/^http/, "ws")}/api/social/connect?user=${user.id}&ticket=${ticket}` });
    }
    if (path === "/users" && method === "GET") {
      await rate(env, user.id, "search", 30);
      const q = safeText(url.searchParams.get("q"), 60).replace(/^@/, "").replace(/[\\%_]/g, "\\$&");
      if (q.length < 2) return json2(request, { users: [] });
      const rows = await env.DB.prepare(`SELECT ${columns} FROM users u WHERE (u.username LIKE ? ESCAPE '\\' OR u.display_name COLLATE NOCASE LIKE ? ESCAPE '\\') AND u.id<>?
        AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=? AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?)) ORDER BY u.username LIMIT 25`).bind(`${q}%`, `${q}%`, user.id, user.id, user.id).all();
      return json2(request, { users: rows.results.map((row) => person(row, origin)) });
    }
    const profileMatch = path.match(/^\/profiles\/([^/]+)$/);
    const statsMatch = path.match(/^\/profiles\/([^/]+)\/listening-stats$/);
    if (statsMatch && method === "GET") {
      const target = statsMatch[1];
      await requireFriend(env, user.id, target);
      const rows = await env.DB.prepare("SELECT started_at,ended_at,history_json FROM listening_sessions WHERE ((host_id=? AND guest_id=?) OR (host_id=? AND guest_id=?)) AND started_at IS NOT NULL AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT 1000").bind(user.id, target, target, user.id).all();
      const unique = /* @__PURE__ */ new Set();
      let durationMs = 0, plays = 0;
      for (const row of rows.results) {
        durationMs += Math.max(0, row.ended_at - row.started_at);
        let items = [];
        try {
          items = JSON.parse(row.history_json || "[]");
        } catch {
        }
        for (const item of items) {
          if (item.trackId) {
            unique.add(item.trackId);
            plays++;
          }
        }
      }
      return json2(request, { sessions: rows.results.length, durationMs, plays, uniqueTracks: unique.size, limited: rows.results.length === 1e3 });
    }
    const compatibilityMatch = path.match(/^\/profiles\/([^/]+)\/compatibility$/);
    if (compatibilityMatch && method === "GET") {
      const target = compatibilityMatch[1];
      await requireFriend(env, user.id, target);
      const [mine, theirs] = await Promise.all([settings(env, user.id), settings(env, target)]);
      if (!mine.share_favorites || !theirs.share_favorites) throw problem("Ambos precisam compartilhar favoritos para comparar.", 403);
      const [common, counts, artists] = await Promise.all([
        env.DB.prepare("SELECT t.id,t.title,t.artist FROM user_favorites a JOIN user_favorites b ON b.track_id=a.track_id JOIN tracks t ON t.id=a.track_id WHERE a.user_id=? AND b.user_id=? AND t.import_batch_id IS NULL ORDER BY t.title LIMIT 50").bind(user.id, target).all(),
        env.DB.prepare("SELECT COUNT(*) AS total, COUNT(DISTINCT f.track_id) AS distinct_tracks FROM user_favorites f JOIN tracks t ON t.id=f.track_id WHERE f.user_id IN (?,?) AND t.import_batch_id IS NULL").bind(user.id, target).first(),
        env.DB.prepare("SELECT DISTINCT t.artist FROM user_favorites a JOIN tracks t ON t.id=a.track_id WHERE a.user_id=? AND t.import_batch_id IS NULL AND EXISTS(SELECT 1 FROM user_favorites b JOIN tracks s ON s.id=b.track_id WHERE b.user_id=? AND s.import_batch_id IS NULL AND s.artist=t.artist COLLATE NOCASE) ORDER BY t.artist LIMIT 50").bind(user.id, target).all()
      ]);
      return json2(request, { commonTracks: common.results, commonArtists: artists.results.map((row) => row.artist), commonCount: counts.total - counts.distinct_tracks, unionCount: counts.distinct_tracks, compatibility: counts.distinct_tracks ? Math.round(100 * (counts.total - counts.distinct_tracks) / counts.distinct_tracks) : 0 });
    }
    if (profileMatch && method === "GET") {
      const target = profileMatch[1], relation = await relationship(env, user.id, target);
      if (relation.blocked) throw problem("Perfil indispon\xEDvel.", 403);
      const row = await env.DB.prepare(`SELECT ${columns} FROM users u WHERE u.id=?`).bind(target).first();
      if (!row) throw problem("Perfil n\xE3o encontrado.", 404);
      const prefs = await settings(env, target), showMusic = Boolean(prefs.public_music_profile || target === user.id);
      const publicPlaylists = relation.friends || showMusic ? (await env.DB.prepare("SELECT id,name FROM playlists WHERE added_by=? ORDER BY created_at DESC LIMIT 100").bind(target).all()).results : [];
      const favoriteTracks = showMusic ? (await env.DB.prepare("SELECT t.id,t.title,t.artist,t.album FROM user_favorites f JOIN tracks t ON t.id=f.track_id WHERE f.user_id=? AND t.import_batch_id IS NULL ORDER BY f.created_at DESC LIMIT 50").bind(target).all()).results : [];
      const realtime = env.SOCIAL.getByName(target);
      await realtime.ensure(target);
      return json2(request, {
        ...person(row, origin),
        isFriend: Boolean(relation.friends),
        playlists: publicPlaylists,
        publicMusic: showMusic,
        favorites: favoriteTracks,
        presence: await realtime.publicState(user.id),
        recent: await realtime.recent(user.id)
      });
    }
    const friendMatch = path.match(/^\/friends\/([^/]+)$/);
    if (friendMatch && method === "POST") {
      const target = friendMatch[1];
      if (!uuid2(target) || target === user.id) throw problem("Escolha outro usu\xE1rio.");
      await rate(env, user.id, "friend_requests", 30, 86400);
      const relation = await relationship(env, user.id, target);
      if (relation.blocked || (await settings(env, target)).requests === "none") throw problem("Este usu\xE1rio n\xE3o est\xE1 recebendo solicita\xE7\xF5es.", 403);
      if (relation.friends) return json2(request, { ok: true });
      const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO friend_requests(sender_id,receiver_id,created_at) SELECT ?,id,? FROM users WHERE id=?
        AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?))
        AND COALESCE((SELECT requests FROM user_social_settings WHERE user_id=?),'everyone')='everyone'`).bind(user.id, Date.now(), target, user.id, target, target, user.id, target).run();
      if (inserted.meta.changes) await notify(env, target, user.id, "friend_request", { userId: user.id, displayName: user.display_name });
      await emit(env, [user.id, target], { type: "social_changed" });
      return json2(request, { ok: true });
    }
    const requestMatch = path.match(/^\/requests\/([^/]+)$/);
    if (requestMatch && method === "POST") {
      const other = requestMatch[1], data = await body(request);
      if (!["accept", "decline", "cancel"].includes(data.action)) throw problem("A\xE7\xE3o inv\xE1lida.");
      if (data.action === "accept") {
        const existing = await relationship(env, user.id, other);
        if (existing.blocked) throw problem("Usu\xE1rio bloqueado.", 403);
        if (existing.friends) return json2(request, { ok: true });
        const now = Date.now();
        await env.DB.batch([
          env.DB.prepare(`INSERT OR IGNORE INTO friendships(user_id,friend_id,created_at) SELECT receiver_id,sender_id,? FROM friend_requests WHERE sender_id=? AND receiver_id=? AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?))`).bind(now, other, user.id, other, user.id, user.id, other),
          env.DB.prepare("INSERT OR IGNORE INTO friendships(user_id,friend_id,created_at) SELECT friend_id,user_id,created_at FROM friendships WHERE user_id=? AND friend_id=?").bind(user.id, other),
          env.DB.prepare("DELETE FROM friend_requests WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)").bind(other, user.id, user.id, other)
        ]);
        if (!(await relationship(env, user.id, other)).friends) throw problem("Esta solicita\xE7\xE3o n\xE3o est\xE1 mais dispon\xEDvel.", 409);
        await refreshPeople(env, [user.id, other]);
        await notify(env, other, user.id, "friend_accepted", { userId: user.id, displayName: user.display_name });
      } else {
        await env.DB.prepare("DELETE FROM friend_requests WHERE sender_id=? AND receiver_id=?").bind(data.action === "cancel" ? user.id : other, data.action === "cancel" ? other : user.id).run();
        await emit(env, [user.id, other], { type: "social_changed" });
      }
      return json2(request, { ok: true });
    }
    if (friendMatch && method === "DELETE") {
      const other = friendMatch[1];
      await env.DB.prepare("DELETE FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)").bind(user.id, other, other, user.id).run();
      await stopSessions(env, user.id, other);
      await refreshPeople(env, [user.id, other]);
      return json2(request, { ok: true });
    }
    const blockMatch = path.match(/^\/blocks\/([^/]+)$/);
    if (blockMatch && ["POST", "DELETE"].includes(method)) {
      const other = blockMatch[1];
      if (!uuid2(other) || other === user.id) throw problem("Usu\xE1rio inv\xE1lido.");
      if (method === "POST") {
        await env.DB.batch([
          env.DB.prepare("INSERT OR IGNORE INTO user_blocks(user_id,blocked_id,created_at) SELECT ?,id,? FROM users WHERE id=?").bind(user.id, Date.now(), other),
          env.DB.prepare("DELETE FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)").bind(user.id, other, other, user.id),
          env.DB.prepare("DELETE FROM friend_requests WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)").bind(user.id, other, other, user.id),
          env.DB.prepare("DELETE FROM social_dm_requests WHERE pair_id=?").bind(pairId(user.id, other)),
          env.DB.prepare("DELETE FROM social_notifications WHERE (user_id=? AND actor_id=?) OR (user_id=? AND actor_id=?)").bind(user.id, other, other, user.id)
        ]);
        await stopSessions(env, user.id, other);
      } else await env.DB.prepare("DELETE FROM user_blocks WHERE user_id=? AND blocked_id=?").bind(user.id, other).run();
      await refreshPeople(env, [user.id, other]);
      return json2(request, { ok: true });
    }
    if (path === "/settings" && method === "PUT") {
      const data = await body(request), value = { ...defaults };
      for (const key of ["requests", "messages", "listening_invites", "call_invites", "presence"]) {
        const allowed = key === "requests" ? ["everyone", "none"] : key === "presence" ? ["online", "away", "busy", "invisible"] : ["friends", "none"];
        if (data[key] !== void 0) {
          if (!allowed.includes(data[key])) throw problem("Prefer\xEAncia inv\xE1lida.");
          value[key] = data[key];
        }
      }
      for (const key of ["show_presence", "show_activity", "share_history", "share_favorites", "public_music_profile", "dm_requests", "browser_notifications"]) if (data[key] !== void 0) value[key] = data[key] ? 1 : 0;
      if (data.status_text !== void 0) value.status_text = safeText(data.status_text, 140);
      const keys = Object.keys(defaults).filter((key) => data[key] !== void 0);
      if (keys.length) await env.DB.prepare(`INSERT INTO user_social_settings(user_id,${keys.join(",")}) VALUES(?,${keys.map(() => "?").join(",")}) ON CONFLICT(user_id) DO UPDATE SET ${keys.map((key) => `${key}=excluded.${key}`).join(",")}`).bind(user.id, ...keys.map((key) => value[key])).run();
      await refreshPeople(env, [user.id]);
      if (data.listening_invites === "none") {
        const active = (await env.DB.prepare("SELECT id FROM listening_sessions WHERE (host_id=? OR guest_id=?) AND status IN ('active','pending')").bind(user.id, user.id).all()).results;
        for (const session of active) await env.LISTENING.getByName(session.id).end(user.id);
      }
      return json2(request, { settings: await settings(env, user.id) });
    }
    if (path === "/conversations" && method === "POST") {
      const data = await body(request);
      return json2(request, { id: await openConversation(env, user.id, data.userId) });
    }
    const conversationMatch = path.match(/^\/conversations\/([^/]+)$/);
    if (conversationMatch && method === "PUT") {
      const id = decodeURIComponent(conversationMatch[1]);
      await member(env, id, user.id);
      const data = await body(request);
      const changes = ["muted", "archived", "manual_unread"].filter((key) => data[key] !== void 0);
      if (changes.length) await env.DB.prepare(`UPDATE conversation_members SET ${changes.map((key) => `${key}=?`).join(",")} WHERE conversation_id=? AND user_id=?`).bind(...changes.map((key) => data[key] ? 1 : 0), id, user.id).run();
      await emit(env, [user.id], { type: "social_changed" });
      return json2(request, { ok: true });
    }
    const messagesMatch = path.match(/^\/conversations\/([^/]+)\/messages$/);
    const mediaGallery = path.match(/^\/conversations\/([^/]+)\/media$/);
    if (mediaGallery && method === "GET") {
      const id = decodeURIComponent(mediaGallery[1]);
      await member(env, id, user.id);
      const before = Math.max(1, Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER);
      const rows = await env.DB.prepare("SELECT * FROM messages WHERE conversation_id=? AND seq<? AND deleted_at IS NULL AND (kind='external_media' OR (kind='attachment' AND json_extract(payload_json,'$.mime') LIKE 'image/%')) ORDER BY seq DESC LIMIT 41").bind(id, before).all();
      const page = rows.results.slice(0, 40);
      return json2(request, { messages: page.map(message), hasMore: rows.results.length > 40, nextBefore: page.at(-1)?.seq || null });
    }
    if (messagesMatch && method === "GET") {
      const id = decodeURIComponent(messagesMatch[1]);
      await member(env, id, user.id);
      const before = Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
      const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
      const q = safeText(url.searchParams.get("q"), 120);
      const sender = url.searchParams.get("sender"), kindFilter = url.searchParams.get("kind");
      const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
      let rows;
      if (q.length >= 2 || sender || kindFilter || since) {
        await rate(env, user.id, "message_search", 30);
        const terms = q.length >= 2 ? q.split(/\s+/).map((token) => '"' + token.replaceAll('"', '""') + '"').join(" AND ") : "";
        const scope = id.replaceAll(":", "").replaceAll("-", ""), clauses = ["m.conversation_id=?", "m.deleted_at IS NULL", "m.seq<?"], values = [id, before];
        if (terms) {
          clauses.push("social_message_search MATCH ?");
          values.push(`search_scope : "${scope}" AND body : (${terms})`);
        }
        if (sender === "me") {
          clauses.push("m.sender_id=?");
          values.push(user.id);
        } else if (sender === "other") {
          clauses.push("m.sender_id<>?");
          values.push(user.id);
        }
        if (["text", "track", "album", "playlist", "attachment", "external_media"].includes(kindFilter)) {
          clauses.push("m.kind=?");
          values.push(kindFilter);
        }
        if (since) {
          clauses.push("m.created_at>=?");
          values.push(since);
        }
        rows = await env.DB.prepare(`SELECT m.* FROM messages m ${terms ? "JOIN social_message_search ON m.seq=social_message_search.rowid" : ""} WHERE ${clauses.join(" AND ")} ORDER BY m.seq DESC LIMIT 41`).bind(...values).all();
      } else rows = await env.DB.prepare(`SELECT * FROM messages WHERE conversation_id=? AND seq<? AND seq>? ORDER BY seq ${after ? "ASC" : "DESC"} LIMIT 41`).bind(id, before, after).all();
      const more = rows.results.length > 40, page = rows.results.slice(0, 40);
      if (!after) page.reverse();
      return json2(request, { messages: page.map(message), hasMore: more, nextBefore: page[0]?.seq || null, nextAfter: page.at(-1)?.seq || null });
    }
    if (messagesMatch && method === "POST") {
      const id = decodeURIComponent(messagesMatch[1]), membership = await member(env, id, user.id), peer = membership.peer_id;
      await rate(env, user.id, "send_message", 45);
      if ((await settings(env, peer)).messages !== "friends") throw problem("Este amigo desativou mensagens.", 403);
      const data = await body(request), text = safeText(data.text, 4e3), kind = data.kind || "text";
      if (!uuid2(data.clientId) || !["text", "track", "album", "playlist", "attachment", "external_media", "custom_emoji"].includes(kind)) throw problem("Mensagem inv\xE1lida.");
      const prior = await env.DB.prepare("SELECT * FROM messages WHERE conversation_id=? AND sender_id=? AND client_id=?").bind(id, user.id, data.clientId).first();
      if (prior) return json2(request, { message: message(prior) }, 201);
      await limitRepeatedText(env, user.id, text);
      let payload = {};
      if (kind === "text" && !text) throw problem("Digite uma mensagem.");
      if (kind === "custom_emoji") {
        const emoji = await env.DB.prepare("SELECT id,name,mime,pack,type FROM social_custom_emojis WHERE id=?").bind(String(data.emojiId || "")).first();
        if (!emoji) throw problem("Emoji indispon\xEDvel.", 404);
        payload = { id: emoji.id, name: emoji.name, mime: emoji.mime, pack: emoji.pack, type: emoji.type };
      }
      if (kind === "external_media") {
        const item = data.payload || {};
        if (item.provider === "7tv" && sevenTvId(item.id)) payload = { provider: "7tv", id: item.id, name: safeText(item.name, 80), url: `https://cdn.7tv.app/emote/${item.id}/2x.webp` };
        else if (item.provider === "klipy" && ["gif", "sticker"].includes(item.type) && /^[a-z0-9_-]{1,150}$/i.test(item.id || "")) {
          let parsed;
          try {
            parsed = new URL(item.url);
          } catch {
            throw problem("M\xEDdia inv\xE1lida.");
          }
          if (parsed.protocol !== "https:" || parsed.hostname !== "static.klipy.com" || parsed.username || parsed.password || parsed.port) throw problem("M\xEDdia inv\xE1lida.");
          payload = { provider: "klipy", type: item.type, id: item.id, name: safeText(item.name, 150), url: parsed.href };
        } else throw problem("M\xEDdia inv\xE1lida.");
      }
      if (["track", "album", "playlist"].includes(kind)) {
        const table = { track: "tracks", album: "albums", playlist: "playlists" }[kind];
        const item = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?${kind === "track" ? " AND import_batch_id IS NULL" : ""}`).bind(String(data.itemId || "")).first();
        if (!item) throw problem("Este item n\xE3o est\xE1 mais na biblioteca.", 404);
        payload = { id: item.id, title: item.title || item.name, artist: item.artist || "", kind };
        if (kind === "track" && data.position != null && Number.isFinite(Number(data.position))) payload.position = Math.min(Math.max(0, Number(data.position)), Number(item.duration_seconds) > 0 ? Number(item.duration_seconds) : 86400);
      }
      if (kind === "attachment") {
        const item = await env.DB.prepare("SELECT * FROM social_attachments WHERE id=? AND conversation_id=? AND owner_id=?").bind(String(data.attachmentId || ""), id, user.id).first();
        if (!item || !item.message_id && item.created_at < Date.now() - 864e5) throw problem("Anexo inv\xE1lido ou expirado.", 400);
        if (item.message_id) {
          const existing = await env.DB.prepare("SELECT client_id FROM messages WHERE id=? AND sender_id=?").bind(item.message_id, user.id).first();
          if (existing?.client_id !== data.clientId) throw problem("Este anexo j\xE1 foi enviado.", 409);
        }
        payload = { id: item.id, name: item.name, mime: item.mime, size: item.size };
      }
      const replyTo = data.replyTo || null;
      if (replyTo) {
        const target = await env.DB.prepare("SELECT id FROM messages WHERE id=? AND conversation_id=? AND deleted_at IS NULL").bind(replyTo, id).first();
        if (!target) throw problem("Mensagem respondida indispon\xEDvel.", 404);
      }
      const messageId = crypto.randomUUID(), now = Date.now();
      const selector = "SELECT seq FROM messages WHERE conversation_id=? AND sender_id=? AND client_id=?";
      const selectorArgs = [id, user.id, data.clientId];
      const statements = [
        env.DB.prepare(`INSERT OR IGNORE INTO messages(id,conversation_id,sender_id,client_id,body,kind,payload_json,created_at,reply_to)
          SELECT ?,?,?,?,?,?,?,?,? WHERE ${authorizedSql} AND COALESCE((SELECT messages FROM user_social_settings WHERE user_id=?),'friends')='friends'
          AND (?<>'attachment' OR EXISTS(SELECT 1 FROM social_attachments WHERE id=? AND message_id IS NULL AND created_at>?))`).bind(messageId, id, user.id, data.clientId, text, kind, encode(payload), now, replyTo, ...authBindings(user.id, peer), peer, kind, payload.id || "", now - 864e5),
        env.DB.prepare(`UPDATE conversations SET last_seq=(${selector}),updated_at=? WHERE id=? AND last_seq<COALESCE((${selector}),0)`).bind(...selectorArgs, now, id, ...selectorArgs),
        env.DB.prepare(`UPDATE conversation_members SET unread_count=unread_count+1,last_received_seq=(${selector}),archived=0 WHERE conversation_id=? AND user_id=? AND last_received_seq<COALESCE((${selector}),0)`).bind(...selectorArgs, id, peer, ...selectorArgs),
        env.DB.prepare(`INSERT OR IGNORE INTO social_notifications(id,user_id,actor_id,kind,payload_json,created_at) SELECT 'message:'||id,?,?,'message',?,created_at FROM messages WHERE conversation_id=? AND sender_id=? AND client_id=?`).bind(peer, user.id, encode({ conversationId: id, displayName: user.display_name }), ...selectorArgs)
      ];
      if (kind === "attachment") statements.push(env.DB.prepare(`UPDATE social_attachments SET message_id=(SELECT id FROM messages WHERE conversation_id=? AND sender_id=? AND client_id=?) WHERE id=? AND message_id IS NULL`).bind(...selectorArgs, payload.id));
      await env.DB.batch(statements);
      const row = await env.DB.prepare("SELECT * FROM messages WHERE conversation_id=? AND sender_id=? AND client_id=?").bind(...selectorArgs).first();
      if (!row) throw problem("A amizade ou permiss\xE3o de mensagens mudou.", 403);
      if (row.id === messageId && kind === "external_media") trackKlipyShare(ctx, env, user.id, payload, data.query);
      await emit(env, [user.id, peer], { type: "message", actorId: user.id, message: message(row) });
      return json2(request, { message: message(row) }, 201);
    }
    const featuresMatch = path.match(/^\/conversations\/([^/]+)\/features$/);
    const markedMatch = path.match(/^\/conversations\/([^/]+)\/marked$/);
    if (markedMatch && method === "GET") {
      const id = decodeURIComponent(markedMatch[1]);
      await member(env, id, user.id);
      const kind = url.searchParams.get("kind");
      if (!["pin", "favorite"].includes(kind)) throw problem("Filtro inv\xE1lido.");
      const before = Math.max(1, Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER);
      const rows = await env.DB.prepare("SELECT m.* FROM messages m WHERE m.conversation_id=? AND m.seq<? AND m.deleted_at IS NULL AND EXISTS(SELECT 1 FROM social_message_marks x WHERE x.message_id=m.id AND x.kind=? AND (x.kind='pin' OR x.user_id=?)) ORDER BY m.seq DESC LIMIT 41").bind(id, before, kind, user.id).all();
      const page = rows.results.slice(0, 40);
      return json2(request, { messages: page.map(message), hasMore: rows.results.length > 40, nextBefore: page.at(-1)?.seq || null });
    }
    if (featuresMatch && method === "GET") {
      const id = decodeURIComponent(featuresMatch[1]);
      await member(env, id, user.id);
      const [reactions, marks] = await Promise.all([
        env.DB.prepare("SELECT r.message_id,r.user_id,r.emoji,r.is_super FROM social_message_reactions r JOIN messages m ON m.id=r.message_id WHERE m.conversation_id=? AND m.deleted_at IS NULL ORDER BY m.seq DESC LIMIT 1000").bind(id).all(),
        env.DB.prepare(`SELECT x.message_id,x.user_id,x.kind FROM social_message_marks x JOIN messages m ON m.id=x.message_id WHERE m.conversation_id=? AND m.deleted_at IS NULL AND (x.kind='pin' OR x.user_id=?) ORDER BY m.seq DESC LIMIT 1000`).bind(id, user.id).all()
      ]);
      return json2(request, { reactions: reactions.results, marks: marks.results });
    }
    const featureMatch = path.match(/^\/messages\/([^/]+)\/(reaction|pin|favorite)$/);
    if (featureMatch && (method === "PUT" || method === "DELETE")) {
      await rate(env, user.id, "message_feature", 60);
      const row = await env.DB.prepare("SELECT * FROM messages WHERE id=? AND deleted_at IS NULL").bind(featureMatch[1]).first();
      if (!row) throw problem("Mensagem indispon\xEDvel.", 404);
      const membership = await member(env, row.conversation_id, user.id), feature = featureMatch[2];
      if (feature === "reaction") {
        const data = await body(request), emoji = String(data.emoji || "");
        if (!await validReaction(env, emoji, method === "DELETE")) throw problem("Rea\xE7\xE3o inv\xE1lida.");
        if (method === "PUT") await env.DB.prepare("INSERT INTO social_message_reactions(message_id,user_id,emoji,is_super) VALUES(?,?,?,?) ON CONFLICT(message_id,user_id,emoji) DO UPDATE SET is_super=excluded.is_super").bind(row.id, user.id, emoji, data.super ? 1 : 0).run();
        else await env.DB.prepare("DELETE FROM social_message_reactions WHERE message_id=? AND user_id=? AND emoji=?").bind(row.id, user.id, emoji).run();
      } else if (method === "PUT") await env.DB.prepare("INSERT OR IGNORE INTO social_message_marks(message_id,user_id,kind) VALUES(?,?,?)").bind(row.id, user.id, feature).run();
      else await env.DB.prepare("DELETE FROM social_message_marks WHERE message_id=? AND user_id=? AND kind=?").bind(row.id, user.id, feature).run();
      await emit(env, feature === "favorite" ? [user.id] : [user.id, membership.peer_id], { type: "message_features", conversationId: row.conversation_id });
      return json2(request, { ok: true });
    }
    const receiptMatch = path.match(/^\/conversations\/([^/]+)\/receipt$/);
    if (receiptMatch && method === "POST") {
      const id = decodeURIComponent(receiptMatch[1]), membership = await member(env, id, user.id), data = await body(request);
      const last = await env.DB.prepare("SELECT last_seq FROM conversations WHERE id=?").bind(id).first();
      const seq = Math.min(last.last_seq, Math.max(0, Math.floor(Number(data.seq) || 0)));
      await env.DB.prepare(`UPDATE conversation_members SET last_delivered_seq=MAX(last_delivered_seq,?),last_read_seq=MAX(last_read_seq,?),manual_unread=CASE WHEN ? THEN 0 ELSE manual_unread END,
        unread_count=(SELECT COUNT(*) FROM messages WHERE conversation_id=? AND sender_id<>? AND seq>MAX(conversation_members.last_read_seq,?)) WHERE conversation_id=? AND user_id=?`).bind(seq, data.read ? seq : 0, data.read ? 1 : 0, id, user.id, data.read ? seq : 0, id, user.id).run();
      const updated = await env.DB.prepare("SELECT last_read_seq,last_delivered_seq FROM conversation_members WHERE conversation_id=? AND user_id=?").bind(id, user.id).first();
      if (data.read) await env.DB.prepare("UPDATE social_notifications SET read_at=? WHERE user_id=? AND kind='message' AND json_extract(payload_json,'$.conversationId')=? AND read_at IS NULL").bind(Date.now(), user.id, id).run();
      await emit(env, [user.id, membership.peer_id], { type: "receipt", actorId: user.id, conversationId: id, readSeq: updated.last_read_seq, deliveredSeq: updated.last_delivered_seq });
      return json2(request, { ok: true });
    }
    const locateMatch = path.match(/^\/messages\/([^/]+)\/location$/);
    if (locateMatch && method === "GET") {
      const row = await env.DB.prepare("SELECT * FROM messages WHERE id=?").bind(locateMatch[1]).first();
      if (!row) throw problem("Mensagem indispon\xEDvel.", 404);
      await member(env, row.conversation_id, user.id);
      const rows = await env.DB.prepare("SELECT * FROM messages WHERE conversation_id=? AND seq<=? ORDER BY seq DESC LIMIT 40").bind(row.conversation_id, row.seq).all();
      return json2(request, { conversationId: row.conversation_id, message: message(row), messages: rows.results.reverse().map(message) });
    }
    const messageMatch = path.match(/^\/messages\/([^/]+)$/);
    const reminderMatch = path.match(/^\/messages\/([^/]+)\/reminders$/);
    if (reminderMatch && method === "POST") {
      await rate(env, user.id, "reminder", 20, 300);
      const row = await env.DB.prepare("SELECT * FROM messages WHERE id=? AND deleted_at IS NULL").bind(reminderMatch[1]).first();
      if (!row) throw problem("Mensagem indispon\xEDvel.", 404);
      await member(env, row.conversation_id, user.id);
      const data = await body(request), due = Math.floor(Number(data.dueAt));
      if (!Number.isFinite(due) || due < Date.now() + 3e4 || due > Date.now() + 366 * 864e5) throw problem("Escolha uma data entre 30 segundos e um ano.");
      const reminderId = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO social_reminders(id,user_id,message_id,conversation_id,due_at,created_at) VALUES(?,?,?,?,?,?)").bind(reminderId, user.id, row.id, row.conversation_id, due, Date.now()).run();
      const actor = env.SOCIAL.getByName(user.id);
      await actor.ensure(user.id);
      await actor.scheduleReminder(due);
      return json2(request, { id: reminderId, dueAt: due }, 201);
    }
    if (path === "/reminders" && method === "GET") {
      const [rows, groups] = await Promise.all([env.DB.prepare("SELECT id,message_id,conversation_id,due_at FROM social_reminders WHERE user_id=? AND delivered_at IS NULL ORDER BY due_at LIMIT 100").bind(user.id).all(), env.DB.prepare("SELECT id,message_id,group_id,due_at FROM social_group_reminders WHERE user_id=? AND delivered_at IS NULL ORDER BY due_at LIMIT 100").bind(user.id).all()]);
      return json2(request, { reminders: rows.results, groupReminders: groups.results });
    }
    const reminderDelete = path.match(/^\/reminders\/([^/]+)$/);
    if (reminderDelete && method === "DELETE") {
      await env.DB.prepare("DELETE FROM social_reminders WHERE id=? AND user_id=?").bind(reminderDelete[1], user.id).run();
      return json2(request, { ok: true });
    }
    const groupReminderDelete = path.match(/^\/group-reminders\/([^/]+)$/);
    if (groupReminderDelete && method === "DELETE") {
      await env.DB.prepare("DELETE FROM social_group_reminders WHERE id=? AND user_id=?").bind(groupReminderDelete[1], user.id).run();
      return json2(request, { ok: true });
    }
    if (messageMatch && ["PUT", "DELETE"].includes(method)) {
      await rate(env, user.id, "edit_message", 40);
      const row = await env.DB.prepare("SELECT * FROM messages WHERE id=? AND sender_id=?").bind(messageMatch[1], user.id).first();
      if (!row || row.deleted_at) throw problem("Mensagem indispon\xEDvel.", 404);
      const membership = await member(env, row.conversation_id, user.id);
      if (method === "PUT") {
        const data = await body(request), text = safeText(data.text, 4e3);
        if (!text) throw problem("Digite uma mensagem.");
        await env.DB.prepare("UPDATE messages SET body=?,edited_at=? WHERE id=? AND sender_id=?").bind(text, Date.now(), row.id, user.id).run();
      } else {
        await env.DB.prepare("UPDATE messages SET body='',payload_json='{}',kind='text',deleted_at=? WHERE id=? AND sender_id=?").bind(Date.now(), row.id, user.id).run();
        const attachments = (await env.DB.prepare("SELECT media_key FROM social_attachments WHERE message_id=?").bind(row.id).all()).results;
        for (const item of attachments) await env.MEDIA.delete(item.media_key);
        await env.DB.prepare("DELETE FROM social_attachments WHERE message_id=?").bind(row.id).run();
      }
      const updated = await env.DB.prepare("SELECT * FROM messages WHERE id=?").bind(row.id).first();
      await emit(env, [user.id, membership.peer_id], { type: "message", actorId: user.id, message: message(updated) });
      return json2(request, { message: message(updated) });
    }
    if (path === "/attachments" && method === "POST") {
      await rate(env, user.id, "upload", 12);
      const id = String(url.searchParams.get("conversation") || "");
      await member(env, id, user.id);
      if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data;")) throw problem("Envie o anexo como formul\xE1rio multipart.");
      if (Number(request.headers.get("Content-Length")) > 9 * 1024 * 1024) throw problem("Anexos podem ter at\xE9 8 MB.", 413);
      const form = await request.formData(), file = form.get("file");
      if (!(file instanceof File) || !file.size || file.size > 8 * 1024 * 1024) throw problem("Escolha um arquivo de at\xE9 8 MB.", 413);
      const mime = await attachmentType(file), attachmentId = crypto.randomUUID(), key = `social/${user.id}/${attachmentId}`;
      await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: mime } });
      try {
        await env.DB.prepare("INSERT INTO social_attachments(id,conversation_id,owner_id,media_key,name,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(attachmentId, id, user.id, key, safeText(file.name, 180), mime, file.size, Date.now()).run();
      } catch (error) {
        await env.MEDIA.delete(key);
        throw error;
      }
      return json2(request, { id: attachmentId, name: file.name, mime, size: file.size }, 201);
    }
    const attachmentMatch = path.match(/^\/attachments\/([^/]+)$/);
    if (attachmentMatch && method === "GET") {
      const item = await env.DB.prepare("SELECT * FROM social_attachments WHERE id=?").bind(attachmentMatch[1]).first();
      if (!item) throw problem("Anexo indispon\xEDvel.", 404);
      await member(env, item.conversation_id, user.id);
      if (!item.message_id && item.owner_id !== user.id) throw problem("Anexo indispon\xEDvel.", 403);
      const object = await env.MEDIA.get(item.media_key);
      if (!object) throw problem("Anexo indispon\xEDvel.", 404);
      return new Response(object.body, { headers: responseHeaders2(request, {
        "Content-Type": item.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
        "Content-Security-Policy": "default-src 'none'; sandbox"
      }) });
    }
    if (path === "/notifications/read" && method === "POST") {
      const data = await body(request);
      if (data.id) await env.DB.prepare("UPDATE social_notifications SET read_at=? WHERE id=? AND user_id=?").bind(Date.now(), String(data.id), user.id).run();
      else await env.DB.prepare("UPDATE social_notifications SET read_at=? WHERE user_id=? AND read_at IS NULL").bind(Date.now(), user.id).run();
      await emit(env, [user.id], { type: "social_changed" });
      return json2(request, { ok: true });
    }
    if (path === "/listen" && method === "POST") {
      await rate(env, user.id, "listen_invite", 10, 300);
      const data = await body(request);
      await requireFriend(env, user.id, data.userId);
      if ((await settings(env, data.userId)).listening_invites !== "friends") throw problem("Este amigo desativou convites.", 403);
      if (!await env.DB.prepare("SELECT id FROM tracks WHERE id=? AND import_batch_id IS NULL").bind(String(data.trackId || "")).first()) throw problem("Selecione uma m\xFAsica dispon\xEDvel.");
      await stopSessions(env, user.id, data.userId);
      const id = crypto.randomUUID(), now = Date.now();
      const session = { id, hostId: user.id, guestId: data.userId, trackId: data.trackId, mode: data.mode === "discovery" ? "discovery" : "listening", expiresAt: now + 3e5 };
      await env.DB.prepare("INSERT INTO listening_sessions(id,host_id,guest_id,created_at,expires_at) VALUES(?,?,?,?,?)").bind(id, user.id, data.userId, now, session.expiresAt).run();
      await env.LISTENING.getByName(id).create(session);
      await notify(env, data.userId, user.id, "listening_invite", { ...session, displayName: user.display_name });
      return json2(request, { session }, 201);
    }
    if (path === "/listen/history" && method === "GET") {
      const rows = await env.DB.prepare(`SELECT l.*,u.display_name AS peer_name FROM listening_sessions l JOIN users u ON u.id=CASE WHEN l.host_id=? THEN l.guest_id ELSE l.host_id END WHERE (l.host_id=? OR l.guest_id=?) AND l.started_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=l.host_id AND b.blocked_id=l.guest_id) OR (b.user_id=l.guest_id AND b.blocked_id=l.host_id)) ORDER BY l.started_at DESC LIMIT 50`).bind(user.id, user.id, user.id).all();
      return json2(request, { sessions: rows.results.map((row) => ({ id: row.id, peerName: row.peer_name, peerId: row.host_id === user.id ? row.guest_id : row.host_id, startedAt: row.started_at, endedAt: row.ended_at, tracks: JSON.parse(row.history_json || "[]") })) });
    }
    const queueMatch = path.match(/^\/listen\/([^/]+)\/(queue|next)$/);
    if (queueMatch && method === "POST") {
      await rate(env, user.id, "listen_queue", 40);
      const room = env.LISTENING.getByName(queueMatch[1]);
      if (queueMatch[2] === "queue") {
        const data = await body(request);
        return json2(request, { session: await room.enqueue(user.id, String(data.trackId || "")) });
      }
      return json2(request, { session: await room.next(user.id) });
    }
    const listenMatch = path.match(/^\/listen\/([^/]+)$/);
    if (listenMatch && ["GET", "POST", "DELETE"].includes(method)) {
      const room = env.LISTENING.getByName(listenMatch[1]);
      if (method === "POST") return json2(request, { session: await room.join(user.id) });
      if (method === "DELETE") {
        await room.end(user.id);
        return json2(request, { ok: true });
      }
      return json2(request, { session: await room.snapshot(user.id) });
    }
    if (path === "/call" && method === "POST") {
      await rate(env, user.id, "call", 6, 300);
      const data = await body(request);
      await requireFriend(env, user.id, data.userId);
      if ((await settings(env, data.userId)).call_invites !== "friends") throw problem("Este amigo n\xE3o est\xE1 recebendo chamadas.", 403);
      const callId = crypto.randomUUID();
      await emit(env, [data.userId], { type: "call", actorId: user.id, callId, signal: { type: "invite", video: Boolean(data.video) } });
      return json2(request, { callId, iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, ...parseIce(env.SOCIAL_TURN_SERVERS)] });
    }
    if (path === "/call/config" && method === "GET") return json2(request, { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, ...parseIce(env.SOCIAL_TURN_SERVERS)] });
    if (path === "/reports" && method === "POST") {
      await rate(env, user.id, "report", 5, 3600);
      const data = await body(request), reason = safeText(data.reason, 2e3);
      if (!uuid2(data.userId) || data.userId === user.id || reason.length < 8) throw problem("Descreva o ocorrido com pelo menos 8 caracteres.");
      let evidence = {};
      if (data.messageId) {
        const row = await env.DB.prepare("SELECT m.* FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id WHERE m.id=? AND cm.user_id=? AND m.sender_id=?").bind(data.messageId, user.id, data.userId).first();
        if (!row) throw problem("Mensagem indispon\xEDvel para den\xFAncia.", 403);
        evidence = message(row);
      }
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO social_reports(id,reporter_id,target_id,message_id,reason,evidence_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(id, user.id, data.userId, data.messageId || null, reason, encode(evidence), Date.now()).run();
      return json2(request, { id, ok: true }, 201);
    }
    return json2(request, { error: "Rota social n\xE3o encontrada." }, 404);
  } catch (error) {
    if (!error.status) console.error(JSON.stringify({ event: "social_api_error", path, message: String(error) }));
    return json2(request, { error: error.status ? error.message : "N\xE3o foi poss\xEDvel concluir a a\xE7\xE3o social." }, error.status || 500);
  }
}
__name(socialRoutes, "socialRoutes");
var encode = /* @__PURE__ */ __name((value) => JSON.stringify(value), "encode");
function parseIce(value) {
  try {
    const rows = JSON.parse(value || "[]");
    return Array.isArray(rows) ? rows.slice(0, 4) : [];
  } catch {
    return [];
  }
}
__name(parseIce, "parseIce");
async function cleanupSocial(env) {
  const rows = (await env.DB.prepare("SELECT id,media_key FROM social_attachments WHERE message_id IS NULL AND created_at<? ORDER BY created_at LIMIT 100").bind(Date.now() - 864e5).all()).results;
  for (const row of rows) {
    await env.MEDIA.delete(row.media_key);
    await env.DB.prepare("DELETE FROM social_attachments WHERE id=? AND message_id IS NULL").bind(row.id).run();
  }
  const groupRows = (await env.DB.prepare("SELECT id,media_key FROM social_group_attachments WHERE message_id IS NULL AND created_at<? ORDER BY created_at LIMIT 100").bind(Date.now() - 864e5).all()).results;
  for (const row of groupRows) {
    await env.MEDIA.delete(row.media_key);
    await env.DB.prepare("DELETE FROM social_group_attachments WHERE id=? AND message_id IS NULL").bind(row.id).run();
  }
  await env.DB.prepare("DELETE FROM social_notifications WHERE created_at<? AND read_at IS NOT NULL").bind(Date.now() - 30 * 864e5).run();
  await env.DB.batch([env.DB.prepare("DELETE FROM social_lastfm_pending WHERE expires_at<?").bind(Date.now()), env.DB.prepare("DELETE FROM social_lastfm_scrobbles WHERE created_at<?").bind(Date.now() - 30 * 864e5)]);
}
__name(cleanupSocial, "cleanupSocial");

// src/social-realtime.js
import { DurableObject } from "cloudflare:workers";
var ACTIVE_FOR = 95e3;
var encode2 = /* @__PURE__ */ __name((value) => JSON.stringify(value), "encode");
var SocialUser = class extends DurableObject {
  static {
    __name(this, "SocialUser");
  }
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS limits(scope TEXT PRIMARY KEY,start INTEGER NOT NULL,total INTEGER NOT NULL)");
    this.config = this.get("config");
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }
  get(key) {
    return parse(this.sql.exec("SELECT value FROM state WHERE key=?", key).toArray()[0]?.value);
  }
  put(key, value) {
    this.sql.exec("INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, encode2(value));
  }
  async ensure(id) {
    if (!this.config?.id) await this.refresh(id);
  }
  async profileUpdated(id) {
    await this.refresh(id);
    await Promise.all((this.config.friends || []).map((friend) => this.env.SOCIAL.getByName(friend).deliver({ type: "social_changed" })));
  }
  async refresh(id) {
    const next = (this.refreshing || Promise.resolve()).catch(() => {
    }).then(() => this.refreshNow(id));
    this.refreshing = next;
    return next;
  }
  async refreshNow(id) {
    const [profile, contacts, preferences, dmPeers] = await this.env.DB.batch([
      this.env.DB.prepare("SELECT id,username,display_name,avatar_key FROM users WHERE id=?").bind(id),
      this.env.DB.prepare(`SELECT f.friend_id FROM friendships f WHERE f.user_id=?
        AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=f.user_id AND b.blocked_id=f.friend_id) OR (b.user_id=f.friend_id AND b.blocked_id=f.user_id))`).bind(id),
      this.env.DB.prepare("SELECT * FROM user_social_settings WHERE user_id=?").bind(id),
      this.env.DB.prepare("SELECT CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END AS peer_id FROM social_dm_requests WHERE (sender_id=? OR receiver_id=?) AND status='accepted' AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=sender_id AND b.blocked_id=receiver_id) OR (b.user_id=receiver_id AND b.blocked_id=sender_id))").bind(id, id, id)
    ]);
    if (!profile.results[0]) {
      for (const ws of this.ctx.getWebSockets()) ws.close(4001, "Conta indispon\xEDvel");
      return;
    }
    const before = this.config?.friends || [];
    this.config = { ...profile.results[0], friends: contacts.results.map((row) => row.friend_id), dmPeers: dmPeers.results.map((row) => row.peer_id), settings: { ...defaults, ...preferences.results[0] } };
    this.put("config", this.config);
    const removed = before.filter((friend) => !this.config.friends.includes(friend));
    for (const friend of removed) this.sql.exec("DELETE FROM state WHERE key=?", `peer:${friend}`);
    if (!this.config.settings.share_history || !this.config.settings.show_activity) this.put("history", []);
    this.broadcast({ type: "social_changed", removed: removed.filter((friend) => !this.config.dmPeers.includes(friend)), settings: this.config.settings });
    await Promise.all(removed.map((friend) => this.env.SOCIAL.getByName(friend).forget(id)));
    await this.announce();
  }
  consume(scope, limit, seconds) {
    const start = Math.floor(Date.now() / (seconds * 1e3));
    const row = this.sql.exec("SELECT start,total FROM limits WHERE scope=?", scope).toArray()[0];
    const total = row?.start === start ? row.total + 1 : 1;
    if (total > limit) return false;
    this.sql.exec("INSERT INTO limits(scope,start,total) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET start=excluded.start,total=excluded.total", scope, start, total);
    return true;
  }
  async schedule(delay) {
    const deadline = Date.now() + delay, previous = await this.ctx.storage.getAlarm();
    if (previous == null || previous > deadline) await this.ctx.storage.setAlarm(deadline);
  }
  async scheduleReminder(due) {
    await this.schedule(Math.max(0, due - Date.now()));
  }
  async ticket(id, sessionHash, expiresAt) {
    await this.ensure(id);
    if (this.get(`revoked:${sessionHash}`).at) throw problem("Sess\xE3o encerrada.", 401);
    if (!this.consume("ticket", 20, 60)) throw problem("Aguarde antes de reconectar.", 429);
    const ticket = crypto.randomUUID();
    this.put(`ticket:${ticket}`, { sessionHash, userId: id, expiresAt: Date.parse(expiresAt.replace(" ", "T") + "Z"), deadline: Date.now() + 6e4 });
    await this.schedule(6e4);
    return ticket;
  }
  async fetch(request) {
    const url = new URL(request.url), key = `ticket:${url.searchParams.get("ticket")}`;
    const ticket = this.get(key);
    this.sql.exec("DELETE FROM state WHERE key=?", key);
    if (!ticket.userId || ticket.deadline < Date.now() || ticket.expiresAt <= Date.now() || this.get(`revoked:${ticket.sessionHash}`).at) return new Response("Ticket expirado", { status: 401 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket obrigat\xF3rio", { status: 426 });
    if (this.ctx.getWebSockets().filter((ws) => ws.readyState === 1).length >= 12) return new Response("Muitas conex\xF5es", { status: 429 });
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    server.serializeAttachment({ ...ticket, lastActive: Date.now(), origin: url.origin, presence: "online", activity: null });
    this.ctx.acceptWebSocket(server, [ticket.sessionHash]);
    server.send(encode2({ type: "ready", serverTime: Date.now(), presence: this.snapshot(), settings: this.config.settings }));
    await this.announce();
    return new Response(null, { status: 101, webSocket: client });
  }
  broadcast(event) {
    const data = encode2({ ...event, serverTime: Date.now() });
    for (const socket of this.ctx.getWebSockets()) {
      const identity = socket.deserializeAttachment();
      if (identity.expiresAt <= Date.now()) {
        socket.close(4001, "Sess\xE3o expirada");
        continue;
      }
      try {
        socket.send(data);
      } catch {
        socket.close(1011, "Reconecte");
      }
    }
  }
  deliver(event) {
    if (event.actorId && event.actorId !== this.config.id && ["message", "typing", "receipt", "call"].includes(event.type) && !this.config.friends?.includes(event.actorId) && !(event.type !== "call" && this.config.dmPeers?.includes(event.actorId))) return false;
    this.broadcast(event);
    return true;
  }
  forget(id) {
    this.sql.exec("DELETE FROM state WHERE key=?", `peer:${id}`);
    this.broadcast({ type: "presence", userId: id, value: { status: "offline", activity: null, hidden: true } });
  }
  receivePresence(id, value) {
    if (!this.config.friends?.includes(id)) return;
    this.put(`peer:${id}`, value);
    this.broadcast({ type: "presence", userId: id, value });
  }
  ownState() {
    const prefs = this.config.settings || defaults;
    const clients = this.ctx.getWebSockets().filter((ws) => ws.readyState === 1).map((ws) => ws.deserializeAttachment()).filter((c) => c.expiresAt > Date.now() && c.lastActive > Date.now() - ACTIVE_FOR);
    const playing = clients.filter((c) => c.activity?.playing).sort((a, b) => b.activity.changedAt - a.activity.changedAt)[0];
    const active = playing || clients.sort((a, b) => b.lastActive - a.lastActive)[0];
    const hidden = !prefs.show_presence || prefs.presence === "invisible";
    return {
      status: hidden || !active ? "offline" : prefs.presence === "online" ? clients.some((c) => c.presence === "online") ? "online" : "away" : prefs.presence,
      hidden,
      statusText: prefs.status_text,
      activity: active && prefs.show_activity && !hidden ? active.activity : null,
      updatedAt: Date.now(),
      lastSeen: hidden ? null : active?.lastActive || this.get("lastSeen").at || null
    };
  }
  snapshot() {
    const result = {};
    for (const id of this.config.friends || []) {
      const value = this.get(`peer:${id}`);
      result[id] = value.updatedAt > Date.now() - ACTIVE_FOR ? value : { ...value, status: "offline", activity: null };
    }
    return result;
  }
  async publicState(viewer) {
    if (!this.config.friends?.includes(viewer)) return { status: "offline", activity: null };
    return this.ownState();
  }
  async recent(viewer) {
    if (!this.config.friends?.includes(viewer) || !this.config.settings.share_history || !this.config.settings.show_activity || !this.config.settings.show_presence || this.config.settings.presence === "invisible") return [];
    const rows = this.get("history");
    return Array.isArray(rows) ? rows : [];
  }
  async announce() {
    if (!this.config.id) return;
    const value = this.ownState();
    this.broadcast({ type: "self_presence", value });
    const friends = this.config.friends || [];
    for (let i = 0; i < friends.length; i += 20) await Promise.all(friends.slice(i, i + 20).map((id) => this.env.SOCIAL.getByName(id).receivePresence(this.config.id, value)));
  }
  async resolveTrack(id, origin) {
    const cached2 = this.get("track");
    if (cached2.id === id) return cached2;
    const row = await this.env.DB.prepare(`SELECT t.id,t.title,t.artist,t.album,t.duration_seconds,t.cover_key,t.metadata_json,a.cover_key AS album_cover_key,a.cover_url
      FROM tracks t LEFT JOIN albums a ON a.id=t.primary_album_id WHERE t.id=? AND t.import_batch_id IS NULL`).bind(id).first();
    if (!row) return null;
    const metadata2 = parse(row.metadata_json);
    const media = /* @__PURE__ */ __name((key) => key ? `${origin}/api/media/${encodeURIComponent(key)}` : "", "media");
    const track = {
      id: row.id,
      title: row.title,
      artist: row.artist,
      album: row.album,
      seconds: row.duration_seconds,
      cover: metadata2.coverMode === "album" ? media(row.album_cover_key) || row.cover_url || metadata2.coverUrl || media(row.cover_key) : metadata2.coverUrl || media(row.cover_key) || media(row.album_cover_key) || row.cover_url || ""
    };
    this.put("track", track);
    return track;
  }
  async webSocketMessage(ws, input) {
    const identity = ws.deserializeAttachment();
    if (!identity || identity.expiresAt <= Date.now()) {
      ws.close(4001, "Sess\xE3o expirada");
      return;
    }
    if (typeof input !== "string" || input.length > 32e3 || !this.consume("socket", 120, 60)) {
      ws.send(encode2({ type: "error", error: "Limite de mensagens em tempo real." }));
      return;
    }
    try {
      const event = JSON.parse(input);
      if (event.type === "presence") {
        if (!this.consume("presence", 20, 60)) return;
        identity.lastActive = Date.now();
        identity.presence = event.away ? "away" : "online";
        if (this.config.settings.show_activity && event.trackId) {
          const track = await this.resolveTrack(String(event.trackId), identity.origin);
          identity.activity = track ? { track, playing: Boolean(event.playing), position: Math.min(track.seconds || 86400, Math.max(0, Number(event.position) || 0)), updatedAt: Date.now(), changedAt: Math.min(Date.now(), Number(event.changedAt) || Date.now()) } : null;
          if (track && event.playing && this.config.settings.share_history) {
            const history = this.get("history");
            const rows = Array.isArray(history) ? history : [];
            if (rows[0]?.track.id !== track.id) this.put("history", [{ track, at: Date.now() }, ...rows].slice(0, 20));
          }
        } else identity.activity = null;
        ws.serializeAttachment(identity);
        this.put("lastSeen", { at: Date.now() });
        await this.schedule(ACTIVE_FOR);
        await this.announce();
      } else if (event.type === "typing") {
        if (!(this.config.friends.includes(event.peerId) || this.config.dmPeers?.includes(event.peerId)) || event.conversationId !== pairId(identity.userId, event.peerId) || !this.consume("typing", 20, 60)) return;
        await this.env.SOCIAL.getByName(event.peerId).deliver({ type: "typing", actorId: identity.userId, conversationId: event.conversationId, typing: Boolean(event.typing) });
      } else if (event.type === "listen_control" && typeof event.sessionId === "string") {
        if (!this.consume("listen_control", 45, 60)) return;
        await this.env.LISTENING.getByName(event.sessionId).control(identity.userId, event);
      } else if (event.type === "call_signal") {
        if (!uuid2(event.callId) || !this.config.friends.includes(event.peerId) || !["accept", "offer", "answer", "ice", "hangup"].includes(event.signal?.type)) return;
        const remote = this.env.SOCIAL.getByName(event.peerId);
        await remote.callSignal(identity.userId, event.callId, event.signal);
      }
    } catch (error) {
      ws.send(encode2({ type: "error", error: error.status ? error.message : "N\xE3o foi poss\xEDvel concluir a a\xE7\xE3o em tempo real." }));
    }
  }
  callSignal(sender, callId, signal) {
    if (!this.config.friends?.includes(sender) || this.config.settings.call_invites !== "friends") return;
    this.broadcast({ type: "call", actorId: sender, callId, signal });
  }
  async revoke(hash) {
    this.put(`revoked:${hash}`, { at: Date.now() });
    for (const ws of this.ctx.getWebSockets(hash)) ws.close(4001, "Sess\xE3o encerrada");
    await this.announce();
  }
  async webSocketClose(ws, code) {
    ws.close(code === 1006 ? 1e3 : code, "Desconectado");
    await this.announce();
  }
  async webSocketError(ws) {
    ws.close(1011, "Reconecte");
    await this.announce();
  }
  async alarm() {
    if (this.config?.id) {
      const due = await this.env.DB.prepare("SELECT * FROM social_reminders WHERE user_id=? AND delivered_at IS NULL AND due_at<=? ORDER BY due_at LIMIT 100").bind(this.config.id, Date.now()).all();
      for (const reminder of due.results) {
        let allowed = true;
        try {
          await member(this.env, reminder.conversation_id, this.config.id);
          if (!await this.env.DB.prepare("SELECT id FROM messages WHERE id=? AND deleted_at IS NULL").bind(reminder.message_id).first()) allowed = false;
        } catch {
          allowed = false;
        }
        if (allowed) {
          const payload = { conversationId: reminder.conversation_id, messageId: reminder.message_id, displayName: "Lembrete" };
          const id = `reminder:${reminder.id}`, at = Date.now();
          const inserted = await this.env.DB.prepare("INSERT OR IGNORE INTO social_notifications(id,user_id,actor_id,kind,payload_json,created_at) VALUES(?,?,NULL,'reminder',?,?)").bind(id, this.config.id, encode2(payload), at).run();
          if (inserted.meta.changes) this.broadcast({ type: "notification", id, actorId: null, kind: "reminder", payload, createdAt: at });
        }
        await this.env.DB.prepare("UPDATE social_reminders SET delivered_at=? WHERE id=? AND user_id=?").bind(Date.now(), reminder.id, this.config.id).run();
      }
      const next = await this.env.DB.prepare("SELECT MIN(due_at) AS due FROM social_reminders WHERE user_id=? AND delivered_at IS NULL").bind(this.config.id).first();
      if (next?.due) await this.scheduleReminder(next.due);
      const groupDue = await this.env.DB.prepare("SELECT * FROM social_group_reminders WHERE user_id=? AND delivered_at IS NULL AND due_at<=? ORDER BY due_at LIMIT 100").bind(this.config.id, Date.now()).all();
      for (const reminder of groupDue.results) {
        let allowed = true;
        try {
          await groupMember(this.env, reminder.group_id, this.config.id);
          if (!await this.env.DB.prepare("SELECT id FROM social_group_messages WHERE id=? AND deleted_at IS NULL").bind(reminder.message_id).first()) allowed = false;
        } catch {
          allowed = false;
        }
        if (allowed) {
          const payload = { groupId: reminder.group_id, messageId: reminder.message_id, displayName: "Lembrete" }, id = `group-reminder:${reminder.id}`, at = Date.now();
          const inserted = await this.env.DB.prepare("INSERT OR IGNORE INTO social_notifications(id,user_id,actor_id,kind,payload_json,created_at) VALUES(?,?,NULL,'group_reminder',?,?)").bind(id, this.config.id, encode2(payload), at).run();
          if (inserted.meta.changes) this.broadcast({ type: "notification", id, actorId: null, kind: "group_reminder", payload, createdAt: at });
        }
        await this.env.DB.prepare("UPDATE social_group_reminders SET delivered_at=? WHERE id=? AND user_id=?").bind(Date.now(), reminder.id, this.config.id).run();
      }
      const nextGroup = await this.env.DB.prepare("SELECT MIN(due_at) AS due FROM social_group_reminders WHERE user_id=? AND delivered_at IS NULL").bind(this.config.id).first();
      if (nextGroup?.due) await this.scheduleReminder(nextGroup.due);
    }
    for (const row of this.sql.exec("SELECT key,value FROM state WHERE key LIKE 'ticket:%'").toArray()) if (parse(row.value).deadline < Date.now()) this.sql.exec("DELETE FROM state WHERE key=?", row.key);
    this.sql.exec("DELETE FROM state WHERE key LIKE 'revoked:%' AND json_extract(value,'$.at')<?", Date.now() - 31 * 864e5);
    for (const ws of this.ctx.getWebSockets()) {
      const data = ws.deserializeAttachment();
      if (data.lastActive < Date.now() - ACTIVE_FOR || data.expiresAt <= Date.now()) ws.close(4001, "Reconecte para atualizar sua presen\xE7a");
    }
    await this.announce();
    if (this.ctx.getWebSockets().some((ws) => ws.readyState === 1)) await this.schedule(ACTIVE_FOR);
  }
};
var ListeningSession = class extends DurableObject {
  static {
    __name(this, "ListeningSession");
  }
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS room(id INTEGER PRIMARY KEY,value TEXT NOT NULL)");
  }
  state() {
    return parse(this.ctx.storage.sql.exec("SELECT value FROM room WHERE id=1").toArray()[0]?.value);
  }
  save(value) {
    this.ctx.storage.sql.exec("INSERT INTO room(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", encode2(value));
  }
  async create(value) {
    const existing = this.state();
    if (existing.id) return existing;
    this.save({ ...value, status: "pending", revision: 1, updatedAt: Date.now(), position: 0, playing: false, guestCanControl: false });
    await this.ctx.storage.setAlarm(Date.now() + 3e5);
  }
  async join(userId) {
    let state = this.state();
    if (!state || state.guestId !== userId || state.status !== "pending" || state.expiresAt < Date.now()) throw problem("Convite expirado ou indispon\xEDvel.", 409);
    await requireFriend(this.env, state.hostId, state.guestId);
    if ((await settings(this.env, userId)).listening_invites === "none") throw problem("Convites est\xE3o desativados.", 403);
    state = this.state();
    if (state.status !== "pending" || state.expiresAt < Date.now()) throw problem("Convite encerrado.", 409);
    state.status = "active";
    state.playing = true;
    state.updatedAt = Date.now();
    state.startedAt = state.updatedAt;
    state.played = [{ trackId: state.trackId, at: state.startedAt }];
    state.expiresAt = Date.now() + 4 * 36e5;
    state.revision++;
    this.save(state);
    await this.env.DB.prepare("UPDATE listening_sessions SET status='active',started_at=? WHERE id=? AND status='pending'").bind(state.startedAt, state.id).run();
    await this.ctx.storage.setAlarm(Date.now() + 4 * 36e5);
    await this.publish(state);
    return state;
  }
  async snapshot(userId) {
    const state = this.state();
    if (!state || ![state.hostId, state.guestId].includes(userId)) throw problem("Sess\xE3o n\xE3o encontrada.", 404);
    await requireFriend(this.env, state.hostId, state.guestId);
    return state;
  }
  async enqueue(userId, trackId) {
    let state = await this.snapshot(userId);
    if (state.status !== "active") throw problem("Sess\xE3o indispon\xEDvel.", 403);
    if (!await this.env.DB.prepare("SELECT id FROM tracks WHERE id=? AND import_batch_id IS NULL").bind(trackId).first()) throw problem("M\xFAsica indispon\xEDvel.", 404);
    state = this.state();
    if (state.status !== "active" || ![state.hostId, state.guestId].includes(userId)) throw problem("Sess\xE3o encerrada.", 403);
    state.queue = Array.isArray(state.queue) ? state.queue : [];
    if (state.queue.length >= 100) throw problem("Fila cheia.", 409);
    state.queue.push({ id: crypto.randomUUID(), trackId, addedBy: userId });
    state.revision++;
    this.save(state);
    await this.publish(state);
    return state;
  }
  async next(userId) {
    let state = await this.snapshot(userId);
    state = this.state();
    if (state.status !== "active" || userId !== state.hostId && !state.guestCanControl) throw problem("Controle indispon\xEDvel.", 403);
    if (!state.queue?.length) throw problem("A fila est\xE1 vazia.", 409);
    const item = state.queue.shift();
    state.trackId = item.trackId;
    state.position = 0;
    state.playing = true;
    state.updatedAt = Date.now();
    state.played = [...state.played || [], { trackId: item.trackId, at: state.updatedAt }].slice(-500);
    state.revision++;
    this.save(state);
    await this.publish(state);
    return state;
  }
  async control(userId, event) {
    let state = this.state();
    if (!state || state.status !== "active" || ![state.hostId, state.guestId].includes(userId)) throw problem("Sess\xE3o indispon\xEDvel.", 403);
    if (userId !== state.hostId && !state.guestCanControl) throw problem("O anfitri\xE3o controla esta sess\xE3o. Voc\xEA pode sair para ouvir por conta pr\xF3pria.", 403);
    if (event.trackId && event.trackId !== state.trackId && !await this.env.DB.prepare("SELECT id FROM tracks WHERE id=? AND import_batch_id IS NULL").bind(event.trackId).first()) throw problem("M\xFAsica indispon\xEDvel.", 404);
    state = this.state();
    if (state.status !== "active" || userId !== state.hostId && !state.guestCanControl) throw problem("Sess\xE3o encerrada ou controle indispon\xEDvel.", 403);
    if (event.action === "permissions" && userId === state.hostId) state.guestCanControl = Boolean(event.guestCanControl);
    else {
      if (event.trackId && event.trackId !== state.trackId) {
        state.trackId = event.trackId;
        state.played = [...state.played || [], { trackId: event.trackId, at: Date.now() }].slice(-500);
      }
      state.position = Math.min(86400, Math.max(0, Number(event.position) || 0));
      state.playing = Boolean(event.playing);
    }
    state.updatedAt = Date.now();
    state.revision++;
    this.save(state);
    await this.publish(state);
  }
  async publish(state) {
    await Promise.all([state.hostId, state.guestId].map((id) => this.env.SOCIAL.getByName(id).deliver({ type: "listening", session: state })));
  }
  async end(userId) {
    const state = this.state();
    if (!state.id || ![state.hostId, state.guestId].includes(userId) || state.status === "ended") return;
    state.status = "ended";
    state.revision++;
    state.updatedAt = Date.now();
    this.save(state);
    await this.env.DB.prepare("UPDATE listening_sessions SET status='ended',ended_at=?,history_json=? WHERE id=?").bind(state.updatedAt, encode2(state.played || []), state.id).run();
    await this.publish(state);
    await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    const state = this.state();
    if (state.id) await this.end(state.hostId);
  }
};

// src/index.js
var allowedOrigins = /* @__PURE__ */ new Set([
  "https://mounkcodas.github.io",
  "https://obgmusicplayer.aleixomaycon.workers.dev",
  "https://consona.live",
  "https://www.consona.live",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);
function responseHeaders(request, extra = {}) {
  const origin = request.headers.get("Origin");
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Range, If-Range, If-None-Match",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range, Content-Length, ETag, X-Library-Cache",
    "Vary": "Origin",
    ...extra
  });
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}
__name(responseHeaders, "responseHeaders");
function json(request, value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: responseHeaders(request, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }) });
}
__name(json, "json");
function fail(request, message2, status = 400) {
  return json(request, { error: message2 }, status);
}
__name(fail, "fail");
function mediaUrl(request, key) {
  return key ? `${new URL(request.url).origin}/api/media/${encodeURIComponent(key)}` : "";
}
__name(mediaUrl, "mediaUrl");
function serializeCatalog(request, rows) {
  const [trackRows, playlistRows, itemRows, albumRows, albumItemRows, userRows] = rows;
  const tracksById = new Map(trackRows.results.map((track) => [track.id, track]));
  const albumsById = new Map(albumRows.results.map((album) => [album.id, album]));
  const metadataById = new Map(trackRows.results.map((track) => [track.id, parseMetadata(track.metadata_json)]));
  const trackMetadata = /* @__PURE__ */ __name((track) => metadataById.get(track?.id) || {}, "trackMetadata");
  const usersById = new Map(userRows.results.map((person2) => [person2.id, { id: person2.id, displayName: person2.display_name, avatar: mediaUrl(request, person2.avatar_key) }]));
  const itemsByPlaylist = /* @__PURE__ */ new Map();
  for (const item of itemRows.results) {
    const entries = itemsByPlaylist.get(item.playlist_id) || [];
    entries.push(item.track_id);
    itemsByPlaylist.set(item.playlist_id, entries);
  }
  const itemsByAlbum = /* @__PURE__ */ new Map();
  for (const item of albumItemRows.results) {
    const entries = itemsByAlbum.get(item.album_id) || [];
    entries.push(item.track_id);
    itemsByAlbum.set(item.album_id, entries);
  }
  const albumCover = /* @__PURE__ */ __name((album) => {
    if (!album) return "";
    const firstTrack = tracksById.get((itemsByAlbum.get(album.id) || [])[0]);
    return mediaUrl(request, album.cover_key) || album.cover_url || trackMetadata(firstTrack).coverUrl || mediaUrl(request, firstTrack?.cover_key) || "";
  }, "albumCover");
  const primaryAlbum = /* @__PURE__ */ __name((track) => albumsById.get(track?.primary_album_id), "primaryAlbum");
  const individualCover = /* @__PURE__ */ __name((track) => trackMetadata(track).coverUrl || mediaUrl(request, track?.cover_key) || "", "individualCover");
  return {
    tracks: trackRows.results.map((track) => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: primaryAlbum(track)?.title || track.album,
      primaryAlbumId: track.primary_album_id,
      fileHash: track.content_hash || "",
      coverMode: trackMetadata(track).coverMode || "individual",
      individualCover: individualCover(track),
      duration: formatTime(track.duration_seconds),
      seconds: track.duration_seconds,
      src: mediaUrl(request, track.audio_key),
      mainArt: mediaUrl(request, track.main_key) || trackMetadata(track).mainImageUrl || "",
      cover: trackMetadata(track).coverMode === "album" ? albumCover(primaryAlbum(track)) || individualCover(track) : individualCover(track) || albumCover(primaryAlbum(track)),
      metadata: trackMetadata(track),
      addedBy: usersById.get(track.added_by) || null
    })),
    playlists: playlistRows.results.map((list) => ({
      id: list.id,
      name: list.name,
      trackIds: itemsByPlaylist.get(list.id) || [],
      addedBy: usersById.get(list.added_by) || null,
      coverIsCustom: Boolean(list.cover_key),
      cover: mediaUrl(request, list.cover_key) || (() => {
        const first = tracksById.get((itemsByPlaylist.get(list.id) || [])[0]);
        return trackMetadata(first).coverMode === "album" ? albumCover(primaryAlbum(first)) || individualCover(first) : individualCover(first) || albumCover(primaryAlbum(first));
      })()
    })),
    albums: albumRows.results.map((album) => {
      const trackIds = itemsByAlbum.get(album.id) || [];
      const firstTrack = tracksById.get(trackIds[0]);
      const firstTrackMetadata = trackMetadata(firstTrack);
      return {
        id: album.id,
        title: album.title,
        artist: album.artist,
        trackIds,
        addedBy: usersById.get(album.added_by) || null,
        cover: mediaUrl(request, album.cover_key) || album.cover_url || firstTrackMetadata.coverUrl || mediaUrl(request, firstTrack?.cover_key) || "",
        coverProof: parseMetadata(album.metadata_json).googleCoverProof || firstTrackMetadata.googleCoverProof || "",
        metadata: parseMetadata(album.metadata_json)
      };
    })
  };
}
__name(serializeCatalog, "serializeCatalog");
function parseMetadata(value) {
  try {
    const data = JSON.parse(value || "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}
__name(parseMetadata, "parseMetadata");
function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
__name(formatTime, "formatTime");
var bytesToHex = /* @__PURE__ */ __name((bytes) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join(""), "bytesToHex");
function randomHex(size) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
__name(randomHex, "randomHex");
async function digestHex(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
__name(digestHex, "digestHex");
function constantTimeEqual(left, right) {
  left = left instanceof Uint8Array ? left : new Uint8Array(left);
  right = right instanceof Uint8Array ? right : new Uint8Array(right);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}
__name(constantTimeEqual, "constantTimeEqual");
async function passwordDigest(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/.{2}/g) || [], (part) => parseInt(part, 16));
  return bytesToHex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1e5 }, key, 256));
}
__name(passwordDigest, "passwordDigest");
function publicUser(user, request) {
  return { id: user.id, username: user.username, displayName: user.display_name, avatar: mediaUrl(request, user.avatar_key) };
}
__name(publicUser, "publicUser");
async function getUser(request, env) {
  const token = (request.headers.get("Authorization") || "").match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
  if (!token) return null;
  return env.DB.prepare(`SELECT users.id, users.username, users.display_name, users.avatar_key, sessions.token_hash AS session_hash, sessions.expires_at AS session_expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now')`).bind(await digestHex(token)).first();
}
__name(getUser, "getUser");
async function startSession(user, request, env) {
  const token = randomHex(32), tokenHash = await digestHex(token);
  await env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+30 days'))").bind(tokenHash, user.id).run();
  return json(request, { token, user: publicUser(user, request) }, 201);
}
__name(startSession, "startSession");
async function authRoutes(request, env, path) {
  if (path === "/api/auth/register" && request.method === "POST") {
    const body2 = await request.json();
    const username = String(body2.username || "").trim();
    const displayName = String(body2.displayName || username).trim().slice(0, 40);
    const password = String(body2.password || "");
    if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) return fail(request, "Use um usu\xE1rio de 3 a 24 caracteres: letras, n\xFAmeros, ponto, h\xEDfen ou sublinhado.");
    if (password.length < 10 || password.length > 128) return fail(request, "A senha deve ter de 10 a 128 caracteres.");
    if (await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").bind(username).first()) return fail(request, "Esse nome de usu\xE1rio j\xE1 est\xE1 em uso.", 409);
    const user = { id: crypto.randomUUID(), username, display_name: displayName || username, avatar_key: null };
    const salt = randomHex(16), passwordHash = await passwordDigest(password, salt);
    await env.DB.prepare("INSERT INTO users (id,username,display_name,password_salt,password_hash) VALUES (?,?,?,?,?)").bind(user.id, username, user.display_name, salt, passwordHash).run();
    return startSession(user, request, env);
  }
  if (path === "/api/auth/login" && request.method === "POST") {
    const body2 = await request.json();
    const username = String(body2.username || "").trim();
    const password = String(body2.password || "");
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const attemptKey = await digestHex(`${ip}|${username.toLocaleLowerCase()}`);
    const attempt = await env.DB.prepare("SELECT failures FROM auth_attempts WHERE attempt_key=? AND window_start > datetime('now','-15 minutes')").bind(attemptKey).first();
    if ((attempt?.failures || 0) >= 8) return fail(request, "Muitas tentativas. Aguarde 15 minutos e tente novamente.", 429);
    const record = await env.DB.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").bind(username).first();
    const expected = record?.password_hash || "00".repeat(32);
    const actual = await passwordDigest(password.slice(0, 128), record?.password_salt || "00".repeat(16));
    const valid = constantTimeEqual(Uint8Array.from(expected.match(/.{2}/g), (part) => parseInt(part, 16)), Uint8Array.from(actual.match(/.{2}/g), (part) => parseInt(part, 16)));
    if (!record || !valid) {
      await env.DB.prepare(`INSERT INTO auth_attempts (attempt_key,failures,window_start) VALUES (?,1,datetime('now'))
        ON CONFLICT(attempt_key) DO UPDATE SET failures=CASE WHEN window_start <= datetime('now','-15 minutes') THEN 1 ELSE failures+1 END, window_start=CASE WHEN window_start <= datetime('now','-15 minutes') THEN datetime('now') ELSE window_start END`).bind(attemptKey).run();
      return fail(request, "Usu\xE1rio ou senha incorretos.", 401);
    }
    await env.DB.prepare("DELETE FROM auth_attempts WHERE attempt_key=?").bind(attemptKey).run();
    return startSession(record, request, env);
  }
  if (path === "/api/auth/logout" && request.method === "POST") {
    const token = (request.headers.get("Authorization") || "").match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
    const exiting = env.SOCIAL ? await getUser(request, env) : null;
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digestHex(token)).run();
    if (exiting) await env.SOCIAL.getByName(exiting.id).revoke(exiting.session_hash);
    return json(request, { ok: true });
  }
  if (path === "/api/auth/me" && request.method === "GET") {
    const user = await getUser(request, env);
    return user ? json(request, { user: publicUser(user, request) }) : fail(request, "Entre na sua conta.", 401);
  }
  return null;
}
__name(authRoutes, "authRoutes");
async function updateProfile(request, env, user) {
  const form = await request.formData();
  const displayName = String(form.get("displayName") || user.display_name).trim().slice(0, 40) || user.display_name;
  const avatar = form.get("avatar");
  if (avatar instanceof File && avatar.size) {
    if (avatar.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(avatar.type)) return fail(request, "Use uma imagem JPG, PNG, WebP ou AVIF de at\xE9 5 MB.");
    const key = `users/${user.id}/avatar-${crypto.randomUUID()}.${avatar.type.split("/")[1]}`;
    await env.MEDIA.put(key, avatar.stream(), { httpMetadata: { contentType: avatar.type, cacheControl: "public, max-age=3600" } });
    if (user.avatar_key) await env.MEDIA.delete(user.avatar_key);
    await env.DB.prepare("UPDATE users SET display_name=?,avatar_key=? WHERE id=?").bind(displayName, key, user.id).run();
    if (env.SOCIAL) await env.SOCIAL.getByName(user.id).profileUpdated(user.id);
    return json(request, { user: publicUser({ ...user, display_name: displayName, avatar_key: key }, request) });
  }
  await env.DB.prepare("UPDATE users SET display_name=? WHERE id=?").bind(displayName, user.id).run();
  if (env.SOCIAL) await env.SOCIAL.getByName(user.id).profileUpdated(user.id);
  return json(request, { user: publicUser({ ...user, display_name: displayName }, request) });
}
__name(updateProfile, "updateProfile");
async function uploadTrack(request, env, user, staged = false) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > 48 * 1024 * 1024) return fail(request, "O envio ultrapassa o limite de 48 MB.", 413);
  const form = await request.formData();
  const batchId = staged ? String(form.get("batchId") || "") : null, itemKey = staged ? String(form.get("itemKey") || "") : null;
  const fileHash = /^[a-f0-9]{64}$/i.test(String(form.get("fileHash") || "")) ? String(form.get("fileHash")).toLowerCase() : null;
  if (staged) {
    if (!/^[a-f0-9-]{36}$/i.test(batchId) || !/^[a-f0-9-]{36}$/i.test(itemKey)) return fail(request, "Rascunho inv\xE1lido.");
    const previous = await env.DB.prepare("SELECT id FROM tracks WHERE added_by=? AND import_batch_id=? AND import_item_key=?").bind(user.id, batchId, itemKey).first();
    if (previous) return json(request, { id: previous.id });
    if (fileHash && await env.DB.prepare("SELECT id FROM tracks WHERE content_hash=? AND import_batch_id IS NULL").bind(fileHash).first()) return fail(request, "Este arquivo j\xE1 est\xE1 na biblioteca. Adicione a m\xFAsica existente ao rascunho.", 409);
  }
  const title = String(form.get("title") || "").trim().slice(0, 180);
  const artist = String(form.get("artist") || "").trim().slice(0, 180);
  const album = String(form.get("album") || "").trim().slice(0, 180);
  const duration = Math.max(0, Math.floor(Number(form.get("duration")) || 0));
  const audio = form.get("audio");
  const cover = form.get("cover");
  const mainImage = form.get("mainImage");
  const coverUrl = String(form.get("coverUrl") || "");
  const mainImageUrl = safeRemoteImage(form.get("mainImageUrl"));
  let metadata2 = {};
  try {
    metadata2 = JSON.parse(String(form.get("metadata") || "{}"));
  } catch {
    return fail(request, "Metadados inv\xE1lidos.");
  }
  if (!metadata2 || typeof metadata2 !== "object" || Array.isArray(metadata2) || JSON.stringify(metadata2).length > 24e3) return fail(request, "Metadados inv\xE1lidos ou muito extensos.");
  metadata2.coverUrl = await approvedImageUrl(env, coverUrl || metadata2.coverUrl, metadata2.googleCoverProof);
  metadata2.mainImageUrl = mainImageUrl;
  if (!title || !artist || !album && !staged || !(audio instanceof File)) return fail(request, "Informe m\xFAsica, artista e arquivo de \xE1udio.");
  if (audio.size < 1 || audio.size > 32 * 1024 * 1024) return fail(request, "O \xE1udio deve ter at\xE9 32 MB.", 413);
  if (!(audio.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(audio.name))) return fail(request, "O arquivo enviado n\xE3o parece ser um \xE1udio.");
  for (const image of [cover, mainImage]) {
    if (image && image.size > 7 * 1024 * 1024) return fail(request, "Cada imagem deve ter at\xE9 7 MB.", 413);
    if (image && !image.type.startsWith("image/")) return fail(request, "As capas precisam ser arquivos de imagem.");
  }
  const id = crypto.randomUUID();
  const audioKey = `tracks/${id}/audio-${safeName(audio.name)}`;
  const coverKey = cover instanceof File && cover.size ? `tracks/${id}/cover-${safeName(cover.name)}` : null;
  const mainKey = mainImage instanceof File && mainImage.size ? `tracks/${id}/main-${safeName(mainImage.name)}` : null;
  try {
    await env.MEDIA.put(audioKey, audio.stream(), { httpMetadata: { contentType: audio.type || "application/octet-stream", cacheControl: "public, max-age=31536000, immutable" } });
    if (coverKey && cover instanceof File) await env.MEDIA.put(coverKey, cover.stream(), { httpMetadata: { contentType: cover.type, cacheControl: "public, max-age=31536000, immutable" } });
    if (mainKey && mainImage instanceof File) await env.MEDIA.put(mainKey, mainImage.stream(), { httpMetadata: { contentType: mainImage.type, cacheControl: "public, max-age=31536000, immutable" } });
    await env.DB.prepare("INSERT INTO tracks (id, title, artist, album, duration_seconds, audio_key, cover_key, main_key, metadata_json, added_by,content_hash,import_batch_id,import_item_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?)").bind(id, title, artist, album, duration, audioKey, coverKey, mainKey, JSON.stringify(metadata2), user.id, fileHash, batchId, itemKey).run();
  } catch (error) {
    await Promise.all([audioKey, coverKey, mainKey].filter(Boolean).map((key) => env.MEDIA.delete(key)));
    if (staged) {
      const retry = await env.DB.prepare("SELECT id FROM tracks WHERE added_by=? AND import_batch_id=? AND import_item_key=?").bind(user.id, batchId, itemKey).first();
      if (retry) return json(request, { id: retry.id });
    }
    throw error;
  }
  return json(request, { id }, 201);
}
__name(uploadTrack, "uploadTrack");
function safeRemoteImage(value) {
  try {
    const url = new URL(String(value || ""));
    const allowedHost = ["upload.wikimedia.org", "coverartarchive.org", "lastfm.freetls.fastly.net", "lastfm-img2.akamaized.net", "i.scdn.co"].includes(url.hostname) || /^encrypted-tbn\d+\.gstatic\.com$/.test(url.hostname);
    return url.protocol === "https:" && allowedHost ? url.href.slice(0, 2e3) : "";
  } catch {
    return "";
  }
}
__name(safeRemoteImage, "safeRemoteImage");
async function spotifyCatalogToken(env) {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return "";
  const credentials = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const response = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" }).catch(() => null);
  if (!response?.ok) return "";
  return (await response.json().catch(() => ({}))).access_token || "";
}
__name(spotifyCatalogToken, "spotifyCatalogToken");
async function spotifyCatalogGet(token, path) {
  const response = await fetch(`https://api.spotify.com/v1/${path}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  return response?.ok ? response.json().catch(() => null) : null;
}
__name(spotifyCatalogGet, "spotifyCatalogGet");
async function googleImageProof(env, url) {
  const secret = env.GOOGLE_CSE_API_KEY;
  if (!secret) return "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(url)));
  return btoa(String.fromCharCode(...signature)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(googleImageProof, "googleImageProof");
async function approvedImageUrl(env, value, proof) {
  const url = safeRemoteImage(value);
  if (url) return url;
  const candidate = String(value || "").slice(0, 2e3);
  if (!/^https:\/\//i.test(candidate) || !proof || !env.GOOGLE_CSE_API_KEY) return "";
  const expected = await googleImageProof(env, candidate);
  const encoder = new TextEncoder();
  const [expectedHash, providedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(String(proof)))
  ]);
  return constantTimeEqual(expectedHash, providedHash) ? candidate : "";
}
__name(approvedImageUrl, "approvedImageUrl");
async function googleImageSearch(request, env) {
  if (!env.GOOGLE_CSE_API_KEY || !env.GOOGLE_CSE_CX) return fail(request, "A busca Google ainda n\xE3o est\xE1 configurada no backend.", 503);
  const query = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 180);
  if (!query) return fail(request, "Informe o que deseja pesquisar.");
  const params = new URLSearchParams({ key: env.GOOGLE_CSE_API_KEY, cx: env.GOOGLE_CSE_CX, q: query, searchType: "image", num: "8", safe: "active" });
  const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return fail(request, payload.error?.message || "A pesquisa Google falhou.", response.status);
  const items = (await Promise.all((payload.items || []).map(async (item) => ({
    title: item.title || "Imagem",
    url: /^https:\/\//i.test(item.link || "") ? item.link : "",
    thumbnail: item.image?.thumbnailLink || item.link || "",
    source: item.image?.contextLink || item.displayLink || "",
    width: item.image?.width || 0,
    height: item.image?.height || 0,
    proof: await googleImageProof(env, item.link || "")
  })))).filter((item) => item.url);
  return json(request, { items });
}
__name(googleImageSearch, "googleImageSearch");
function safeName(name) {
  return String(name || "file").toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(-80) || "file";
}
__name(safeName, "safeName");
async function mediaResponse(request, env, key) {
  if (!/^(tracks|artists|users|albums)\/[a-f0-9-]{36}\/[a-z0-9._-]+$/i.test(key)) return new Response("Not found", { status: 404 });
  const object = await env.MEDIA.get(key, { range: request.headers });
  if (!object) return new Response("Not found", { status: 404 });
  const headers = responseHeaders(request);
  object.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  if (object.range) {
    const start = object.range.offset ?? Math.max(0, object.size - object.range.length);
    const end = start + object.range.length - 1;
    headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
    headers.set("Content-Length", String(object.range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}
__name(mediaResponse, "mediaResponse");
async function createPlaylist(request, env, user) {
  const payload = await request.json();
  const name = String(payload.name || "").trim().slice(0, 100);
  const trackIds = Array.isArray(payload.trackIds) ? [...new Set(payload.trackIds.map(String))].slice(0, 500) : [];
  if (!name) return fail(request, "Informe o nome da playlist.");
  const id = crypto.randomUUID();
  const statements = [env.DB.prepare("INSERT INTO playlists (id, name, added_by) VALUES (?, ?, ?)").bind(id, name, user.id)];
  for (const [position, trackId] of trackIds.entries()) statements.push(env.DB.prepare("INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) SELECT ?, id, ? FROM tracks WHERE id = ?").bind(id, position, trackId));
  await env.DB.batch(statements);
  return json(request, { id, name, trackIds }, 201);
}
__name(createPlaylist, "createPlaylist");
async function createAlbum(request, env, user) {
  const payload = await request.json();
  const title = String(payload.title || "").trim().slice(0, 180);
  const artist = String(payload.artist || "").trim().slice(0, 180);
  const trackIds = Array.isArray(payload.trackIds) ? [...new Set(payload.trackIds.map(String))].slice(0, 500) : [];
  if (!title) return fail(request, "Informe o nome do \xE1lbum.");
  const id = crypto.randomUUID(), coverUrl = await approvedImageUrl(env, payload.coverUrl, payload.coverProof);
  const metadata2 = payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata) ? JSON.stringify(payload.metadata).slice(0, 12e3) : "{}";
  const statements = [env.DB.prepare("INSERT INTO albums (id,title,artist,cover_url,metadata_json,added_by) VALUES (?,?,?,?,?,?)").bind(id, title, artist, coverUrl, metadata2, user.id)];
  for (const [position, trackId] of trackIds.entries()) statements.push(env.DB.prepare("INSERT OR IGNORE INTO album_tracks (album_id,track_id,position) SELECT ?,id,? FROM tracks WHERE id=?").bind(id, position, trackId));
  await env.DB.batch(statements);
  return json(request, { id, title, artist, trackIds, cover: coverUrl }, 201);
}
__name(createAlbum, "createAlbum");
async function updateAlbum(request, env, id) {
  const payload = await request.json();
  const current = await env.DB.prepare("SELECT * FROM albums WHERE id=?").bind(id).first();
  if (!current) return fail(request, "\xC1lbum n\xE3o encontrado.", 404);
  const title = String(payload.title ?? current.title).trim().slice(0, 180);
  const artist = String(payload.artist ?? current.artist).trim().slice(0, 180);
  const coverUrl = payload.coverUrl === void 0 ? current.cover_url : await approvedImageUrl(env, payload.coverUrl, payload.coverProof);
  if (payload.coverUrl && !coverUrl) return fail(request, "Escolha uma capa v\xE1lida ou envie uma imagem em Configura\xE7\xF5es.");
  const coverKey = payload.coverUrl === void 0 ? current.cover_key : null;
  const metadata2 = payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata) ? JSON.stringify(payload.metadata).slice(0, 12e3) : current.metadata_json;
  if (!title) return fail(request, "Informe o nome do \xE1lbum.");
  await env.DB.prepare("UPDATE albums SET title=?,artist=?,cover_key=?,cover_url=?,metadata_json=? WHERE id=?").bind(title, artist, coverKey, coverUrl, metadata2, id).run();
  return json(request, { ok: true });
}
__name(updateAlbum, "updateAlbum");
async function refreshAlbumCoverPool(env, rows) {
  try {
    for (let offset = 0; offset < rows.length; offset += 3) {
      await Promise.all(rows.slice(offset, offset + 3).map(async (album) => {
        const attemptedAt = Date.now();
        try {
          const response = await fetch(`https://coverartarchive.org/release-group/${album.id}`, {
            headers: { Accept: "application/json", "User-Agent": "Consona/1.0 (https://consona.live)" },
            signal: AbortSignal.timeout(6500)
          });
          if (!response.ok) throw new Error(`Cover source ${response.status}`);
          const payload = await response.json();
          const front = payload.images?.find((image) => image.front && image.approved !== false);
          const cover = new URL(front?.thumbnails?.["250"] || front?.thumbnails?.small || "");
          if (!["coverartarchive.org", "archive.org"].includes(cover.hostname)) throw new Error("Invalid cover host");
          cover.protocol = "https:";
          await env.DB.prepare("UPDATE discovery_album_covers SET artwork_url=?,updated_at=?,last_attempt_at=? WHERE id=?").bind(cover.href, attemptedAt, attemptedAt, album.id).run();
        } catch {
          await env.DB.prepare("UPDATE discovery_album_covers SET last_attempt_at=? WHERE id=?").bind(attemptedAt, album.id).run();
        }
      }));
    }
  } finally {
    await env.DB.prepare("UPDATE discovery_cover_refresh SET lease_until=0 WHERE id=1").run();
  }
}
__name(refreshAlbumCoverPool, "refreshAlbumCoverPool");
async function getAlbumCoverPool(request, env, ctx) {
  const readPool = /* @__PURE__ */ __name(() => env.DB.prepare("SELECT id,title,artist,artwork_url,source_url FROM discovery_album_covers WHERE artwork_url <> '' ORDER BY position,id LIMIT 24").all(), "readPool");
  let pool = await readPool();
  const now = Date.now();
  const stale = await env.DB.prepare("SELECT id FROM discovery_album_covers WHERE (artwork_url='' OR updated_at < ?) AND last_attempt_at < ? ORDER BY position LIMIT 12").bind(now - 7 * 864e5, now - 36e5).all();
  if (stale.results.length) {
    const lease = await env.DB.prepare("UPDATE discovery_cover_refresh SET lease_until=? WHERE id=1 AND lease_until < ? RETURNING id").bind(now + 6e4, now).first();
    if (lease) {
      const refresh = refreshAlbumCoverPool(env, stale.results).catch((error) => console.error(JSON.stringify({ event: "cover_pool_refresh_failed", message: String(error) })));
      if (pool.results.length < 6) {
        await refresh;
        pool = await readPool();
      } else ctx.waitUntil(refresh);
    }
  }
  const result = json(request, { albums: pool.results.map((album) => ({ id: album.id, title: album.title, artist: album.artist, cover: album.artwork_url, sourceUrl: album.source_url })) });
  result.headers.set("Cache-Control", pool.results.length ? "public, max-age=300" : "public, max-age=10");
  return result;
}
__name(getAlbumCoverPool, "getAlbumCoverPool");
async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(request, { "Access-Control-Max-Age": "86400" }) });
  if (path === "/api/social/connect") return socialSocket(request, env);
  if (path === "/api/discover/album-covers" && request.method === "GET") return cachedCoverPool(request, ctx, () => getAlbumCoverPool(request, env, ctx), responseHeaders);
  if (path === "/api/health" && request.method === "GET") return json(request, { ok: true });
  const mediaMatch = path.match(/^\/api\/media\/(.+)$/);
  if (mediaMatch && request.method === "GET") return mediaResponse(request, env, decodeURIComponent(mediaMatch[1]));
  const authResponse = await authRoutes(request, env, path);
  if (authResponse) return authResponse;
  const user = await getUser(request, env);
  if (path.startsWith("/api/social/")) return socialRoutes(request, env, user, { json, responseHeaders, ctx });
  if (path === "/api/import/tracks" && request.method === "POST") return user ? uploadTrack(request, env, user, true) : fail(request, "Entre na sua conta para importar m\xFAsicas.", 401);
  const importResponse = await importRoutes(request, env, user, { json, fail, approvedImageUrl, mediaUrl, ctx });
  if (importResponse) return importResponse;
  if ((path === "/api/profile" || path === "/api/auth/profile") && request.method === "PUT") return user ? updateProfile(request, env, user) : fail(request, "Entre na sua conta.", 401);
  if (path === "/api/lastfm" && request.method === "GET") {
    const apiKey = env.LASTFM_API_SECRET;
    if (!apiKey) return fail(request, "A busca Last.fm n\xE3o est\xE1 dispon\xEDvel.", 503);
    const method = url.searchParams.get("method") || "";
    const allowedMethods = /* @__PURE__ */ new Set(["track.getInfo", "artist.getInfo", "artist.getTopAlbums", "album.getInfo", "track.getSimilar"]);
    if (!allowedMethods.has(method)) return fail(request, "M\xE9todo Last.fm n\xE3o permitido.");
    const params = new URLSearchParams({ method, api_key: apiKey, format: "json" });
    for (const key of ["artist", "track", "album", "limit"]) {
      const value = (url.searchParams.get(key) || "").slice(0, 180);
      if (value) params.set(key, value);
    }
    params.set("autocorrect", "1");
    const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) return fail(request, "Last.fm n\xE3o encontrou esses dados.", response.status >= 400 && response.status < 600 ? response.status : 502);
    return json(request, payload);
  }
  if (path === "/api/musicbrainz" && request.method === "GET") {
    if (!user) return fail(request, "Entre na sua conta para consultar o MusicBrainz.", 401);
    const entity = url.searchParams.get("entity") || "";
    if (!["recording", "release", "release-group"].includes(entity)) return fail(request, "Consulta MusicBrainz inv\xE1lida.");
    const id = url.searchParams.get("id") || "";
    if (id && !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) return fail(request, "Identificador MusicBrainz inv\xE1lido.");
    const query = (url.searchParams.get("query") || "").trim().slice(0, 250);
    const group = url.searchParams.get("release-group") || "";
    if (group && !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(group)) return fail(request, "Grupo de lan\xE7amento inv\xE1lido.");
    if (!id && !query && !(entity === "release" && group)) return fail(request, "Informe os dados da busca MusicBrainz.");
    const inc = (url.searchParams.get("inc") || "").trim();
    if (inc && !/^(?:genres|ratings|annotation|url-rels|recordings)(?: (?:genres|ratings|annotation|url-rels|recordings))*$/.test(inc)) return fail(request, "Detalhes MusicBrainz inv\xE1lidos.");
    const limit = Math.min(25, Math.max(1, Number(url.searchParams.get("limit")) || 8));
    const params = new URLSearchParams({ fmt: "json", limit: String(limit) });
    if (query) params.set("query", query);
    if (group) params.set("release-group", group);
    if (inc) params.set("inc", inc);
    const target = `https://musicbrainz.org/ws/2/${entity}/${id}?${params}`;
    const response = await fetch(target, { headers: { Accept: "application/json", "User-Agent": "Consona/1.0 (https://consona.live)" }, signal: AbortSignal.timeout(12e3) }).catch(() => null);
    if (!response?.ok) return fail(request, "O MusicBrainz est\xE1 temporariamente indispon\xEDvel.", response?.status === 429 || response?.status === 503 ? response.status : 502);
    return json(request, await response.json());
  }
  if (path === "/api/spotify/albums/search" && request.method === "GET") {
    if (!user) return fail(request, "Entre na sua conta para buscar \xE1lbuns.", 401);
    const query = (url.searchParams.get("q") || "").trim().slice(0, 180);
    if (query.length < 2) return fail(request, "Informe o nome do \xE1lbum.");
    const token = await spotifyCatalogToken(env);
    if (!token) return fail(request, "A busca no Spotify n\xE3o est\xE1 dispon\xEDvel.", 503);
    const result = await spotifyCatalogGet(token, `search?${new URLSearchParams({ q: query, type: "album", limit: "10", market: "BR" })}`);
    if (!result) return fail(request, "A busca no Spotify est\xE1 temporariamente indispon\xEDvel.", 502);
    return json(request, { albums: (result.albums?.items || []).filter(Boolean).map((item) => ({ id: item.id, title: item.name, artist: (item.artists || []).map((artist) => artist.name).join(", "), year: (item.release_date || "").slice(0, 4), coverUrl: item.images?.find((image) => image.width >= 300)?.url || item.images?.[0]?.url || "", sourceUrl: item.external_urls?.spotify || "" })) });
  }
  const spotifyAlbumMatch = path.match(/^\/api\/spotify\/albums\/([A-Za-z0-9]+)$/);
  if (spotifyAlbumMatch && request.method === "GET") {
    if (!user) return fail(request, "Entre na sua conta para consultar \xE1lbuns.", 401);
    const token = await spotifyCatalogToken(env);
    if (!token) return fail(request, "A busca no Spotify n\xE3o est\xE1 dispon\xEDvel.", 503);
    const album = await spotifyCatalogGet(token, `albums/${spotifyAlbumMatch[1]}?market=BR`);
    if (!album) return fail(request, "N\xE3o foi poss\xEDvel consultar o \xE1lbum no Spotify.", 502);
    return json(request, { releaseDate: album.release_date || "", releaseDatePrecision: album.release_date_precision || "" });
  }
  const spotifyTracksMatch = path.match(/^\/api\/spotify\/albums\/([A-Za-z0-9]+)\/tracks$/);
  if (spotifyTracksMatch && request.method === "GET") {
    if (!user) return fail(request, "Entre na sua conta para ordenar \xE1lbuns.", 401);
    const token = await spotifyCatalogToken(env);
    if (!token) return fail(request, "A busca no Spotify n\xE3o est\xE1 dispon\xEDvel.", 503);
    const tracks = [];
    for (let offset = 0; offset < 500; offset += 50) {
      const page = await spotifyCatalogGet(token, `albums/${spotifyTracksMatch[1]}/tracks?${new URLSearchParams({ limit: "50", offset: String(offset), market: "BR" })}`);
      if (!page) return fail(request, "N\xE3o foi poss\xEDvel ler a ordem das faixas no Spotify.", 502);
      const items = page.items || [];
      tracks.push(...items.filter(Boolean).map((item) => ({ title: item.name, disc: item.disc_number || 1, position: item.track_number || 0, recordingId: "" })));
      if (items.length < 50 || tracks.length >= (page.total || 0)) break;
    }
    return json(request, { tracks, source: "Spotify" });
  }
  if (path === "/api/library" && request.method === "GET") return user ? cachedLibrary(request, env, ctx, user, serializeCatalog, responseHeaders) : fail(request, "Entre na sua conta para acessar a biblioteca.", 401);
  if (path === "/api/covers/google" && request.method === "GET") return googleImageSearch(request, env);
  if (path === "/api/tracks" && request.method === "POST") return user ? uploadTrack(request, env, user) : fail(request, "Entre na sua conta para adicionar m\xFAsicas.", 401);
  const trackLyricsMatch = path.match(/^\/api\/tracks\/([^/]+)\/lyrics$/);
  if (trackLyricsMatch && request.method === "PUT") {
    const payload = await request.json();
    if (typeof payload.lyrics !== "string" || payload.lyrics.length > 2e4) return fail(request, "Letra inv\xE1lida ou muito longa.");
    if (!user) return fail(request, "Entre na sua conta para editar letras.", 401);
    const current = await env.DB.prepare("SELECT metadata_json FROM tracks WHERE id = ?").bind(trackLyricsMatch[1]).first();
    if (!current) return fail(request, "M\xFAsica n\xE3o encontrada.", 404);
    const metadata2 = parseMetadata(current.metadata_json);
    metadata2.lyrics = payload.lyrics;
    await env.DB.prepare("UPDATE tracks SET metadata_json = ? WHERE id = ?").bind(JSON.stringify(metadata2), trackLyricsMatch[1]).run();
    return json(request, { ok: true });
  }
  const trackCoverMatch = path.match(/^\/api\/tracks\/([^/]+)\/cover$/);
  if (trackCoverMatch && request.method === "PUT") {
    const payload = await request.json();
    const coverUrl = await approvedImageUrl(env, payload.coverUrl, payload.coverProof);
    if (!coverUrl) return fail(request, "URL de capa inv\xE1lida.");
    if (!user) return fail(request, "Entre na sua conta para editar capas.", 401);
    const current = await env.DB.prepare("SELECT metadata_json FROM tracks WHERE id = ?").bind(trackCoverMatch[1]).first();
    if (!current) return fail(request, "M\xFAsica n\xE3o encontrada.", 404);
    const metadata2 = parseMetadata(current.metadata_json);
    metadata2.coverUrl = coverUrl;
    metadata2.coverMode = "individual";
    metadata2.googleCoverProof = payload.coverProof || "";
    await env.DB.prepare("UPDATE tracks SET metadata_json = ? WHERE id = ?").bind(JSON.stringify(metadata2), trackCoverMatch[1]).run();
    return json(request, { ok: true, coverUrl });
  }
  if (path === "/api/playlists" && request.method === "POST") return user ? createPlaylist(request, env, user) : fail(request, "Entre na sua conta para criar playlists.", 401);
  if (path === "/api/albums" && request.method === "POST") return user ? createAlbum(request, env, user) : fail(request, "Entre na sua conta para criar \xE1lbuns.", 401);
  const albumMatch = path.match(/^\/api\/albums\/([^/]+)$/);
  if (albumMatch && request.method === "PUT") return user ? updateAlbum(request, env, albumMatch[1]) : fail(request, "Entre na sua conta para editar \xE1lbuns.", 401);
  if (albumMatch && request.method === "DELETE") {
    if (!user) return fail(request, "Entre na sua conta para excluir \xE1lbuns.", 401);
    await env.DB.prepare("DELETE FROM albums WHERE id=?").bind(albumMatch[1]).run();
    return json(request, { ok: true });
  }
  const albumTracksMatch = path.match(/^\/api\/albums\/([^/]+)\/tracks$/);
  if (albumTracksMatch && request.method === "POST") {
    if (!user) return fail(request, "Entre na sua conta para alterar \xE1lbuns.", 401);
    const albumId = albumTracksMatch[1];
    if (!await env.DB.prepare("SELECT id FROM albums WHERE id=?").bind(albumId).first()) return fail(request, "\xC1lbum n\xE3o encontrado.", 404);
    const payload = await request.json();
    const trackIds = Array.isArray(payload.trackIds) ? [...new Set(payload.trackIds.map(String))].slice(0, 500) : [];
    const found = [];
    for (let i = 0; i < trackIds.length; i += 80) {
      const ids = trackIds.slice(i, i + 80);
      found.push(...(await env.DB.prepare(`SELECT id FROM tracks WHERE import_batch_id IS NULL AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results);
    }
    if (found.length !== trackIds.length) return fail(request, "Uma m\xFAsica n\xE3o est\xE1 mais na biblioteca. Atualize a p\xE1gina.", 409);
    const statements = [env.DB.prepare("DELETE FROM album_tracks WHERE album_id=?").bind(albumId), env.DB.prepare("UPDATE tracks SET primary_album_id=NULL WHERE primary_album_id=?").bind(albumId)];
    for (let i = 0; i < trackIds.length; i += 30) {
      const ids = trackIds.slice(i, i + 30);
      statements.push(env.DB.prepare(`INSERT INTO album_tracks (album_id,track_id,position) VALUES ${ids.map(() => "(?,?,?)").join(",")}`).bind(...ids.flatMap((id, index) => [albumId, id, i + index])));
    }
    for (let i = 0; i < trackIds.length; i += 80) {
      const ids = trackIds.slice(i, i + 80);
      statements.push(env.DB.prepare(`UPDATE tracks SET primary_album_id=? WHERE primary_album_id IS NULL AND id IN (${ids.map(() => "?").join(",")})`).bind(albumId, ...ids));
    }
    await env.DB.batch(statements);
    return json(request, { ok: true, trackIds });
  }
  const playlistMatch = path.match(/^\/api\/playlists\/([^/]+)$/);
  if (playlistMatch && request.method === "DELETE") {
    if (!user) return fail(request, "Entre na sua conta para excluir playlists.", 401);
    const collab = await env.DB.prepare("SELECT owner_id FROM social_collaborative_playlists WHERE playlist_id=?").bind(playlistMatch[1]).first();
    if (collab && collab.owner_id !== user.id) return fail(request, "Somente o criador pode excluir esta playlist.", 403);
    await env.DB.prepare("DELETE FROM playlists WHERE id = ?").bind(playlistMatch[1]).run();
    return json(request, { ok: true });
  }
  const playlistTrackMatch = path.match(/^\/api\/playlists\/([^/]+)\/tracks$/);
  if (playlistTrackMatch && request.method === "POST") {
    if (!user) return fail(request, "Entre na sua conta para editar playlists.", 401);
    const access = await env.DB.prepare(`SELECT c.owner_id,EXISTS(SELECT 1 FROM social_playlist_collaborators m WHERE m.playlist_id=c.playlist_id AND m.user_id=? AND EXISTS(SELECT 1 FROM friendships f WHERE f.user_id=c.owner_id AND f.friend_id=m.user_id) AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=c.owner_id AND b.blocked_id=m.user_id) OR (b.user_id=m.user_id AND b.blocked_id=c.owner_id))) AS can_edit FROM social_collaborative_playlists c WHERE c.playlist_id=?`).bind(user.id, playlistTrackMatch[1]).first();
    if (access && access.owner_id !== user.id && !access.can_edit) return fail(request, "Voc\xEA n\xE3o \xE9 colaborador desta playlist.", 403);
    const payload = await request.json();
    const trackIds = Array.isArray(payload.trackIds) ? [...new Set(payload.trackIds.map(String))].slice(0, 500) : [String(payload.trackId || "")];
    const statements = trackIds.filter(Boolean).map((id, position) => env.DB.prepare("INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) SELECT ?, id, (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?) + ? FROM tracks WHERE id = ?").bind(playlistTrackMatch[1], playlistTrackMatch[1], position, id));
    if (statements.length) await env.DB.batch(statements);
    return json(request, { ok: true });
  }
  const favoriteMatch = path.match(/^\/api\/tracks\/([^/]+)\/favorite$/);
  if (favoriteMatch && request.method === "POST") {
    if (!user) return fail(request, "Entre na sua conta para salvar favoritos.", 401);
    const payload = await request.json();
    if (payload.favorite) await env.DB.prepare("INSERT OR IGNORE INTO user_favorites (user_id,track_id) SELECT ?,id FROM tracks WHERE id=?").bind(user.id, favoriteMatch[1]).run();
    else await env.DB.prepare("DELETE FROM user_favorites WHERE user_id=? AND track_id=?").bind(user.id, favoriteMatch[1]).run();
    return json(request, { ok: true });
  }
  const historyMatch = path.match(/^\/api\/tracks\/([^/]+)\/history$/);
  if (historyMatch && request.method === "POST") {
    if (!user) return fail(request, "Entre na sua conta para salvar o hist\xF3rico.", 401);
    await env.DB.prepare("INSERT INTO user_history (user_id,track_id) SELECT ?,id FROM tracks WHERE id=?").bind(user.id, historyMatch[1]).run();
    await env.DB.prepare("DELETE FROM user_history WHERE user_id=? AND (played_at,id) < (SELECT played_at,id FROM user_history WHERE user_id=? ORDER BY played_at DESC,id DESC LIMIT 1 OFFSET 199)").bind(user.id, user.id).run();
    return json(request, { ok: true }, 201);
  }
  const trackMatch = path.match(/^\/api\/tracks\/([^/]+)$/);
  if (trackMatch && request.method === "PUT") {
    if (!user) return fail(request, "Entre na sua conta para editar m\xFAsicas.", 401);
    const current = await env.DB.prepare("SELECT * FROM tracks WHERE id=? AND import_batch_id IS NULL").bind(trackMatch[1]).first();
    if (!current) return fail(request, "M\xFAsica n\xE3o encontrada.", 404);
    const body2 = await request.json(), title = String(body2.title ?? current.title).trim().slice(0, 180), artist = String(body2.artist ?? current.artist).trim().slice(0, 180);
    const albumId = body2.albumId === void 0 ? current.primary_album_id : body2.albumId || null;
    const album = albumId ? await env.DB.prepare("SELECT id,title FROM albums WHERE id=?").bind(albumId).first() : null;
    if (!title || !artist || albumId && !album) return fail(request, "Preencha nome, artista e um \xE1lbum v\xE1lido.");
    const meta = parseMetadata(current.metadata_json);
    if (["album", "individual"].includes(body2.coverMode)) meta.coverMode = body2.coverMode;
    const statements = [env.DB.prepare("UPDATE tracks SET title=?,artist=?,album=?,primary_album_id=?,metadata_json=? WHERE id=?").bind(title, artist, album?.title || current.album, album?.id || null, JSON.stringify(meta), current.id)];
    if (body2.albumId !== void 0 && (body2.albumId || null) !== current.primary_album_id) {
      statements.push(env.DB.prepare("DELETE FROM album_tracks WHERE track_id=?").bind(current.id));
      if (album) statements.push(env.DB.prepare("INSERT INTO album_tracks (album_id,track_id,position) VALUES (?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM album_tracks WHERE album_id=?))").bind(album.id, current.id, album.id));
    }
    await env.DB.batch(statements);
    return json(request, { ok: true });
  }
  if (trackMatch && request.method === "DELETE") {
    if (!user) return fail(request, "Entre na sua conta para excluir m\xFAsicas.", 401);
    const track = await env.DB.prepare("SELECT audio_key, cover_key, main_key FROM tracks WHERE id = ?").bind(trackMatch[1]).first();
    if (track) await Promise.all([track.audio_key, track.cover_key, track.main_key].filter(Boolean).map((key) => env.MEDIA.delete(key)));
    await env.DB.prepare("DELETE FROM tracks WHERE id = ?").bind(trackMatch[1]).run();
    return json(request, { ok: true });
  }
  return fail(request, "Rota n\xE3o encontrada.", 404);
}
__name(route, "route");
var index_default = {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupSocial(env));
  },
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigins.has(origin)) return new Response("Origin not allowed", { status: 403 });
    try {
      return await route(request, env, ctx);
    } catch (error) {
      console.error(JSON.stringify({ event: "api_error", message: error instanceof Error ? error.message : "unknown" }));
      return fail(request, "N\xE3o foi poss\xEDvel concluir a opera\xE7\xE3o.", 500);
    }
  }
};
export {
  ListeningSession,
  SocialUser,
  index_default as default
};
//# sourceMappingURL=index.js.map
