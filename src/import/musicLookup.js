import { normalize } from './model.js';
let nextSearchAt = 0;
async function musicBrainz(path, query) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = Math.max(0, nextSearchAt - Date.now());
    nextSearchAt = Date.now() + wait + 1100;
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    const response = await fetch(`https://musicbrainz.org/ws/2/${path}/?${new URLSearchParams({ query, fmt: 'json', limit: '5' })}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (response.ok) return response.json();
    if (![429, 503].includes(response.status) || attempt === 2) throw new Error('A busca está temporariamente indisponível. Tente novamente.');
    nextSearchAt = Math.max(nextSearchAt, Date.now() + 1600 * (attempt + 1));
  }
}
const escapeQuery = value => String(value || '').replace(/["\\]/g, ' ');
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
export async function findAlbums(title, artist) {
  const payload = await musicBrainz('release-group', `releasegroup:"${escapeQuery(title)}"${artist ? ` AND artist:"${escapeQuery(artist)}"` : ''} AND primarytype:album`);
  return Promise.all((payload['release-groups'] || []).map(async item => {
    let coverUrl = '';
    try {
      const response = await fetch(`https://coverartarchive.org/release-group/${item.id}`, { signal: AbortSignal.timeout(8000) });
      const data = response.ok ? await response.json() : null;
      const image = data?.images?.find(image => image.front);
      coverUrl = (image?.thumbnails?.['500'] || image?.thumbnails?.['250'] || '').replace(/^http:/, 'https:');
    } catch {}
    return { title: item.title, artist: (item['artist-credit'] || []).map(credit => credit.name || credit.artist?.name).filter(Boolean).join(', '), coverUrl, releaseGroupId: item.id, year: (item['first-release-date'] || '').slice(0, 4), source: 'MusicBrainz' };
  }));
}
