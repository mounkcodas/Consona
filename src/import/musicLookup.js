import { normalize } from './model.js';
let nextSearchAt = 0;
async function musicBrainzRequest(path, params, apiRequest) {
  const [entity, id] = path.split('/');
  const endpoint = `/api/musicbrainz?${new URLSearchParams({ entity, ...(id ? { id } : {}), ...params })}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = Math.max(0, nextSearchAt - Date.now());
    nextSearchAt = Date.now() + wait + 1100;
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    try { return await apiRequest(endpoint); }
    catch (error) {
      if (!error.message.includes('temporariamente') || attempt === 2) throw error;
      nextSearchAt = Math.max(nextSearchAt, Date.now() + 1600 * (attempt + 1));
    }
  }
}
const musicBrainz = (path, query, apiRequest) => musicBrainzRequest(`${path}/`, { query, limit: '8' }, apiRequest);
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
function wikidataDate(statement) {
  const value = statement?.mainsnak?.datavalue?.value;
  const match = String(value?.time || '').match(/^[+-](\d{4,})-(\d{2})-(\d{2})/);
  if (!match) return '';
  return value.precision >= 11 ? `${match[1]}-${match[2]}-${match[3]}` : value.precision >= 10 ? `${match[1]}-${match[2]}` : match[1];
}
function wikipediaRecordingDate(html) {
  const cell = String(html || '').match(/<th[^>]*>\s*Recorded\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i)?.[1];
  if (!cell) return '';
  return cell.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&(ndash|mdash|nbsp|amp);/gi, (_, value) => ({ ndash: '–', mdash: '—', nbsp: ' ', amp: '&' })[value.toLowerCase()])
    .replace(/\s+/g, ' ').trim().slice(0, 100);
}
export async function identifyTrack(row, apiRequest) {
  const query = `recording:"${escapeQuery(row.title)}"${row.artist ? ` AND artist:"${escapeQuery(row.artist)}"` : ''}`;
  let candidates = [], lastfm;
  try {
    const payload = await musicBrainz('recording', query, apiRequest);
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
      const payload = await musicBrainz('release-group', query, apiRequest);
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
  const payload = await musicBrainzRequest('release/', { 'release-group': album.releaseGroupId, inc: 'recordings', limit: '25' }, apiRequest);
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

export async function getAlbumDetails(album, apiRequest) {
  const lastfm = album.artist ? apiRequest(`/api/lastfm?${new URLSearchParams({ method: 'album.getInfo', artist: album.artist, album: album.title })}`) : Promise.resolve({});
  const ranking = album.artist ? apiRequest(`/api/lastfm?${new URLSearchParams({ method: 'artist.getTopAlbums', artist: album.artist, limit: '100' })}`) : Promise.resolve({});
  const audioDb = (async () => {
    if (!album.artist) return {};
    const params = new URLSearchParams({ s: album.artist, a: album.title });
    const response = await fetch(`https://www.theaudiodb.com/api/v1/json/123/searchalbum.php?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return {};
    const data = await response.json();
    return (data.album || []).find(item => similarity(item.strAlbum, album.title) >= .82 && similarity(item.strArtist, album.artist) >= .75) || {};
  })();
  const spotify = (async () => {
    let id = album.metadata?.spotifyId;
    if (!id && album.artist) {
      const results = await apiRequest(`/api/spotify/albums/search?${new URLSearchParams({ q: `${album.title} ${album.artist}` })}`);
      id = (results.albums || []).find(item => similarity(item.title, album.title) >= .85 && similarity(item.artist, album.artist) >= .75)?.id;
    }
    return id ? apiRequest(`/api/spotify/albums/${id}`) : {};
  })();
  const musicBrainzDetails = (async () => {
    let groupId = album.metadata?.releaseGroupId;
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(groupId || '')) {
      const results = await musicBrainz('release-group', `releasegroup:"${escapeQuery(album.title)}"${album.artist ? ` AND artist:"${escapeQuery(album.artist)}"` : ''} AND primarytype:album`, apiRequest);
      groupId = (results['release-groups'] || []).find(item => similarity(item.title, album.title) >= .9)?.id;
    }
    if (!groupId) return {};
    const group = await musicBrainzRequest(`release-group/${groupId}`, { inc: 'genres ratings annotation url-rels' }, apiRequest);
    let recordedDate = '', wikidataReleaseDate = '', wikidataLanguage = '', wikidataGenres = [];
    const wikidataUrl = (group.relations || []).find(relation => relation.type === 'wikidata')?.url?.resource || '';
    const wikidataId = wikidataUrl.match(/\/wiki\/(Q\d+)$/)?.[1];
    if (wikidataId) {
      try {
        const response = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: wikidataId, props: 'claims|sitelinks', sitefilter: 'enwiki', format: 'json', origin: '*' })}`, { signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          const entity = (await response.json()).entities?.[wikidataId] || {};
          const claims = entity.claims || {};
          recordedDate = (claims.P10135 || []).filter(item => item.rank !== 'deprecated').map(wikidataDate).filter(Boolean).slice(0, 3).join(' · ');
          wikidataReleaseDate = (claims.P577 || []).filter(item => item.rank !== 'deprecated').map(wikidataDate).find(Boolean) || '';
          const languageId = claims.P407?.find(item => item.rank !== 'deprecated')?.mainsnak?.datavalue?.value?.id;
          const genreIds = (claims.P136 || []).filter(item => item.rank !== 'deprecated').map(item => item.mainsnak?.datavalue?.value?.id).filter(Boolean).slice(0, 6);
          if (!recordedDate && entity.sitelinks?.enwiki?.title) {
            try {
              const page = entity.sitelinks.enwiki.title;
              const wikipediaResponse = await fetch(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'parse', page, prop: 'text', section: '0', format: 'json', formatversion: '2', origin: '*' })}`, { signal: AbortSignal.timeout(8000) });
              if (wikipediaResponse.ok) recordedDate = wikipediaRecordingDate((await wikipediaResponse.json()).parse?.text);
            } catch { /* A página vinculada pode não ter ficha com data de gravação. */ }
          }
          const ids = [languageId, ...genreIds].filter(Boolean);
          if (ids.length) {
            const labelResponse = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: [...new Set(ids)].join('|'), props: 'labels', languages: 'pt|en', format: 'json', origin: '*' })}`, { signal: AbortSignal.timeout(8000) });
            if (labelResponse.ok) {
              const entities = (await labelResponse.json()).entities || {};
              const label = id => entities[id]?.labels?.pt?.value || entities[id]?.labels?.en?.value || '';
              wikidataLanguage = languageId ? label(languageId) : '';
              wikidataGenres = genreIds.map(label).filter(Boolean);
            }
          }
        }
      } catch { /* A falta de dados no Wikidata não bloqueia as demais fontes. */ }
    }
    let language = '';
    try {
      const releases = await musicBrainzRequest('release/', { 'release-group': groupId, limit: '15' }, apiRequest);
      const preferred = (releases.releases || []).sort((a, b) => Number(b.status === 'Official') - Number(a.status === 'Official') || (a.date || '9999').localeCompare(b.date || '9999'));
      language = preferred.find(release => release['text-representation']?.language)?.['text-representation']?.language || '';
    } catch {}
    return { releaseDate: group['first-release-date'] || wikidataReleaseDate, recordedDate, language: wikidataLanguage || language, genres: (group.genres || []).sort((a, b) => Number(b.count || 0) - Number(a.count || 0)).slice(0, 6).map(item => item.name), wikidataGenres, rating: group.rating?.value || '', ratingCount: group.rating?.['votes-count'] || 0, annotation: group.annotation || '' };
  })();
  const [fmResult, rankResult, mbResult, audioDbResult, spotifyResult] = await Promise.allSettled([lastfm, ranking, musicBrainzDetails, audioDb, spotify]);
  if ([fmResult, mbResult, audioDbResult, spotifyResult].every(result => result.status === 'rejected')) throw new Error('As fontes de dados dos álbuns estão indisponíveis no momento.');
  const fm = fmResult.status === 'fulfilled' ? fmResult.value.album || {} : {};
  const chart = rankResult.status === 'fulfilled' ? rankResult.value.topalbums?.album || [] : [];
  const mb = mbResult.status === 'fulfilled' ? mbResult.value : {};
  const audio = audioDbResult.status === 'fulfilled' ? audioDbResult.value : {};
  const spotifyAlbum = spotifyResult.status === 'fulfilled' ? spotifyResult.value : {};
  const ranked = (Array.isArray(chart) ? chart : [chart]).find(item => normalize(item.name) === normalize(album.title));
  const tags = fm.toptags?.tag || [];
  const genres = (Array.isArray(tags) ? tags : [tags]).map(item => item.name).filter(Boolean).slice(0, 6);
  return {
    releaseDate: mb.releaseDate || fm.releasedate?.trim() || spotifyAlbum.releaseDate || audio.intYearReleased || album.metadata?.releaseYear || '',
    recordedDate: album.metadata?.recordedDate || mb.recordedDate || '',
    rank: ranked ? Number(ranked['@attr']?.rank) || (Array.isArray(chart) ? chart.indexOf(ranked) + 1 : 1) : null,
    genres: genres.length ? genres : mb.genres?.length ? mb.genres : mb.wikidataGenres?.length ? mb.wikidataGenres : [audio.strGenre, audio.strStyle].filter(Boolean),
    description: fm.wiki?.content || fm.wiki?.summary || mb.annotation || audio.strDescriptionPT || audio.strDescriptionEN || album.metadata?.description || '',
    language: mb.language || album.metadata?.language || '',
    listeners: Number(fm.listeners) || 0,
    playcount: Number(fm.playcount) || 0,
    musicBrainzRating: mb.rating || '',
    musicBrainzRatingCount: mb.ratingCount || 0,
  };
}
