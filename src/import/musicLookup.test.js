import test from 'node:test';
import assert from 'node:assert/strict';
import { getAlbumDetails } from './musicLookup.js';

test('album details combine verified fallback sources and an explicit recording date', async () => {
  const originalFetch = globalThis.fetch;
  const json = value => Response.json(value);
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'www.wikidata.org' && url.searchParams.get('props')?.includes('claims')) return json({ entities: { Q123: { claims: {
      P10135: [{ rank: 'normal', mainsnak: { datavalue: { value: { time: '+1992-01-01T00:00:00Z', precision: 9 } } } }],
      P407: [{ mainsnak: { datavalue: { value: { id: 'Q1860' } } } }],
      P136: [{ mainsnak: { datavalue: { value: { id: 'Q11401' } } } }],
    } } } });
    if (url.hostname === 'www.wikidata.org' && url.searchParams.get('props') === 'labels') return json({ entities: {
      Q1860: { labels: { pt: { value: 'inglês' } } }, Q11401: { labels: { pt: { value: 'hip hop' } } },
    } });
    if (url.hostname === 'www.theaudiodb.com') return json({ album: [{ strAlbum: 'Example', strArtist: 'Example Artist', strDescriptionEN: 'Verified description', strGenre: 'Rap', intYearReleased: '1994' }] });
    throw new Error(`Unexpected request: ${url}`);
  };
  const apiRequest = async path => {
    if (path.startsWith('/api/musicbrainz')) {
      const url = new URL(path, 'https://consona.live');
      return url.searchParams.get('entity') === 'release-group'
        ? { 'first-release-date': '', genres: [], relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q123' } }] }
        : { releases: [] };
    }
    if (path.startsWith('/api/lastfm')) throw new Error('Last.fm unavailable');
    if (path.startsWith('/api/spotify/albums/search')) return { albums: [{ id: 'spotify123', title: 'Example', artist: 'Example Artist' }] };
    if (path === '/api/spotify/albums/spotify123') return { releaseDate: '1994-04-19' };
    throw new Error(`Unexpected API request: ${path}`);
  };
  try {
    const details = await getAlbumDetails({ title: 'Example', artist: 'Example Artist', metadata: { releaseGroupId: '28298e2c-4d70-3eed-a0f5-a3280c662b3d' } }, apiRequest);
    assert.equal(details.releaseDate, '1994-04-19');
    assert.equal(details.recordedDate, '1992');
    assert.equal(details.language, 'inglês');
    assert.deepEqual(details.genres, ['hip hop']);
    assert.equal(details.description, 'Verified description');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recording date falls back to the linked Wikipedia album infobox', async () => {
  const originalFetch = globalThis.fetch;
  const json = value => Response.json(value);
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'www.wikidata.org') return json({ entities: { Q123: { claims: {}, sitelinks: { enwiki: { title: 'Example (album)' } } } } });
    if (url.hostname === 'en.wikipedia.org') return json({ parse: { text: '<table class="infobox"><tr><th scope="row">Recorded</th><td>1992&#8211;1993<sup>[1]</sup></td></tr></table>' } });
    if (url.hostname === 'www.theaudiodb.com') return json({ album: [] });
    throw new Error(`Unexpected request: ${url}`);
  };
  const apiRequest = async path => {
    if (path.startsWith('/api/musicbrainz')) {
      const url = new URL(path, 'https://consona.live');
      return url.searchParams.get('entity') === 'release-group'
        ? { relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q123' } }] }
        : { releases: [] };
    }
    throw new Error('Catalog unavailable');
  };
  try {
    const details = await getAlbumDetails({ title: 'Example', artist: 'Example Artist', metadata: { releaseGroupId: '28298e2c-4d70-3eed-a0f5-a3280c662b3d' } }, apiRequest);
    assert.equal(details.recordedDate, '1992–1993');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
