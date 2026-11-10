export function addNextUp(pendingIds, trackId) {
  return [trackId, ...pendingIds.filter(id => id !== trackId)];
}

export function selectAdjacentTrack({ pendingIds, currentId, originId, trackIds, albumIds, direction = 1, shuffle = false, random = Math.random, isPlayable }) {
  const pending = pendingIds.filter(isPlayable);
  if (direction > 0 && pending.length) {
    return { id: pending[0], pendingIds: pending.slice(1), originId: originId || currentId, fromQueue: true };
  }
  if (direction < 0 && originId && isPlayable(originId)) {
    return { id: originId, pendingIds: pending, originId: null, fromQueue: false };
  }

  const order = albumIds ? albumIds.filter(isPlayable) : trackIds;
  if (!order.length) return { id: null, pendingIds: pending, originId: null, stop: true };
  const index = order.indexOf(originId || currentId);
  if (albumIds && direction > 0 && index === order.length - 1) {
    return { id: null, pendingIds: pending, originId: null, stop: true };
  }
  const target = !albumIds && shuffle && direction > 0
    ? Math.floor(random() * order.length)
    : (index + direction + order.length) % order.length;
  return { id: order[target], pendingIds: pending, originId: null, fromQueue: false };
}
