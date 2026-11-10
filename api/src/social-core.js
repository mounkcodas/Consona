export const defaults = Object.freeze({ requests: 'everyone', messages: 'friends', show_presence: 1, show_activity: 0, share_history: 0, listening_invites: 'friends', call_invites: 'none', presence: 'online', status_text: '', browser_notifications: 0 });
export const uuid = value => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(String(value || ''));
export const pairId = (a, b) => [a, b].sort().join(':');
export const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
export function problem(message, status = 400) { return Object.assign(new Error(message), { status }); }
export function person(row, origin) {
  return { id: row.id, username: row.username, displayName: row.display_name, avatar: row.avatar_key ? `${origin}/api/media/${encodeURIComponent(row.avatar_key)}` : '', joinedAt: row.created_at };
}
export function message(row) {
  return { id: row.id, seq: row.seq, conversationId: row.conversation_id, senderId: row.sender_id, clientId: row.client_id, text: row.body, kind: row.kind, payload: parse(row.payload_json), createdAt: row.created_at, editedAt: row.edited_at, deletedAt: row.deleted_at, replyTo: row.reply_to || null };
}
export async function settings(env, id) {
  return { ...defaults, ...await env.DB.prepare('SELECT * FROM user_social_settings WHERE user_id=?').bind(id).first() };
}
export async function relationship(env, a, b) {
  return env.DB.prepare(`SELECT
    EXISTS(SELECT 1 FROM friendships WHERE user_id=? AND friend_id=?) AS friends,
    EXISTS(SELECT 1 FROM user_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)) AS blocked`)
    .bind(a, b, a, b, b, a).first();
}
export async function requireFriend(env, a, b) {
  const relation = await relationship(env, a, b);
  if (!relation.friends || relation.blocked) throw problem('Esta ação está disponível apenas entre amigos.', 403);
}
export async function member(env, id, userId) {
  const row = await env.DB.prepare('SELECT * FROM conversation_members WHERE conversation_id=? AND user_id=?').bind(id, userId).first();
  if (!row) throw problem('Conversa não encontrada.', 404);
  await requireFriend(env, userId, row.peer_id);
  return row;
}
export async function rate(env, userId, scope, count = 60, seconds = 60) {
  if (!await env.SOCIAL.getByName(userId).consume(scope, count, seconds)) throw problem('Muitas tentativas. Aguarde um momento e tente novamente.', 429);
}
export async function notify(env, recipient, actor, kind, payload, id = crypto.randomUUID()) {
  await env.DB.prepare('INSERT OR IGNORE INTO social_notifications(id,user_id,actor_id,kind,payload_json,created_at) VALUES(?,?,?,?,?,?)')
    .bind(id, recipient, actor, kind, JSON.stringify(payload), Date.now()).run();
  await env.SOCIAL.getByName(recipient).deliver({ type: 'notification', id, actorId: actor, kind, payload, createdAt: Date.now() });
}
export async function emit(env, ids, event) {
  await Promise.all([...new Set(ids)].map(id => env.SOCIAL.getByName(id).deliver(event)));
}
export async function refreshPeople(env, ids) {
  await Promise.all([...new Set(ids)].map(id => env.SOCIAL.getByName(id).refresh(id)));
}
export const authorizedSql = `EXISTS(SELECT 1 FROM friendships f WHERE f.user_id=? AND f.friend_id=?)
  AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=? AND b.blocked_id=?) OR (b.user_id=? AND b.blocked_id=?))`;
export const authBindings = (a, b) => [a, b, a, b, b, a];
