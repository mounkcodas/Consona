import test from 'node:test';
import assert from 'node:assert/strict';
import { filenameMetadata, groupDetected, historyReducer, moveTracks, newDraft, orderAlbumTracks, validateDraft } from './model.js';

test('28 mixed tracks can be grouped into three independent albums', () => {
  const draft = newDraft();
  draft.tracks = Array.from({ length: 28 }, (_, index) => ({ key: `track-${index}`, title: `Faixa ${index}`, artist: 'Artista', albumHint: `Álbum ${index % 3}`, albumKey: '', fileKey: `file-${index}` }));
  const grouped = groupDetected(draft);
  assert.equal(grouped.albums.length, 3);
  assert.deepEqual(grouped.albums.map(album => grouped.tracks.filter(row => row.albumKey === album.key).length), [10, 9, 9]);
  assert.equal(validateDraft(grouped).filter(issue => issue.severity === 'error').length, 0);
});
test('moving a selection inherits artwork without deleting individual artwork', () => {
  const draft = { tracks: [{ key: 'a', albumKey: '', coverMode: 'individual', coverFileKey: 'own-image' }, { key: 'b', albumKey: '' }, { key: 'c', albumKey: 'album' }], albums: [{ key: 'album' }] };
  const moved = moveTracks(draft, ['a', 'b'], 'album', 'c');
  assert.deepEqual(moved.tracks.map(row => row.key), ['a', 'b', 'c']);
  assert.equal(moved.tracks[0].coverMode, 'album');
  assert.equal(moved.tracks[0].coverFileKey, 'own-image');
  assert.equal(draft.tracks[0].albumKey, '');
});
test('undo and redo restore a whole move operation', () => {
  const initial = { past: [], present: { tracks: [{ key: 'a', albumKey: '' }], albums: [] }, future: [] };
  const moved = historyReducer(initial, { type: 'change', value: value => moveTracks(value, ['a'], 'album') });
  const undo = historyReducer(moved, { type: 'undo' });
  assert.equal(undo.present.tracks[0].albumKey, '');
  assert.equal(historyReducer(undo, { type: 'redo' }).present.tracks[0].albumKey, 'album');
});
test('validation identifies duplicate audio, missing metadata and missing destinations', () => {
  const draft = { albums: [], tracks: [{ key: 'a', title: '', artist: '', fileKey: 'a', fileHash: 'same' }, { key: 'b', title: 'Song', artist: 'Artist', fileKey: 'b', fileHash: 'same' }] };
  const errors = validateDraft(draft).filter(issue => issue.severity === 'error');
  assert.equal(errors.length, 4);
  assert.ok(errors.some(issue => issue.message.includes('duplicado')));
});
test('compilation grouping uses album artist and does not split guest artists', () => {
  const draft = { albums: [], tracks: [{ key: 'a', artist: 'Convidado A', albumArtistHint: 'Vários artistas', albumHint: 'Coletânea' }, { key: 'b', artist: 'Convidado B', albumArtistHint: 'Vários artistas', albumHint: 'Coletânea' }] };
  assert.equal(groupDetected(draft).albums.length, 1);
});
test('filename parsing preserves a title containing separators', () => {
  assert.deepEqual(filenameMetadata({ name: '02. Radiohead - Exit Music - Live.mp3' }), { title: 'Exit Music - Live', artist: 'Radiohead', albumHint: '' });
});
test('album order follows catalog positions and leaves unmatched songs in place after matches', () => {
  const draft = { albums: [{ key: 'album' }], tracks: [
    { key: 'third', albumKey: 'album', title: 'Third song' },
    { key: 'other', albumKey: 'other', title: 'Keep me' },
    { key: 'unknown', albumKey: 'album', title: 'Unreleased demo' },
    { key: 'first', albumKey: 'album', title: 'First song' },
    { key: 'second', albumKey: 'album', title: 'Second song (Remastered)' },
  ] };
  const catalog = [{ title: 'Second song', disc: 1, position: 2 }, { title: 'Third song', disc: 1, position: 3 }, { title: 'First song', disc: 1, position: 1 }];
  const result = orderAlbumTracks(draft, 'album', catalog);
  assert.equal(result.matched, 3);
  assert.deepEqual(result.draft.tracks.map(row => row.key), ['first', 'other', 'second', 'third', 'unknown']);
  assert.deepEqual(draft.tracks.map(row => row.key), ['third', 'other', 'unknown', 'first', 'second']);
});
