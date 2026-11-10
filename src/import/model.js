export const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const newDraft = () => ({ version: 1, batchId: crypto.randomUUID(), tracks: [], albums: [], playlists: [] });
export const withPlaylists = draft => ({ ...draft, playlists: draft.playlists || [] });
export function addToPlaylist(draft, playlistKey, keys, beforeKey = '') {
  if (!draft.playlists.some(playlist => playlist.key === playlistKey)) return draft;
  const valid = keys.filter(key => draft.tracks.some(row => row.key === key));
  if (!valid.length || (beforeKey && valid.includes(beforeKey))) return draft;
  return { ...draft, playlists: draft.playlists.map(playlist => {
    if (playlist.key !== playlistKey) return playlist;
    const remaining = (playlist.trackKeys || []).filter(key => !valid.includes(key));
    const index = beforeKey ? remaining.indexOf(beforeKey) : -1;
    remaining.splice(index < 0 ? remaining.length : index, 0, ...valid);
    return { ...playlist, trackKeys: remaining };
  }) };
}
export function removeFromPlaylist(draft, playlistKey, trackKey) {
  return { ...draft, playlists: draft.playlists.map(playlist => playlist.key === playlistKey
    ? { ...playlist, trackKeys: (playlist.trackKeys || []).filter(key => key !== trackKey) } : playlist) };
}
export function sortPlaylist(draft, playlistKey) {
  const byKey = new Map(draft.tracks.map(row => [row.key, row]));
  return { ...draft, playlists: draft.playlists.map(playlist => playlist.key === playlistKey
    ? { ...playlist, trackKeys: [...(playlist.trackKeys || [])].sort((a, b) => (byKey.get(a)?.title || '').localeCompare(byKey.get(b)?.title || '', 'pt-BR', { sensitivity: 'base' })) } : playlist) };
}
export function filenameMetadata(file) {
  const path = (file.webkitRelativePath || '').split('/').filter(Boolean);
  const name = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^\d+[\s.-]+/, '').trim();
  const parts = name.split(/\s+-\s+/);
  return { title: parts.length > 1 ? parts.slice(1).join(' - ') : name, artist: parts.length > 1 ? parts[0] : path.length > 2 ? path.at(-3) : '', albumHint: path.length > 1 ? path.at(-2) : '' };
}
export function moveTracks(draft, keys, albumKey, beforeKey = '') {
  const moving = draft.tracks.filter(row => keys.includes(row.key));
  if (!moving.length || (beforeKey && keys.includes(beforeKey))) return draft;
  const remaining = draft.tracks.filter(row => !keys.includes(row.key));
  let index = beforeKey ? remaining.findIndex(row => row.key === beforeKey) : -1;
  if (index < 0) {
    index = remaining.reduce((last, row, i) => row.albumKey === albumKey ? i + 1 : last, remaining.length);
    // Append to the destination group; physical interleaving of other groups is irrelevant.
    if (!beforeKey) index = remaining.length;
  }
  remaining.splice(index, 0, ...moving.map(row => ({ ...row, albumKey, coverMode: albumKey ? 'album' : row.coverMode })));
  return { ...draft, tracks: remaining };
}
export function groupDetected(draft) {
  const albums = [...draft.albums];
  const tracks = draft.tracks.map(row => {
    if (row.albumKey || !row.albumHint?.trim()) return row;
    const artist = row.albumArtistHint || row.artist;
    let album = albums.find(item => normalize(item.title) === normalize(row.albumHint) && normalize(item.artist) === normalize(artist));
    if (!album) { album = { key: crypto.randomUUID(), title: row.albumHint, artist, coverUrl: row.suggestedCover || '', releaseGroupId: row.releaseGroupId || '', existingId: '' }; albums.push(album); }
    return { ...row, albumKey: album.key, coverMode: 'album' };
  });
  return { ...draft, tracks, albums };
}
function comparableTitle(value) {
  return normalize(value).replace(/\b(remaster(?:ed)?|remix|version|edition|feat|featuring)\b.*$/, '').trim();
}
function titleScore(left, right) {
  const a = comparableTitle(left), b = comparableTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]; previous[0] = i;
    for (let j = 1; j <= b.length; j++) { const above = previous[j]; previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + Number(a[i - 1] !== b[j - 1])); diagonal = above; }
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}
export function orderAlbumTracks(draft, albumKey, catalogTracks = []) {
  const albumRows = draft.tracks.filter(row => row.albumKey === albumKey);
  if (albumRows.length < 2) return { draft, matched: 0, total: albumRows.length };
  const slots = [...catalogTracks].sort((a, b) => Number(a.disc || 1) - Number(b.disc || 1) || Number(a.position || 0) - Number(b.position || 0));
  const pairs = albumRows.flatMap(row => slots.map((slot, index) => ({ row, index, score: row.metadata?.identification?.recordingId && row.metadata.identification.recordingId === slot.recordingId ? 1.1 : titleScore(row.title, slot.title) }))).filter(pair => pair.score >= .76).sort((a, b) => b.score - a.score);
  const matchedRows = new Set(), matchedSlots = new Set(), positions = new Map();
  for (const pair of pairs) { if (matchedRows.has(pair.row.key) || matchedSlots.has(pair.index)) continue; matchedRows.add(pair.row.key); matchedSlots.add(pair.index); positions.set(pair.row.key, pair.index); }
  let ordered = [...albumRows];
  if (positions.size) ordered.sort((a, b) => (positions.get(a.key) ?? Infinity) - (positions.get(b.key) ?? Infinity));
  else if (!slots.length && albumRows.some(row => Number(row.trackNo || row.metadata?.id3?.track) > 0)) ordered.sort((a, b) => (Number(a.trackNo || a.metadata?.id3?.track) || Infinity) - (Number(b.trackNo || b.metadata?.id3?.track) || Infinity));
  else return { draft, matched: 0, total: albumRows.length };
  const iterator = ordered[Symbol.iterator]();
  return { draft: { ...draft, tracks: draft.tracks.map(row => row.albumKey === albumKey ? iterator.next().value : row) }, matched: positions.size || ordered.filter(row => Number(row.trackNo || row.metadata?.id3?.track) > 0).length, total: albumRows.length };
}
export function validateDraft(draft, libraryTracks = []) {
  const issues = [], hashes = new Map();
  const playlists = draft.playlists || [];
  for (const playlist of playlists) {
    if (!playlist.name?.trim()) issues.push({ severity: 'error', key: playlist.key, message: 'Uma playlist est\u00e1 sem nome.' });
    if ((playlist.trackKeys || []).some(key => !draft.tracks.some(row => row.key === key))) issues.push({ severity: 'error', key: playlist.key, message: `A playlist ${playlist.name} cont\u00e9m uma m\u00fasica removida do rascunho.` });
  }
  for (const album of draft.albums) {
    if (!album.title.trim()) issues.push({ severity: 'error', key: album.key, message: 'Um álbum está sem nome.' });
    if (!album.artist.trim()) issues.push({ severity: 'warning', key: album.key, message: `Informe o artista de “${album.title || 'álbum sem nome'}” para facilitar a identificação.` });
  }
  for (const row of draft.tracks) {
    if (!row.title.trim() || !row.artist.trim()) issues.push({ severity: 'error', key: row.key, message: `${row.filename || row.title}: preencha nome e artista.` });
    if (!draft.albums.some(album => album.key === row.albumKey) && !playlists.some(playlist => (playlist.trackKeys || []).includes(row.key))) issues.push({ severity: 'error', key: row.key, message: `${row.title} ainda est\u00e1 sem \u00e1lbum ou playlist. Arraste para um cart\u00e3o.` });
    if (!row.existingId && !row.fileKey) issues.push({ severity: 'error', key: row.key, message: `O arquivo de “${row.title}” precisa ser selecionado novamente.` });
    if (row.fileHash) {
      if (hashes.has(row.fileHash)) issues.push({ severity: 'error', key: row.key, message: `Arquivo duplicado: “${row.filename}”. Remova uma das cópias.` });
      hashes.set(row.fileHash, row.key);
      if (!row.existingId && libraryTracks.some(track => track.fileHash === row.fileHash)) issues.push({ severity: 'error', key: row.key, message: `“${row.title}” já foi enviado à biblioteca. Use a música existente.` });
    }
    if (!row.existingId && libraryTracks.some(track => normalize(track.title) === normalize(row.title) && normalize(track.artist) === normalize(row.artist))) issues.push({ severity: 'warning', key: row.key, message: `Já existe uma faixa chamada “${row.title}” desse artista. Confira se é outra versão.` });
    if (row.matchConflict) issues.push({ severity: 'warning', key: row.key, message: `Há uma correspondência diferente para “${row.title}”. Revise as sugestões ou mantenha os dados manuais.` });
  }
  return issues;
}
export function historyReducer(history, action) {
  if (action.type === 'restore') return { past: [], present: action.value, future: [], lastKey: '' };
  if (action.type === 'undo' && history.past.length) return { past: history.past.slice(0, -1), present: history.past.at(-1), future: [history.present, ...history.future], lastKey: '' };
  if (action.type === 'redo' && history.future.length) return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1), lastKey: '' };
  if (action.type !== 'change') return history;
  const next = typeof action.value === 'function' ? action.value(history.present) : action.value;
  if (next === history.present) return history;
  return { past: action.coalesce && action.coalesce === history.lastKey ? history.past : [...history.past, history.present].slice(-40), present: next, future: [], lastKey: action.coalesce || '' };
}
