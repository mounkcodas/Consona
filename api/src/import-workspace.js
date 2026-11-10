const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(value || ''));
const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const metadata = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
async function readTracks(env, ids) {
  const rows = [];
  for (const group of chunks(ids, 80)) rows.push(...(await env.DB.prepare(`SELECT * FROM tracks WHERE id IN (${group.map(() => '?').join(',')})`).bind(...group).all()).results);
  return rows;
}

export async function importRoutes(request, env, user, helpers) {
  const { json, fail, approvedImageUrl, mediaUrl, ctx } = helpers;
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/import/')) return null;
  if (!user) return fail(request, 'Entre na sua conta para organizar a biblioteca.', 401);
  if (path === '/api/import/covers' && request.method === 'POST') {
    if (Number(request.headers.get('Content-Length')) > 6 * 1024 * 1024) return fail(request, 'A capa deve ter até 5 MB.', 413);
    const form = await request.formData(), batchId = String(form.get('batchId') || ''), itemKey = String(form.get('itemKey') || ''), cover = form.get('cover');
    if (!uuid(batchId) || !itemKey || itemKey.length > 250) return fail(request, 'Rascunho inválido.');
    const prior = await env.DB.prepare('SELECT id FROM import_assets WHERE user_id=? AND batch_id=? AND item_key=?').bind(user.id, batchId, itemKey).first();
    if (prior) return json(request, { id: prior.id });
    if (!(cover instanceof File) || !cover.size || cover.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(cover.type)) return fail(request, 'Escolha uma capa JPG, PNG, WebP ou AVIF de até 5 MB.');
    const id = crypto.randomUUID(), key = `albums/${id}/cover.${cover.type.split('/')[1]}`;
    await env.MEDIA.put(key, cover.stream(), { httpMetadata: { contentType: cover.type, cacheControl: 'public, max-age=31536000, immutable' } });
    try { await env.DB.prepare('INSERT INTO import_assets (id,batch_id,user_id,item_key,media_key) VALUES (?,?,?,?,?)').bind(id, batchId, user.id, itemKey, key).run(); }
    catch (error) { await env.MEDIA.delete(key); const retry = await env.DB.prepare('SELECT id FROM import_assets WHERE user_id=? AND batch_id=? AND item_key=?').bind(user.id, batchId, itemKey).first(); if (retry) return json(request, { id: retry.id }); throw error; }
    return json(request, { id }, 201);
  }
  if (path === '/api/import/commit' && request.method === 'POST') {
    if (Number(request.headers.get('Content-Length')) > 1024 * 1024) return fail(request, 'Este rascunho excede o limite de dados.', 413);
    const payload = await request.json(), batchId = String(payload.batchId || '');
    if (!uuid(batchId) || !Array.isArray(payload.albums) || !Array.isArray(payload.tracks) || !Array.isArray(payload.playlists || []) || (!payload.albums.length && !(payload.playlists || []).length) || payload.albums.length > 100 || (payload.playlists || []).length > 100 || payload.tracks.length > 500) return fail(request, 'Revise a quantidade de m\u00fasicas, \u00e1lbuns e playlists do rascunho.');
    const committed = await env.DB.prepare('SELECT user_id,result_json FROM import_batches WHERE id=?').bind(batchId).first();
    if (committed) return committed.user_id === user.id ? json(request, metadata(committed.result_json)) : fail(request, 'Este rascunho pertence a outra conta.', 403);
    const albumKeys = new Set(), trackIds = new Set(), existingIds = new Set(), playlistKeys = new Set(), existingPlaylistIds = new Set();
    const albums = payload.albums.map(item => ({ ...item, title: String(item.title || '').trim().slice(0, 180), artist: String(item.artist || '').trim().slice(0, 180) }));
    const playlists = (payload.playlists || []).map(item => ({ ...item, name: String(item.name || '').trim().slice(0, 100) }));
    const tracks = payload.tracks.map(item => ({ ...item, title: String(item.title || '').trim().slice(0, 180), artist: String(item.artist || '').trim().slice(0, 180) }));
    for (const album of albums) {
      if (!uuid(album.key) || albumKeys.has(album.key) || !album.title || (album.existingId && !uuid(album.existingId))) return fail(request, 'Um dos álbuns está incompleto ou repetido.');
      if (album.existingId && existingIds.has(album.existingId)) return fail(request, 'O mesmo álbum aparece duas vezes no rascunho.');
      if (album.existingId) existingIds.add(album.existingId);
      albumKeys.add(album.key);
    }
    for (const playlist of playlists) {
      if (!uuid(playlist.key) || playlistKeys.has(playlist.key) || !playlist.name || !Array.isArray(playlist.trackIds) || playlist.trackIds.length > 500 || new Set(playlist.trackIds).size !== playlist.trackIds.length || (playlist.existingId && !uuid(playlist.existingId))) return fail(request, 'Uma playlist est\u00e1 incompleta ou repetida.');
      if (playlist.existingId && existingPlaylistIds.has(playlist.existingId)) return fail(request, 'A mesma playlist aparece duas vezes no rascunho.');
      playlistKeys.add(playlist.key);
      if (playlist.existingId) existingPlaylistIds.add(playlist.existingId);
    }
    for (const track of tracks) {
      if (!uuid(track.id) || trackIds.has(track.id) || !track.title || !track.artist || (track.albumKey && !albumKeys.has(track.albumKey)) || (!track.albumKey && !playlists.some(list => list.trackIds.includes(track.id))) || !['album', 'individual'].includes(track.coverMode)) return fail(request, 'Uma das m\u00fasicas est\u00e1 incompleta, repetida ou sem \u00e1lbum ou playlist.');
      if (track.identification && (typeof track.identification !== 'object' || Array.isArray(track.identification) || JSON.stringify(track.identification).length > 16000)) return fail(request, 'Os dados de identificação de uma música são inválidos.');
      trackIds.add(track.id);
    }
    if (playlists.some(playlist => playlist.trackIds.some(id => !trackIds.has(id)))) return fail(request, 'Uma playlist cont\u00e9m m\u00fasica fora do rascunho.');
    const storedTracks = await readTracks(env, [...trackIds]);
    if (storedTracks.length !== tracks.length) return fail(request, 'Uma música foi removida da biblioteca. Atualize o rascunho.', 409);
    if (storedTracks.some(row => row.import_batch_id && (row.import_batch_id !== batchId || row.added_by !== user.id))) return fail(request, 'Uma música pertence a outro rascunho.', 403);
    const existingAlbums = [], memberships = [];
    for (const ids of chunks([...existingIds], 80)) {
      const placeholders = ids.map(() => '?').join(',');
      const [albumRows, membershipRows] = await env.DB.batch([
        env.DB.prepare(`SELECT * FROM albums WHERE id IN (${placeholders})`).bind(...ids),
        env.DB.prepare(`SELECT album_id,track_id,position FROM album_tracks WHERE album_id IN (${placeholders}) ORDER BY position,rowid`).bind(...ids),
      ]);
      existingAlbums.push(...albumRows.results);
      memberships.push(...membershipRows.results);
    }
    const existingPlaylists = [], playlistMemberships = [];
    for (const ids of chunks([...existingPlaylistIds], 80)) {
      const placeholders = ids.map(() => '?').join(',');
      const [playlistRows, membershipRows] = await env.DB.batch([
        env.DB.prepare(`SELECT id,name,cover_key FROM playlists WHERE id IN (${placeholders})`).bind(...ids),
        env.DB.prepare(`SELECT playlist_id,track_id FROM playlist_tracks WHERE playlist_id IN (${placeholders}) ORDER BY position,rowid`).bind(...ids),
      ]);
      existingPlaylists.push(...playlistRows.results);
      playlistMemberships.push(...membershipRows.results);
    }
    const assets = (await env.DB.prepare('SELECT * FROM import_assets WHERE user_id=? AND batch_id=?').bind(user.id, batchId).all()).results;
    if (tracks.some(track => track.coverAssetId && !assets.some(asset => asset.id === track.coverAssetId))) return fail(request, 'Selecione novamente uma das capas individuais.', 409);
    const pendingTracks = (await env.DB.prepare('SELECT id,audio_key,cover_key,main_key FROM tracks WHERE import_batch_id=? AND added_by=?').bind(batchId, user.id).all()).results;
    const statements = [], albumIds = new Map(), playlistIds = new Map();
    for (const album of albums) {
      const stored = album.existingId ? existingAlbums.find(item => item.id === album.existingId) : null;
      if (album.existingId && !stored) return fail(request, `O álbum “${album.title}” foi removido. Escolha outro destino.`, 409);
      if (stored && ((album.initialTitle !== undefined && album.initialTitle !== stored.title) || (album.initialArtist !== undefined && album.initialArtist !== stored.artist))) return fail(request, `O álbum “${stored.title}” mudou desde a abertura deste rascunho. Remova o cartão e adicione-o novamente.`, 409);
      if (stored && (stored.cover_key || stored.cover_url) && album.initialCover !== undefined && album.initialCover !== (mediaUrl(request, stored.cover_key) || stored.cover_url)) return fail(request, `A capa de “${stored.title}” foi alterada. Adicione esse álbum novamente ao rascunho.`, 409);
      const id = stored?.id || crypto.randomUUID(); albumIds.set(album.key, id);
      const asset = album.coverAssetId ? assets.find(item => item.id === album.coverAssetId) : null;
      if (album.coverAssetId && !asset) return fail(request, `Selecione novamente a capa de “${album.title}”.`, 409);
      let coverKey = stored?.cover_key || null, coverUrl = stored?.cover_url || '';
      const unchangedCover = stored && album.coverUrl === album.initialCover;
      if (asset) { coverKey = asset.media_key; coverUrl = ''; }
      else if (!unchangedCover) {
        coverUrl = album.coverUrl ? await approvedImageUrl(env, album.coverUrl, '') : '';
        if (album.coverUrl && !coverUrl) return fail(request, `A capa de “${album.title}” não pôde ser validada. Escolha uma imagem do seu dispositivo.`);
        coverKey = null;
      }
      const meta = { ...metadata(stored?.metadata_json), releaseGroupId: album.releaseGroupId ? String(album.releaseGroupId).slice(0, 60) : '', spotifyId: album.spotifyId ? String(album.spotifyId).slice(0, 40) : '', releaseYear: album.releaseYear && /^\d{4}$/.test(String(album.releaseYear)) ? String(album.releaseYear) : '', releaseYearSource: album.releaseYearSource === 'Spotify' ? 'Spotify' : 'MusicBrainz', sourceUrl: album.sourceUrl && /^https:\/\/open\.spotify\.com\/album\/[A-Za-z0-9]+/.test(album.sourceUrl) ? String(album.sourceUrl).slice(0, 200) : '' };
      if (stored) statements.push(env.DB.prepare('UPDATE albums SET title=?,artist=?,cover_key=?,cover_url=?,metadata_json=? WHERE id=?').bind(album.title, album.artist, coverKey, coverUrl, JSON.stringify(meta), id));
      else statements.push(env.DB.prepare('INSERT INTO albums (id,title,artist,cover_key,cover_url,metadata_json,added_by) VALUES (?,?,?,?,?,?,?)').bind(id, album.title, album.artist, coverKey, coverUrl, JSON.stringify(meta), user.id));
    }
    // Playlist-only tracks retain their existing album assignment.
    const albumTracks = tracks.filter(track => track.albumKey);
    for (const group of chunks(albumTracks, 14)) {
      const values = group.flatMap(row => [row.id, row.title, row.artist, albumIds.get(row.albumKey), albums.find(album => album.key === row.albumKey).title, JSON.stringify({ ...metadata(storedTracks.find(track => track.id === row.id)?.metadata_json), ...(row.identification ? { identification: row.identification } : {}), coverMode: row.coverMode })]);
      statements.push(env.DB.prepare(`WITH incoming(id,title,artist,album_id,album_title,meta_json) AS (VALUES ${group.map(() => '(?,?,?,?,?,?)').join(',')}) UPDATE tracks SET title=(SELECT title FROM incoming WHERE incoming.id=tracks.id),artist=(SELECT artist FROM incoming WHERE incoming.id=tracks.id),album=(SELECT album_title FROM incoming WHERE incoming.id=tracks.id),primary_album_id=(SELECT album_id FROM incoming WHERE incoming.id=tracks.id),metadata_json=(SELECT meta_json FROM incoming WHERE incoming.id=tracks.id),import_batch_id=NULL,import_item_key=NULL WHERE id IN (SELECT id FROM incoming)`).bind(...values));
    }
    const playlistOnlyEdits = tracks.filter(track => !track.albumKey).map(track => {
      const stored = storedTracks.find(row => row.id === track.id);
      const oldMeta = metadata(stored.metadata_json);
      const nextMeta = { ...oldMeta, ...(track.identification ? { identification: track.identification } : {}), ...(track.coverAssetId ? { coverMode: 'individual' } : {}) };
      return { ...track, meta: JSON.stringify(nextMeta), changed: !!stored.import_batch_id || stored.title !== track.title || stored.artist !== track.artist || JSON.stringify(oldMeta) !== JSON.stringify(nextMeta) };
    }).filter(track => track.changed);
    for (const group of chunks(playlistOnlyEdits, 20)) {
      const values = group.flatMap(track => [track.id, track.title, track.artist, track.meta]);
      statements.push(env.DB.prepare(`WITH incoming(id,title,artist,meta_json) AS (VALUES ${group.map(() => '(?,?,?,?)').join(',')}) UPDATE tracks SET title=(SELECT title FROM incoming WHERE incoming.id=tracks.id),artist=(SELECT artist FROM incoming WHERE incoming.id=tracks.id),metadata_json=(SELECT meta_json FROM incoming WHERE incoming.id=tracks.id),import_batch_id=NULL,import_item_key=NULL WHERE id IN (SELECT id FROM incoming)`).bind(...values));
    }
    for (const ids of chunks(albumTracks.map(track => track.id), 80)) statements.push(env.DB.prepare(`DELETE FROM album_tracks WHERE track_id IN (${ids.map(() => '?').join(',')})`).bind(...ids));
    for (const track of tracks.filter(track => track.coverAssetId)) {
      const asset = assets.find(asset => asset.id === track.coverAssetId);
      statements.push(env.DB.prepare("UPDATE tracks SET cover_key=?,metadata_json=json_remove(metadata_json,'$.coverUrl','$.googleCoverProof') WHERE id=?").bind(asset.media_key, track.id));
    }
    const links = [];
    for (const album of albums) {
      const id = albumIds.get(album.key);
      const preserved = memberships.filter(row => row.album_id === id && !trackIds.has(row.track_id));
      const next = tracks.filter(row => row.albumKey === album.key);
      const start = preserved.length ? Math.max(...preserved.map(row => row.position)) + 1 : 0;
      next.forEach((row, position) => links.push([id, row.id, start + position]));
    }
    for (const group of chunks(links, 30)) statements.push(env.DB.prepare(`INSERT INTO album_tracks (album_id,track_id,position) VALUES ${group.map(() => '(?,?,?)').join(',')}`).bind(...group.flat()));
    for (const playlist of playlists) {
      const stored = playlist.existingId ? existingPlaylists.find(item => item.id === playlist.existingId) : null;
      if (playlist.existingId && !stored) return fail(request, `A playlist “${playlist.name}” foi removida. Adicione-a novamente.`, 409);
      const originalIds = playlistMemberships.filter(item => item.playlist_id === stored?.id).map(item => item.track_id);
      if (stored && (stored.name !== playlist.initialName || JSON.stringify(originalIds) !== JSON.stringify(playlist.initialTrackIds || []))) return fail(request, `A playlist “${stored.name}” mudou desde a abertura do rascunho. Adicione-a novamente.`, 409);
      if (stored && playlist.initialCustomCover !== undefined && playlist.initialCustomCover !== (mediaUrl(request, stored.cover_key) || '')) return fail(request, `A capa de “${stored.name}” mudou desde a abertura do rascunho. Adicione a playlist novamente.`, 409);
      const id = stored?.id || crypto.randomUUID(); playlistIds.set(playlist.key, id);
      const cover = playlist.coverAssetId ? assets.find(asset => asset.id === playlist.coverAssetId) : null;
      if (playlist.coverAssetId && !cover) return fail(request, `Selecione novamente a capa de “${playlist.name}”.`, 409);
      const coverKey = cover?.media_key || stored?.cover_key || null;
      if (stored) statements.push(env.DB.prepare('UPDATE playlists SET name=?,cover_key=? WHERE id=?').bind(playlist.name, coverKey, id));
      else statements.push(env.DB.prepare('INSERT INTO playlists (id,name,added_by,cover_key) VALUES (?,?,?,?)').bind(id, playlist.name, user.id, coverKey));
      if (stored) statements.push(env.DB.prepare('DELETE FROM playlist_tracks WHERE playlist_id=?').bind(id));
      for (const group of chunks(playlist.trackIds.map((trackId, position) => [id, trackId, position]), 30)) {
        statements.push(env.DB.prepare(`INSERT INTO playlist_tracks (playlist_id,track_id,position) VALUES ${group.map(() => '(?,?,?)').join(',')}`).bind(...group.flat()));
      }
    }
    const result = { ok: true, tracks: tracks.length, albums: albums.length, playlists: playlists.length, albumIds: Object.fromEntries(albumIds), playlistIds: Object.fromEntries(playlistIds) };
    statements.push(env.DB.prepare('DELETE FROM tracks WHERE import_batch_id=? AND added_by=?').bind(batchId, user.id));
    statements.push(env.DB.prepare('DELETE FROM import_assets WHERE user_id=? AND batch_id=?').bind(user.id, batchId));
    statements.push(env.DB.prepare('INSERT INTO import_batches (id,user_id,result_json) VALUES (?,?,?)').bind(batchId, user.id, JSON.stringify(result)));
    await env.DB.batch(statements);
    const usedCovers = new Set([...albums.map(album => album.coverAssetId), ...playlists.map(playlist => playlist.coverAssetId), ...tracks.map(track => track.coverAssetId)].filter(Boolean));
    const unusedMedia = [...pendingTracks.filter(row => !trackIds.has(row.id)).flatMap(row => [row.audio_key, row.cover_key, row.main_key]), ...assets.filter(asset => !usedCovers.has(asset.id)).map(asset => asset.media_key)].filter(Boolean);
    if (unusedMedia.length) ctx.waitUntil((async () => { for (const group of chunks(unusedMedia, 100)) await env.MEDIA.delete(group); })().catch(error => console.error(JSON.stringify({ event: 'import_cleanup_failed', message: String(error) }))));
    return json(request, result);
  }
  const discard = path.match(/^\/api\/import\/batches\/([a-f0-9-]{36})$/i);
  if (discard && request.method === 'DELETE') {
    const batchId = discard[1];
    const tracks = (await env.DB.prepare('SELECT audio_key,cover_key,main_key FROM tracks WHERE import_batch_id=? AND added_by=?').bind(batchId, user.id).all()).results;
    const assets = (await env.DB.prepare('SELECT media_key FROM import_assets WHERE batch_id=? AND user_id=?').bind(batchId, user.id).all()).results;
    await env.DB.batch([env.DB.prepare('DELETE FROM tracks WHERE import_batch_id=? AND added_by=?').bind(batchId, user.id), env.DB.prepare('DELETE FROM import_assets WHERE batch_id=? AND user_id=?').bind(batchId, user.id)]);
    const keys = [...tracks.flatMap(row => [row.audio_key, row.cover_key, row.main_key]), ...assets.map(row => row.media_key)].filter(Boolean);
    for (const group of chunks(keys, 100)) await env.MEDIA.delete(group);
    return json(request, { ok: true });
  }
  return null;
}
