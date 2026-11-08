import { normalize } from './model.js';
let nextSearchAt = 0;
async function musicBrainzRequest(path, params) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = Math.max(0, nextSearchAt - Date.now());
    nextSearchAt = Date.now() + wait + 1100;
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    const response = await fetch(`https://musicbrainz.org/ws/2/${path}?${new URLSearchParams({ ...params, fmt: 'json' })}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (response.ok) return response.json();
    if (![429, 503].includes(response.status) || attempt === 2) throw new Error('A busca está temporariamente indisponível. Tente novamente.');
    nextSearchAt = Math.max(nextSearchAt, Date.now() + 1600 * (attempt + 1));
  }
}
const musicBrainz = (path, query) => musicBrainzRequest(`${path}/`, { query, limit: '8' });
const escapeQuery = value => String(value || '').replace(/["\\]/g, ' ');
const words = value => normalize(value).split(' ').filter(Boolean);
function similarity(a, b) {
  const left = normalize(a), right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0]; previous[0] = i;
    for (let j = 1; j <= right.length; j++) { const above = previous[j]; previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + Number(left[i - 1] !== right[j - 1])); diagonal = above; }
  }
  return Math.max(0, 1 - previous[right.length] / Math.max(left.length, right.length));
}
export async function identifyTrack(row, apiRequest) {
  const query = `recording:"${escapeQuery(row.title)}"${row.artist ? ` AND artist:"${escapeQuery(row.artist)}"` : ''}`;
  let candidates = [], lastfm;
  try {
    const payload = await musicBrainz('recording', query);
    candidates = (payload.recordings || []).map(recording => {
      const releases = [...(recording.releases || [])].sort((a, b) => Number(b['release-group']?.['primary-type'] === 'Album') - Number(a['release-group']?.['primary-type'] === 'Album'));
      const release = releases.find(item => normalize(item.title) === normalize(row.albumHint)) || releases[0];
      return { title: recording.title, artist: (recording['artist-credit'] || []).map(item => item.name || item.artist?.name).filter(Boolean).join(', '), album: release?.title || '', duration: Math.round((recording.length || 0) / 1000), releaseId: release?.id || '', releaseGroupId: release?.['release-group']?.id || '', recordingId: recording.id, year: (release?.date || recording['first-release-date'] || '').slice(0, 4), score: Number(recording.score || 0), source: 'MusicBrainz' };
    });
  } catch (error) { if (!row.artist) throw error; }
  if (row.artist) {
    try { const data = await apiRequest(`/api/lastfm?${new URLSearchParams({ method: 'track.getInfo', artist: row.artist, track: row.title })}`); const track = data.track; if (track) lastfm = { title: track.name, artist: track.artist?.name || row.artist, album: track.album?.title || '', duration: Math.round((Number(track.duration) || 0) / 1000), source: 'Last.fm', score: 100, tags: track.toptags?.tag || [], url: track.url || '' }; } catch {}
  }
  if (lastfm) {
    const same = candidates.find(item => normalize(item.title) === normalize(lastfm.title) && normalize(item.artist) === normalize(lastfm.artist));
    if (same) { same.album ||= lastfm.album; same.duration ||= lastfm.duration; same.lastfm = lastfm; same.source += ' + Last.fm'; } else candidates.push(lastfm);
  }
  if (!candidates.length) throw new Error('Nenhuma correspondência encontrada. Você pode preencher os dados manualmente.');
  return candidates;
}
export async function findAlbums(title, artist, apiRequest) {
  const candidates = new Map();
  let mbError;
  const queries = [
    `releasegroup:"${escapeQuery(title)}"${artist ? ` AND artist:"${escapeQuery(artist)}"` : ''} AND primarytype:album`,
    words(title).length ? `releasegroup:${words(title).map(word => `${escapeQuery(word)}~`).join(' AND releasegroup:')} AND primarytype:album` : '',
  ];
  for (const query of queries) {
    if (!query) continue;
    try {
      const payload = await musicBrainz('release-group', query);
      for (const item of payload['release-groups'] || []) candidates.set(item.id, { title: item.title, artist: (item['artist-credit'] || []).map(credit => credit.name || credit.artist?.name).filter(Boolean).join(', '), coverUrl: '', releaseGroupId: item.id, year: (item['first-release-date'] || '').slice(0, 4), source: 'MusicBrainz' });
      if ([...candidates.values()].some(item => similarity(title, item.title) > .94 && (!artist || similarity(artist, item.artist) > .75))) break;
    } catch (error) { mbError = error; }
  }
  if (apiRequest && ![...candidates.values()].some(item => similarity(title, item.title) > .94 && (!artist || similarity(artist, item.artist) > .75))) {
    try {
      let spotify = await apiRequest(`/api/spotify/albums/search?${new URLSearchParams({ q: `${title} ${artist}`.trim() })}`);
      if (!spotify.albums?.length && artist) spotify = await apiRequest(`/api/spotify/albums/search?${new URLSearchParams({ q: title })}`);
      for (const item of spotify.albums || []) candidates.set(`spotify:${item.id}`, { ...item, spotifyId: item.id, source: 'Spotify' });
    } catch { /* MusicBrainz results remain available when Spotify is unavailable. */ }
  }
  const ranked = [...candidates.values()].map(item => ({ ...item, matchScore: similarity(title, item.title) * .8 + (artist ? similarity(artist, item.artist) * .2 : .2) })).filter(item => item.matchScore >= .4).sort((a, b) => b.matchScore - a.matchScore).slice(0, 8);
  if (!ranked.length && mbError) throw mbError;
  return Promise.all(ranked.map(async item => {
    if (!item.releaseGroupId) return item;
    let coverUrl = '';
    try {
      const response = await fetch(`https://coverartarchive.org/release-group/${item.releaseGroupId}`, { signal: AbortSignal.timeout(8000) });
      const data = response.ok ? await response.json() : null;
      const image = data?.images?.find(image => image.front);
      coverUrl = (image?.thumbnails?.['500'] || image?.thumbnails?.['250'] || '').replace(/^http:/, 'https:');
    } catch {}
    return { ...item, coverUrl };
  }));
}

export async function getAlbumTracklist(album, apiRequest, expectedTitles = []) {
  if (album.spotifyId) return apiRequest(`/api/spotify/albums/${album.spotifyId}/tracks`);
  if (!album.releaseGroupId) throw new Error('Busque e selecione um álbum antes de ordenar.');
  const payload = await musicBrainzRequest('release/', { 'release-group': album.releaseGroupId, inc: 'recordings', limit: '25' });
  const releases = (payload.releases || []).filter(release => release.media?.some(medium => medium.tracks?.length));
  if (!releases.length) throw new Error('Nenhuma lista de faixas foi encontrada para esse álbum.');
  const expected = expectedTitles.map(normalize);
  const scored = releases.map(release => {
    const tracks = (release.media || []).flatMap((medium, disc) => (medium.tracks || []).map((track, index) => ({ title: track.title || track.recording?.title || '', recordingId: track.recording?.id || '', disc: medium.position || disc + 1, position: track.position || index + 1 })));
    const matches = expected.filter(title => tracks.some(track => similarity(title, track.title) >= .76)).length;
    const countDifference = Math.abs(tracks.length - expected.length);
    return { release, tracks, score: matches * 5 - countDifference + Number(release.status === 'Official') * 2 };
  }).sort((a, b) => b.score - a.score || (a.release.date || '9999').localeCompare(b.release.date || '9999'));
  return { tracks: scored[0].tracks, source: 'MusicBrainz' };
}
