import test from 'node:test';
import assert from 'node:assert/strict';
import { addNextUp, selectAdjacentTrack } from './nextUp.js';

const base = { trackIds: ['a', 'b', 'c', 'x', 'y'], isPlayable: () => true };

test('the most recently queued track plays next without duplicates', () => {
  const pending = ['x', 'y'];
  assert.deepEqual(addNextUp(pending, 'y'), ['y', 'x']);
  assert.deepEqual(pending, ['x', 'y']);
});

test('queued tracks play before the next album track, then the album resumes', () => {
  const albumIds = ['a', 'b', 'c'];
  const first = selectAdjacentTrack({ ...base, albumIds, currentId: 'a', originId: null, pendingIds: ['x', 'y'] });
  assert.equal(first.id, 'x');
  assert.equal(first.originId, 'a');
  const second = selectAdjacentTrack({ ...base, albumIds, currentId: first.id, originId: first.originId, pendingIds: first.pendingIds });
  assert.equal(second.id, 'y');
  const resumed = selectAdjacentTrack({ ...base, albumIds, currentId: second.id, originId: second.originId, pendingIds: second.pendingIds });
  assert.equal(resumed.id, 'b');
  assert.equal(resumed.originId, null);
});

test('a queued track can play after the last album track, then playback stops', () => {
  const albumIds = ['a', 'b'];
  const queued = selectAdjacentTrack({ ...base, albumIds, currentId: 'b', originId: null, pendingIds: ['x'] });
  assert.equal(queued.id, 'x');
  const end = selectAdjacentTrack({ ...base, albumIds, currentId: 'x', originId: queued.originId, pendingIds: queued.pendingIds });
  assert.equal(end.stop, true);
});

test('missing queued tracks are skipped and shuffle does not displace the next track', () => {
  const next = selectAdjacentTrack({ ...base, currentId: 'a', originId: null, pendingIds: ['missing', 'x'], isPlayable: id => id !== 'missing', shuffle: true, random: () => 0 });
  assert.equal(next.id, 'x');
  assert.deepEqual(next.pendingIds, []);
});
