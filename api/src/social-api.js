import { defaults, uuid, pairId, parse, person, message, settings, relationship, requireFriend, member, rate, notify, emit, refreshPeople, problem, authorizedSql, authBindings } from './social-core.js';

const columns = 'u.id,u.username,u.display_name,u.avatar_key,u.created_at';
const maxBody = 32000;
async function body(request) {
  if (Number(request.headers.get('Content-Length')) > maxBody) throw problem('Mensagem muito extensa.', 413);
  const text = await request.text();
  if (text.length > maxBody) throw problem('Mensagem muito extensa.', 413);
  try { const value = JSON.parse(text); if (!value || Array.isArray(value) || typeof value !== 'object') throw 0; return value; }
  catch { throw problem('Dados inválidos.'); }
}
const result = (request, value, json, status = 200) => json(request, value, status);
function safeText(value, limit) { return String(value || '').trim().slice(0, limit); }
const sevenTvId = value => /^(?:[a-f0-9]{24}|[0-9a-hjkmnp-tv-z]{26})$/i.test(String(value || ''));
async function providerJson(url) {
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error', headers: { Accept: 'application/json' } }); }
  catch { throw problem('Serviço de mídia indisponível.', 503); }
  if (!response.ok || !response.body) throw problem('Serviço de mídia indisponível.', 503);
  const reader = response.body.getReader(); let length = 0; const chunks = [];
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 1024 * 1024) throw new Error('large'); chunks.push(value); }
    const data = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(data));
  } catch { await reader.cancel().catch(() => {}); throw problem('Resposta de mídia inválida.', 502); }
}
async function stopSessions(env, a, b) {
  const rows = await env.DB.prepare("SELECT id FROM listening_sessions WHERE ((host_id=? AND guest_id=?) OR (host_id=? AND guest_id=?)) AND status IN ('pending','active')").bind(a, b, b, a).all();
  for (const row of rows.results) await env.LISTENING.getByName(row.id).end(a);
}
async function groupMember(env, groupId, userId) {
  const row = await env.DB.prepare(`SELECT gm.group_id FROM social_group_members gm WHERE gm.group_id=? AND gm.user_id=?
    AND NOT EXISTS (SELECT 1 FROM social_group_members other JOIN user_blocks b ON (b.user_id=gm.user_id AND b.blocked_id=other.user_id) OR (b.user_id=other.user_id AND b.blocked_id=gm.user_id) WHERE other.group_id=gm.group_id)`).bind(groupId,userId).first();
  if (!row) throw problem('Grupo indisponível.',404);
}
const groupMessage = row => ({ id:row.id, seq:row.seq, groupId:row.group_id, senderId:row.sender_id, senderName:row.display_name, clientId:row.client_id, text:row.body, createdAt:row.created_at, editedAt:row.edited_at, deletedAt:row.deleted_at });
async function groupRecipients(env, groupId) {
  const rows = await env.DB.prepare('SELECT user_id FROM social_group_members WHERE group_id=?').bind(groupId).all();
  return rows.results.map(row => row.user_id);
}
async function openConversation(env, a, b) {
  await requireFriend(env, a, b);
  const id = pairId(a, b), now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO conversations(id,created_at,updated_at) VALUES(?,?,?)').bind(id, now, now),
    env.DB.prepare('INSERT OR IGNORE INTO conversation_members(conversation_id,user_id,peer_id) VALUES(?,?,?)').bind(id, a, b),
    env.DB.prepare('INSERT OR IGNORE INTO conversation_members(conversation_id,user_id,peer_id) VALUES(?,?,?)').bind(id, b, a),
    env.DB.prepare('UPDATE conversation_members SET archived=0 WHERE conversation_id=? AND user_id=?').bind(id, a),
  ]);
  return id;
}
async function conversations(env, userId) {
  const rows = await env.DB.prepare(`SELECT c.*,cm.peer_id,cm.last_read_seq,cm.last_delivered_seq,cm.unread_count,cm.manual_unread,cm.muted,cm.archived,
    peer.last_read_seq AS peer_read_seq,peer.last_delivered_seq AS peer_delivered_seq,
    m.body AS preview,m.kind AS last_kind,m.sender_id AS last_sender,m.deleted_at AS last_deleted
    FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id
    JOIN conversation_members peer ON peer.conversation_id=c.id AND peer.user_id=cm.peer_id
    LEFT JOIN messages m ON m.seq=c.last_seq
    WHERE cm.user_id=? AND EXISTS(SELECT 1 FROM friendships f WHERE f.user_id=cm.user_id AND f.friend_id=cm.peer_id)
      AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=cm.user_id AND b.blocked_id=cm.peer_id) OR (b.user_id=cm.peer_id AND b.blocked_id=cm.user_id))
    ORDER BY c.updated_at DESC LIMIT 200`).bind(userId).all();
  return rows.results.map(row => ({ id: row.id, peerId: row.peer_id, updatedAt: row.updated_at, lastSeq: row.last_seq, lastReadSeq: row.last_read_seq,
    peerReadSeq: row.peer_read_seq, peerDeliveredSeq: row.peer_delivered_seq, unread: Math.max(row.unread_count, row.manual_unread), muted: Boolean(row.muted), archived: Boolean(row.archived),
    preview: row.last_deleted ? 'Mensagem excluída' : row.preview || (row.last_kind && row.last_kind !== 'text' ? 'Compartilhou um arquivo ou música' : 'Comece uma conversa') }));
}
async function bootstrap(request, env, user) {
  const origin = new URL(request.url).origin;
  const [friends, incoming, outgoing, blocked, notifications, unread, prefs, threads] = await Promise.all([
    env.DB.prepare(`SELECT ${columns} FROM friendships f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? ORDER BY u.display_name COLLATE NOCASE`).bind(user.id).all(),
    env.DB.prepare(`SELECT ${columns},f.created_at AS requested_at FROM friend_requests f JOIN users u ON u.id=f.sender_id WHERE f.receiver_id=? ORDER BY f.created_at DESC LIMIT 100`).bind(user.id).all(),
    env.DB.prepare(`SELECT ${columns},f.created_at AS requested_at FROM friend_requests f JOIN users u ON u.id=f.receiver_id WHERE f.sender_id=? ORDER BY f.created_at DESC LIMIT 100`).bind(user.id).all(),
    env.DB.prepare(`SELECT ${columns} FROM user_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=? LIMIT 500`).bind(user.id).all(),
    env.DB.prepare('SELECT * FROM social_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(user.id).all(),
    env.DB.prepare('SELECT COUNT(*) AS total FROM social_notifications WHERE user_id=? AND read_at IS NULL').bind(user.id).first(),
    settings(env, user.id), conversations(env, user.id),
  ]);
  await env.SOCIAL.getByName(user.id).ensure(user.id);
  return { friends: friends.results.map(row => person(row, origin)), incoming: incoming.results.map(row => person(row, origin)), outgoing: outgoing.results.map(row => person(row, origin)),
    blocked: blocked.results.map(row => person(row, origin)), conversations: threads, settings: prefs,
    notifications: notifications.results.map(row => ({ id: row.id, actorId: row.actor_id, kind: row.kind, payload: parse(row.payload_json), createdAt: row.created_at, readAt: row.read_at })),
    notificationCount: unread.total, presence: await env.SOCIAL.getByName(user.id).snapshot() };
}

async function attachmentType(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = new TextDecoder().decode(bytes);
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) return 'image/png';
  if (/^GIF8[79]a/.test(ascii)) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.startsWith('%PDF-')) return 'application/pdf';
  if (/\.txt$/i.test(file.name) && file.type === 'text/plain') return 'text/plain';
  throw problem('Envie JPG, PNG, GIF, WebP, PDF ou TXT.');
}

export async function socialSocket(request, env) {
  const url = new URL(request.url);
  if (!uuid(url.searchParams.get('user')) || !uuid(url.searchParams.get('ticket'))) return new Response('Não autorizado', { status: 401 });
  return env.SOCIAL.getByName(url.searchParams.get('user')).fetch(request);
}

export async function socialRoutes(request, env, user, helpers) {
  const { json, responseHeaders } = helpers;
  const url = new URL(request.url), path = url.pathname.replace(/^\/api\/social/, ''), method = request.method;
  if (!url.pathname.startsWith('/api/social/')) return null;
  if (!user) return json(request, { error: 'Entre na sua conta para acessar os amigos.' }, 401);
  try {
    const origin = url.origin;
    if (path === '/state' && method === 'GET') return json(request, await bootstrap(request, env, user));
    if (path === '/groups' && method === 'GET') {
      const rows = await env.DB.prepare(`SELECT g.*,gm.last_read_seq,(SELECT COUNT(*) FROM social_group_messages m WHERE m.group_id=g.id AND m.sender_id<>gm.user_id AND m.seq>gm.last_read_seq AND m.deleted_at IS NULL) AS unread
        FROM social_groups g JOIN social_group_members gm ON gm.group_id=g.id WHERE gm.user_id=? AND NOT EXISTS (SELECT 1 FROM social_group_members other JOIN user_blocks b ON (b.user_id=gm.user_id AND b.blocked_id=other.user_id) OR (b.user_id=other.user_id AND b.blocked_id=gm.user_id) WHERE other.group_id=g.id) ORDER BY g.updated_at DESC LIMIT 100`).bind(user.id).all();
      return json(request,{groups:rows.results.map(row=>({id:row.id,name:row.name,ownerId:row.owner_id,unread:row.unread,updatedAt:row.updated_at}))});
    }
    if (path === '/groups' && method === 'POST') {
      await rate(env,user.id,'create_group',10,300);
      const data = await body(request), name = safeText(data.name,80), invited = [...new Set(Array.isArray(data.members) ? data.members : [])];
      if (!name || invited.length < 2 || invited.length > 20 || invited.some(id => !uuid(id) || id === user.id)) throw problem('Escolha um nome e entre 2 e 20 amigos.');
      for (const id of invited) { await requireFriend(env,user.id,id); if ((await settings(env,id)).messages !== 'friends') throw problem('Um participante desativou mensagens.',403); }
      const participants=[user.id,...invited], id=crypto.randomUUID(), now=Date.now();
      for (let i=0;i<participants.length;i++) for (let j=i+1;j<participants.length;j++) if ((await relationship(env,participants[i],participants[j])).blocked) throw problem('Não foi possível criar este grupo.',403);
      await env.DB.batch([env.DB.prepare('INSERT INTO social_groups(id,name,owner_id,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,name,user.id,now,now), ...participants.map(memberId=>env.DB.prepare('INSERT INTO social_group_members(group_id,user_id) VALUES(?,?)').bind(id,memberId))]);
      await emit(env,participants,{type:'group_update',groupId:id});
      return json(request,{id},201);
    }
    const groupMessages = path.match(/^\/groups\/([^/]+)\/messages$/);
    if (groupMessages && method === 'GET') {
      const id=groupMessages[1]; await groupMember(env,id,user.id);
      const before=Math.max(1,Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER);
      const rows=await env.DB.prepare('SELECT m.*,u.display_name FROM social_group_messages m JOIN users u ON u.id=m.sender_id WHERE m.group_id=? AND m.seq<? ORDER BY m.seq DESC LIMIT 41').bind(id,before).all();
      const page=rows.results.slice(0,40).reverse(); return json(request,{messages:page.map(groupMessage),hasMore:rows.results.length>40,nextBefore:page[0]?.seq||null});
    }
    if (groupMessages && method === 'POST') {
      const id=groupMessages[1]; await groupMember(env,id,user.id); await rate(env,user.id,'send_group_message',45);
      const data=await body(request), text=safeText(data.text,4000); if (!text || !uuid(data.clientId)) throw problem('Mensagem inválida.');
      const now=Date.now(), msgId=crypto.randomUUID();
      await env.DB.batch([env.DB.prepare(`INSERT OR IGNORE INTO social_group_messages(id,group_id,sender_id,client_id,body,created_at)
        SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM social_group_members gm WHERE gm.group_id=? AND gm.user_id=?
          AND NOT EXISTS(SELECT 1 FROM social_group_members other JOIN user_blocks b ON (b.user_id=gm.user_id AND b.blocked_id=other.user_id) OR (b.user_id=other.user_id AND b.blocked_id=gm.user_id) WHERE other.group_id=gm.group_id))
          AND NOT EXISTS(SELECT 1 FROM social_group_members other JOIN user_social_settings s ON s.user_id=other.user_id WHERE other.group_id=? AND other.user_id<>? AND s.messages='none')`).bind(msgId,id,user.id,data.clientId,text,now,id,user.id,id,user.id),env.DB.prepare('UPDATE social_groups SET updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM social_group_messages WHERE group_id=? AND sender_id=? AND client_id=?)').bind(now,id,id,user.id,data.clientId)]);
      const row=await env.DB.prepare('SELECT m.*,u.display_name FROM social_group_messages m JOIN users u ON u.id=m.sender_id WHERE m.group_id=? AND m.sender_id=? AND m.client_id=?').bind(id,user.id,data.clientId).first();
      if (!row) throw problem('As permissões do grupo mudaram.',403);
      await emit(env,await groupRecipients(env,id),{type:'group_update',groupId:id}); return json(request,{message:groupMessage(row)},201);
    }
    const groupReceipt = path.match(/^\/groups\/([^/]+)\/receipt$/);
    if (groupReceipt && method === 'POST') {
      const id=groupReceipt[1]; await groupMember(env,id,user.id); const data=await body(request);
      const last=await env.DB.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM social_group_messages WHERE group_id=?').bind(id).first();
      const seq=Math.min(last.seq,Math.max(0,Math.floor(Number(data.seq)||0)));
      await env.DB.prepare('UPDATE social_group_members SET last_read_seq=MAX(last_read_seq,?) WHERE group_id=? AND user_id=?').bind(seq,id,user.id).run(); return json(request,{ok:true});
    }
    const groupMessageMatch = path.match(/^\/group-messages\/([^/]+)$/);
    if (groupMessageMatch && ['PUT','DELETE'].includes(method)) {
      await rate(env,user.id,'edit_group_message',40);
      const row=await env.DB.prepare('SELECT * FROM social_group_messages WHERE id=? AND sender_id=? AND deleted_at IS NULL').bind(groupMessageMatch[1],user.id).first();
      if (!row) throw problem('Mensagem indisponível.',404);
      await groupMember(env,row.group_id,user.id);
      if (method==='PUT') { const data=await body(request), text=safeText(data.text,4000); if (!text) throw problem('Digite uma mensagem.'); await env.DB.prepare('UPDATE social_group_messages SET body=?,edited_at=? WHERE id=? AND sender_id=?').bind(text,Date.now(),row.id,user.id).run(); }
      else await env.DB.prepare("UPDATE social_group_messages SET body='',deleted_at=? WHERE id=? AND sender_id=?").bind(Date.now(),row.id,user.id).run();
      await emit(env,await groupRecipients(env,row.group_id),{type:'group_update',groupId:row.group_id}); return json(request,{ok:true});
    }
    if (path === '/media/search' && method === 'GET') {
      await rate(env, user.id, 'media_search', 30);
      const provider = url.searchParams.get('provider'), query = safeText(url.searchParams.get('q'), 80).toLowerCase();
      if (provider === '7tv') {
        const data = await providerJson('https://7tv.io/v3/emote-sets/global');
        const items = (data.emotes || []).filter(item => sevenTvId(item.id) && (!query || String(item.name).toLowerCase().includes(query))).slice(0, 80)
          .map(item => ({ provider: '7tv', id: item.id, name: safeText(item.name, 80), url: `https://cdn.7tv.app/emote/${item.id}/2x.webp` }));
        return json(request, { items });
      }
      if (!['gif','sticker'].includes(provider)) throw problem('Provedor inválido.');
      if (!env.KLIPY_API_KEY) throw problem('KLIPY não configurado no servidor.', 503);
      const type = provider === 'gif' ? 'gifs' : 'stickers';
      const endpoint = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(env.KLIPY_API_KEY)}/${type}/${query ? 'search' : 'trending'}`);
      endpoint.searchParams.set('per_page', '24'); endpoint.searchParams.set('locale', 'br'); endpoint.searchParams.set('customer_id', user.id);
      if (query) endpoint.searchParams.set('q', query);
      const data = await providerJson(endpoint.href);
      const items = (data?.data?.data || []).map(item => {
        const source = item.file?.sm?.gif?.url || item.file?.md?.gif?.url || item.file?.hd?.gif?.url;
        try { const parsed = new URL(source); if (parsed.protocol !== 'https:' || parsed.hostname !== 'static.klipy.com') return null;
          return { provider: 'klipy', type: provider, id: safeText(item.slug, 150), name: safeText(item.title, 150), url: parsed.href }; } catch { return null; }
      }).filter(item => item?.id);
      return json(request, { items });
    }
    if (path === '/ticket' && method === 'POST') {
      const ticket = await env.SOCIAL.getByName(user.id).ticket(user.id, user.session_hash, user.session_expires_at);
      return json(request, { url: `${origin.replace(/^http/, 'ws')}/api/social/connect?user=${user.id}&ticket=${ticket}` });
    }
    if (path === '/users' && method === 'GET') {
      await rate(env, user.id, 'search', 30);
      const q = safeText(url.searchParams.get('q'), 60).replace(/^@/, '').replace(/[\\%_]/g, '\\$&');
      if (q.length < 2) return json(request, { users: [] });
      const rows = await env.DB.prepare(`SELECT ${columns} FROM users u WHERE (u.username LIKE ? ESCAPE '\\' OR u.display_name COLLATE NOCASE LIKE ? ESCAPE '\\') AND u.id<>?
        AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=? AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?)) ORDER BY u.username LIMIT 25`)
        .bind(`${q}%`, `${q}%`, user.id, user.id, user.id).all();
      return json(request, { users: rows.results.map(row => person(row, origin)) });
    }
    const profileMatch = path.match(/^\/profiles\/([^/]+)$/);
    if (profileMatch && method === 'GET') {
      const target = profileMatch[1], relation = await relationship(env, user.id, target);
      if (relation.blocked) throw problem('Perfil indisponível.', 403);
      const row = await env.DB.prepare(`SELECT ${columns} FROM users u WHERE u.id=?`).bind(target).first();
      if (!row) throw problem('Perfil não encontrado.', 404);
      const publicPlaylists = relation.friends || target === user.id ? (await env.DB.prepare('SELECT id,name FROM playlists WHERE added_by=? ORDER BY created_at DESC LIMIT 100').bind(target).all()).results : [];
      const realtime = env.SOCIAL.getByName(target); await realtime.ensure(target);
      return json(request, { ...person(row, origin), isFriend: Boolean(relation.friends), playlists: publicPlaylists,
        presence: await realtime.publicState(user.id), recent: await realtime.recent(user.id) });
    }
    const friendMatch = path.match(/^\/friends\/([^/]+)$/);
    if (friendMatch && method === 'POST') {
      const target = friendMatch[1];
      if (!uuid(target) || target === user.id) throw problem('Escolha outro usuário.');
      await rate(env, user.id, 'friend_requests', 30, 86400);
      const relation = await relationship(env, user.id, target);
      if (relation.blocked || (await settings(env, target)).requests === 'none') throw problem('Este usuário não está recebendo solicitações.', 403);
      if (relation.friends) return json(request, { ok: true });
      // A reciprocal request is accepted explicitly by the recipient, never silently.
      const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO friend_requests(sender_id,receiver_id,created_at) SELECT ?,id,? FROM users WHERE id=?
        AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?))
        AND COALESCE((SELECT requests FROM user_social_settings WHERE user_id=?),'everyone')='everyone'`)
        .bind(user.id, Date.now(), target, user.id, target, target, user.id, target).run();
      if (inserted.meta.changes) await notify(env, target, user.id, 'friend_request', { userId: user.id, displayName: user.display_name });
      await emit(env, [user.id, target], { type: 'social_changed' }); return json(request, { ok: true });
    }
    const requestMatch = path.match(/^\/requests\/([^/]+)$/);
    if (requestMatch && method === 'POST') {
      const other = requestMatch[1], data = await body(request);
      if (!['accept','decline','cancel'].includes(data.action)) throw problem('Ação inválida.');
      if (data.action === 'accept') {
        const existing = await relationship(env, user.id, other);
        if (existing.blocked) throw problem('Usuário bloqueado.', 403);
        if (existing.friends) return json(request, { ok: true });
        const now = Date.now();
        await env.DB.batch([
          env.DB.prepare(`INSERT OR IGNORE INTO friendships(user_id,friend_id,created_at) SELECT receiver_id,sender_id,? FROM friend_requests WHERE sender_id=? AND receiver_id=? AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?))`).bind(now, other, user.id, other, user.id, user.id, other),
          env.DB.prepare('INSERT OR IGNORE INTO friendships(user_id,friend_id,created_at) SELECT friend_id,user_id,created_at FROM friendships WHERE user_id=? AND friend_id=?').bind(user.id, other),
          env.DB.prepare('DELETE FROM friend_requests WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)').bind(other, user.id, user.id, other),
        ]);
        if (!(await relationship(env, user.id, other)).friends) throw problem('Esta solicitação não está mais disponível.', 409);
        await refreshPeople(env, [user.id, other]);
        await notify(env, other, user.id, 'friend_accepted', { userId: user.id, displayName: user.display_name });
      } else {
        await env.DB.prepare('DELETE FROM friend_requests WHERE sender_id=? AND receiver_id=?').bind(data.action === 'cancel' ? user.id : other, data.action === 'cancel' ? other : user.id).run();
        await emit(env, [user.id, other], { type: 'social_changed' });
      }
      return json(request, { ok: true });
    }
    if (friendMatch && method === 'DELETE') {
      const other = friendMatch[1];
      await env.DB.prepare('DELETE FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)').bind(user.id, other, other, user.id).run();
      await stopSessions(env, user.id, other); await refreshPeople(env, [user.id, other]); return json(request, { ok: true });
    }
    const blockMatch = path.match(/^\/blocks\/([^/]+)$/);
    if (blockMatch && ['POST','DELETE'].includes(method)) {
      const other = blockMatch[1]; if (!uuid(other) || other === user.id) throw problem('Usuário inválido.');
      if (method === 'POST') {
        await env.DB.batch([
          env.DB.prepare('INSERT OR IGNORE INTO user_blocks(user_id,blocked_id,created_at) SELECT ?,id,? FROM users WHERE id=?').bind(user.id, Date.now(), other),
          env.DB.prepare('DELETE FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)').bind(user.id, other, other, user.id),
          env.DB.prepare('DELETE FROM friend_requests WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)').bind(user.id, other, other, user.id),
          env.DB.prepare('DELETE FROM social_notifications WHERE (user_id=? AND actor_id=?) OR (user_id=? AND actor_id=?)').bind(user.id, other, other, user.id),
        ]);
        await stopSessions(env, user.id, other);
      } else await env.DB.prepare('DELETE FROM user_blocks WHERE user_id=? AND blocked_id=?').bind(user.id, other).run();
      await refreshPeople(env, [user.id, other]); return json(request, { ok: true });
    }
    if (path === '/settings' && method === 'PUT') {
      const data = await body(request), value = { ...defaults };
      for (const key of ['requests','messages','listening_invites','call_invites','presence']) {
        const allowed = key === 'requests' ? ['everyone','none'] : key === 'presence' ? ['online','away','busy','invisible'] : ['friends','none'];
        if (data[key] !== undefined) { if (!allowed.includes(data[key])) throw problem('Preferência inválida.'); value[key] = data[key]; }
      }
      for (const key of ['show_presence','show_activity','share_history','browser_notifications']) if (data[key] !== undefined) value[key] = data[key] ? 1 : 0;
      if (data.status_text !== undefined) value.status_text = safeText(data.status_text, 140);
      const keys = Object.keys(defaults).filter(key => data[key] !== undefined);
      if (keys.length) await env.DB.prepare(`INSERT INTO user_social_settings(user_id,${keys.join(',')}) VALUES(?,${keys.map(() => '?').join(',')}) ON CONFLICT(user_id) DO UPDATE SET ${keys.map(key => `${key}=excluded.${key}`).join(',')}`)
        .bind(user.id, ...keys.map(key => value[key])).run();
      await refreshPeople(env, [user.id]);
      if (data.listening_invites === 'none') {
        const active = (await env.DB.prepare("SELECT id FROM listening_sessions WHERE (host_id=? OR guest_id=?) AND status IN ('active','pending')").bind(user.id, user.id).all()).results;
        for (const session of active) await env.LISTENING.getByName(session.id).end(user.id);
      }
      return json(request, { settings: await settings(env, user.id) });
    }
    if (path === '/conversations' && method === 'POST') {
      const data = await body(request); return json(request, { id: await openConversation(env, user.id, data.userId) });
    }
    const conversationMatch = path.match(/^\/conversations\/([^/]+)$/);
    if (conversationMatch && method === 'PUT') {
      const id = decodeURIComponent(conversationMatch[1]); await member(env, id, user.id);
      const data = await body(request);
      const changes = ['muted','archived','manual_unread'].filter(key => data[key] !== undefined);
      if (changes.length) await env.DB.prepare(`UPDATE conversation_members SET ${changes.map(key => `${key}=?`).join(',')} WHERE conversation_id=? AND user_id=?`).bind(...changes.map(key => data[key] ? 1 : 0), id, user.id).run();
      await emit(env, [user.id], { type: 'social_changed' }); return json(request, { ok: true });
    }
    const messagesMatch = path.match(/^\/conversations\/([^/]+)\/messages$/);
    if (messagesMatch && method === 'GET') {
      const id = decodeURIComponent(messagesMatch[1]); await member(env, id, user.id);
      const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
      const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
      const q = safeText(url.searchParams.get('q'), 120);
      const sender = url.searchParams.get('sender'), kindFilter = url.searchParams.get('kind');
      const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
      let rows;
      if (q.length >= 2 || sender || kindFilter || since) {
        await rate(env, user.id, 'message_search', 30);
        const terms = q.length >= 2 ? q.split(/\s+/).map(token => '"' + token.replaceAll('"','""') + '"').join(' AND ') : '';
        const scope = id.replaceAll(':','').replaceAll('-',''), clauses = ['m.conversation_id=?','m.deleted_at IS NULL','m.seq<?'], values = [id,before];
        if (terms) { clauses.push('social_message_search MATCH ?'); values.push(`search_scope : "${scope}" AND body : (${terms})`); }
        if (sender === 'me') { clauses.push('m.sender_id=?'); values.push(user.id); }
        else if (sender === 'other') { clauses.push('m.sender_id<>?'); values.push(user.id); }
        if (['text','track','album','playlist','attachment','external_media'].includes(kindFilter)) { clauses.push('m.kind=?'); values.push(kindFilter); }
        if (since) { clauses.push('m.created_at>=?'); values.push(since); }
        rows = await env.DB.prepare(`SELECT m.* FROM messages m ${terms ? 'JOIN social_message_search ON m.seq=social_message_search.rowid' : ''} WHERE ${clauses.join(' AND ')} ORDER BY m.seq DESC LIMIT 41`).bind(...values).all();
      } else rows = await env.DB.prepare(`SELECT * FROM messages WHERE conversation_id=? AND seq<? AND seq>? ORDER BY seq ${after ? 'ASC' : 'DESC'} LIMIT 41`).bind(id, before, after).all();
      const more = rows.results.length > 40, page = rows.results.slice(0, 40);
      if (!after) page.reverse();
      return json(request, { messages: page.map(message), hasMore: more, nextBefore: page[0]?.seq || null, nextAfter: page.at(-1)?.seq || null });
    }
    if (messagesMatch && method === 'POST') {
      const id = decodeURIComponent(messagesMatch[1]), membership = await member(env, id, user.id), peer = membership.peer_id;
      await rate(env, user.id, 'send_message', 45);
      if ((await settings(env, peer)).messages !== 'friends') throw problem('Este amigo desativou mensagens.', 403);
      const data = await body(request), text = safeText(data.text, 4000), kind = data.kind || 'text';
      if (!uuid(data.clientId) || !['text','track','album','playlist','attachment','external_media'].includes(kind)) throw problem('Mensagem inválida.');
      let payload = {};
      if (kind === 'text' && !text) throw problem('Digite uma mensagem.');
      if (kind === 'external_media') {
        const item = data.payload || {};
        if (item.provider === '7tv' && sevenTvId(item.id)) payload = { provider: '7tv', id: item.id, name: safeText(item.name, 80), url: `https://cdn.7tv.app/emote/${item.id}/2x.webp` };
        else if (item.provider === 'klipy' && ['gif','sticker'].includes(item.type) && /^[a-z0-9_-]{1,150}$/i.test(item.id || '')) {
          let parsed; try { parsed = new URL(item.url); } catch { throw problem('Mídia inválida.'); }
          if (parsed.protocol !== 'https:' || parsed.hostname !== 'static.klipy.com' || parsed.username || parsed.password || parsed.port) throw problem('Mídia inválida.');
          payload = { provider: 'klipy', type: item.type, id: item.id, name: safeText(item.name, 150), url: parsed.href };
        } else throw problem('Mídia inválida.');
      }
      if (['track','album','playlist'].includes(kind)) {
        const table = { track: 'tracks', album: 'albums', playlist: 'playlists' }[kind];
        const item = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?${kind === 'track' ? ' AND import_batch_id IS NULL' : ''}`).bind(String(data.itemId || '')).first();
        if (!item) throw problem('Este item não está mais na biblioteca.', 404);
        payload = { id: item.id, title: item.title || item.name, artist: item.artist || '', kind };
      }
      if (kind === 'attachment') {
        const item = await env.DB.prepare('SELECT * FROM social_attachments WHERE id=? AND conversation_id=? AND owner_id=?').bind(String(data.attachmentId || ''), id, user.id).first();
        if (!item || (!item.message_id && item.created_at < Date.now() - 86400000)) throw problem('Anexo inválido ou expirado.', 400);
        if (item.message_id) {
          const existing = await env.DB.prepare('SELECT client_id FROM messages WHERE id=? AND sender_id=?').bind(item.message_id, user.id).first();
          if (existing?.client_id !== data.clientId) throw problem('Este anexo já foi enviado.', 409);
        }
        payload = { id: item.id, name: item.name, mime: item.mime, size: item.size };
      }
      const replyTo = data.replyTo || null;
      if (replyTo) {
        const target = await env.DB.prepare('SELECT id FROM messages WHERE id=? AND conversation_id=? AND deleted_at IS NULL').bind(replyTo, id).first();
        if (!target) throw problem('Mensagem respondida indisponível.', 404);
      }
      const messageId = crypto.randomUUID(), now = Date.now();
      const selector = 'SELECT seq FROM messages WHERE conversation_id=? AND sender_id=? AND client_id=?';
      const selectorArgs = [id, user.id, data.clientId];
      const statements = [
        env.DB.prepare(`INSERT OR IGNORE INTO messages(id,conversation_id,sender_id,client_id,body,kind,payload_json,created_at,reply_to)
          SELECT ?,?,?,?,?,?,?,?,? WHERE ${authorizedSql} AND COALESCE((SELECT messages FROM user_social_settings WHERE user_id=?),'friends')='friends'
          AND (?<>'attachment' OR EXISTS(SELECT 1 FROM social_attachments WHERE id=? AND message_id IS NULL AND created_at>?))`)
          .bind(messageId, id, user.id, data.clientId, text, kind, encode(payload), now, replyTo, ...authBindings(user.id, peer), peer, kind, payload.id || '', now - 86400000),
        env.DB.prepare(`UPDATE conversations SET last_seq=(${selector}),updated_at=? WHERE id=? AND last_seq<COALESCE((${selector}),0)`).bind(...selectorArgs, now, id, ...selectorArgs),
        env.DB.prepare(`UPDATE conversation_members SET unread_count=unread_count+1,last_received_seq=(${selector}),archived=0 WHERE conversation_id=? AND user_id=? AND last_received_seq<COALESCE((${selector}),0)`)
          .bind(...selectorArgs, id, peer, ...selectorArgs),
        env.DB.prepare(`INSERT OR IGNORE INTO social_notifications(id,user_id,actor_id,kind,payload_json,created_at) SELECT 'message:'||id,?,?,'message',?,created_at FROM messages WHERE conversation_id=? AND sender_id=? AND client_id=?`)
          .bind(peer, user.id, encode({ conversationId: id, displayName: user.display_name }), ...selectorArgs),
      ];
      if (kind === 'attachment') statements.push(env.DB.prepare(`UPDATE social_attachments SET message_id=(SELECT id FROM messages WHERE conversation_id=? AND sender_id=? AND client_id=?) WHERE id=? AND message_id IS NULL`).bind(...selectorArgs, payload.id));
      await env.DB.batch(statements);
      const row = await env.DB.prepare('SELECT * FROM messages WHERE conversation_id=? AND sender_id=? AND client_id=?').bind(...selectorArgs).first();
      if (!row) throw problem('A amizade ou permissão de mensagens mudou.', 403);
      await emit(env, [user.id, peer], { type: 'message', actorId: user.id, message: message(row) });
      return json(request, { message: message(row) }, 201);
    }
    const featuresMatch = path.match(/^\/conversations\/([^/]+)\/features$/);
    if (featuresMatch && method === 'GET') {
      const id = decodeURIComponent(featuresMatch[1]); await member(env, id, user.id);
      const [reactions, marks] = await Promise.all([
        env.DB.prepare('SELECT r.message_id,r.user_id,r.emoji FROM social_message_reactions r JOIN messages m ON m.id=r.message_id WHERE m.conversation_id=? AND m.deleted_at IS NULL ORDER BY m.seq DESC LIMIT 1000').bind(id).all(),
        env.DB.prepare(`SELECT x.message_id,x.user_id,x.kind FROM social_message_marks x JOIN messages m ON m.id=x.message_id WHERE m.conversation_id=? AND m.deleted_at IS NULL AND (x.kind='pin' OR x.user_id=?) ORDER BY m.seq DESC LIMIT 1000`).bind(id,user.id).all(),
      ]);
      return json(request, { reactions: reactions.results, marks: marks.results });
    }
    const featureMatch = path.match(/^\/messages\/([^/]+)\/(reaction|pin|favorite)$/);
    if (featureMatch && (method === 'PUT' || method === 'DELETE')) {
      await rate(env,user.id,'message_feature',60);
      const row = await env.DB.prepare('SELECT * FROM messages WHERE id=? AND deleted_at IS NULL').bind(featureMatch[1]).first();
      if (!row) throw problem('Mensagem indisponível.',404);
      const membership = await member(env,row.conversation_id,user.id), feature = featureMatch[2];
      if (feature === 'reaction') {
        const data = await body(request), emoji = String(data.emoji || '');
        if (!emoji || [...emoji].length > 12 || !/^[\p{Extended_Pictographic}\p{Emoji_Component}\p{Regional_Indicator}\u200d\ufe0f]+$/u.test(emoji)) throw problem('Reação inválida.');
        if (method === 'PUT') await env.DB.prepare('INSERT OR IGNORE INTO social_message_reactions(message_id,user_id,emoji) VALUES(?,?,?)').bind(row.id,user.id,emoji).run();
        else await env.DB.prepare('DELETE FROM social_message_reactions WHERE message_id=? AND user_id=? AND emoji=?').bind(row.id,user.id,emoji).run();
      } else if (method === 'PUT') await env.DB.prepare('INSERT OR IGNORE INTO social_message_marks(message_id,user_id,kind) VALUES(?,?,?)').bind(row.id,user.id,feature).run();
      else await env.DB.prepare('DELETE FROM social_message_marks WHERE message_id=? AND user_id=? AND kind=?').bind(row.id,user.id,feature).run();
      await emit(env, feature === 'favorite' ? [user.id] : [user.id,membership.peer_id], {type:'message_features',conversationId:row.conversation_id});
      return json(request,{ok:true});
    }
    const receiptMatch = path.match(/^\/conversations\/([^/]+)\/receipt$/);
    if (receiptMatch && method === 'POST') {
      const id = decodeURIComponent(receiptMatch[1]), membership = await member(env, id, user.id), data = await body(request);
      const last = await env.DB.prepare('SELECT last_seq FROM conversations WHERE id=?').bind(id).first();
      const seq = Math.min(last.last_seq, Math.max(0, Math.floor(Number(data.seq) || 0)));
      await env.DB.prepare(`UPDATE conversation_members SET last_delivered_seq=MAX(last_delivered_seq,?),last_read_seq=MAX(last_read_seq,?),manual_unread=CASE WHEN ? THEN 0 ELSE manual_unread END,
        unread_count=(SELECT COUNT(*) FROM messages WHERE conversation_id=? AND sender_id<>? AND seq>MAX(conversation_members.last_read_seq,?)) WHERE conversation_id=? AND user_id=?`)
        .bind(seq, data.read ? seq : 0, data.read ? 1 : 0, id, user.id, data.read ? seq : 0, id, user.id).run();
      const updated = await env.DB.prepare('SELECT last_read_seq,last_delivered_seq FROM conversation_members WHERE conversation_id=? AND user_id=?').bind(id, user.id).first();
      if (data.read) await env.DB.prepare("UPDATE social_notifications SET read_at=? WHERE user_id=? AND kind='message' AND json_extract(payload_json,'$.conversationId')=? AND read_at IS NULL").bind(Date.now(), user.id, id).run();
      await emit(env, [user.id, membership.peer_id], { type: 'receipt', actorId: user.id, conversationId: id, readSeq: updated.last_read_seq, deliveredSeq: updated.last_delivered_seq });
      return json(request, { ok: true });
    }
    const locateMatch = path.match(/^\/messages\/([^/]+)\/location$/);
    if (locateMatch && method === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(locateMatch[1]).first();
      if (!row) throw problem('Mensagem indisponível.', 404);
      await member(env, row.conversation_id, user.id);
      const rows = await env.DB.prepare('SELECT * FROM messages WHERE conversation_id=? AND seq<=? ORDER BY seq DESC LIMIT 40').bind(row.conversation_id, row.seq).all();
      return json(request, { conversationId: row.conversation_id, message: message(row), messages: rows.results.reverse().map(message) });
    }
    const messageMatch = path.match(/^\/messages\/([^/]+)$/);
    if (messageMatch && ['PUT','DELETE'].includes(method)) {
      await rate(env, user.id, 'edit_message', 40);
      const row = await env.DB.prepare('SELECT * FROM messages WHERE id=? AND sender_id=?').bind(messageMatch[1], user.id).first();
      if (!row || row.deleted_at) throw problem('Mensagem indisponível.', 404);
      const membership = await member(env, row.conversation_id, user.id);
      if (method === 'PUT') {
        const data = await body(request), text = safeText(data.text, 4000); if (!text) throw problem('Digite uma mensagem.');
        await env.DB.prepare('UPDATE messages SET body=?,edited_at=? WHERE id=? AND sender_id=?').bind(text, Date.now(), row.id, user.id).run();
      } else {
        await env.DB.prepare("UPDATE messages SET body='',payload_json='{}',kind='text',deleted_at=? WHERE id=? AND sender_id=?").bind(Date.now(), row.id, user.id).run();
        const attachments = (await env.DB.prepare('SELECT media_key FROM social_attachments WHERE message_id=?').bind(row.id).all()).results;
        for (const item of attachments) await env.MEDIA.delete(item.media_key);
        await env.DB.prepare('DELETE FROM social_attachments WHERE message_id=?').bind(row.id).run();
      }
      const updated = await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(row.id).first();
      await emit(env, [user.id, membership.peer_id], { type: 'message', actorId: user.id, message: message(updated) });
      return json(request, { message: message(updated) });
    }
    if (path === '/attachments' && method === 'POST') {
      await rate(env, user.id, 'upload', 12);
      const id = String(url.searchParams.get('conversation') || ''); await member(env, id, user.id);
      if (!request.headers.get('Content-Type')?.startsWith('multipart/form-data;')) throw problem('Envie o anexo como formulário multipart.');
      if (Number(request.headers.get('Content-Length')) > 9 * 1024 * 1024) throw problem('Anexos podem ter até 8 MB.', 413);
      const form = await request.formData(), file = form.get('file');
      if (!(file instanceof File) || !file.size || file.size > 8 * 1024 * 1024) throw problem('Escolha um arquivo de até 8 MB.', 413);
      const mime = await attachmentType(file), attachmentId = crypto.randomUUID(), key = `social/${user.id}/${attachmentId}`;
      await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: mime } });
      try { await env.DB.prepare('INSERT INTO social_attachments(id,conversation_id,owner_id,media_key,name,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(attachmentId, id, user.id, key, safeText(file.name, 180), mime, file.size, Date.now()).run(); }
      catch (error) { await env.MEDIA.delete(key); throw error; }
      return json(request, { id: attachmentId, name: file.name, mime, size: file.size }, 201);
    }
    const attachmentMatch = path.match(/^\/attachments\/([^/]+)$/);
    if (attachmentMatch && method === 'GET') {
      const item = await env.DB.prepare('SELECT * FROM social_attachments WHERE id=?').bind(attachmentMatch[1]).first();
      if (!item) throw problem('Anexo indisponível.', 404);
      await member(env, item.conversation_id, user.id);
      if (!item.message_id && item.owner_id !== user.id) throw problem('Anexo indisponível.', 403);
      const object = await env.MEDIA.get(item.media_key); if (!object) throw problem('Anexo indisponível.', 404);
      return new Response(object.body, { headers: responseHeaders(request, { 'Content-Type': item.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`, 'Content-Security-Policy': "default-src 'none'; sandbox" }) });
    }
    if (path === '/notifications/read' && method === 'POST') {
      const data = await body(request);
      if (data.id) await env.DB.prepare('UPDATE social_notifications SET read_at=? WHERE id=? AND user_id=?').bind(Date.now(), String(data.id), user.id).run();
      else await env.DB.prepare('UPDATE social_notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(Date.now(), user.id).run();
      await emit(env, [user.id], { type: 'social_changed' }); return json(request, { ok: true });
    }
    if (path === '/listen' && method === 'POST') {
      await rate(env, user.id, 'listen_invite', 10, 300);
      const data = await body(request); await requireFriend(env, user.id, data.userId);
      if ((await settings(env, data.userId)).listening_invites !== 'friends') throw problem('Este amigo desativou convites.', 403);
      if (!await env.DB.prepare('SELECT id FROM tracks WHERE id=? AND import_batch_id IS NULL').bind(String(data.trackId || '')).first()) throw problem('Selecione uma música disponível.');
      await stopSessions(env, user.id, data.userId);
      const id = crypto.randomUUID(), now = Date.now();
      const session = { id, hostId: user.id, guestId: data.userId, trackId: data.trackId, expiresAt: now + 300000 };
      await env.DB.prepare('INSERT INTO listening_sessions(id,host_id,guest_id,created_at,expires_at) VALUES(?,?,?,?,?)').bind(id, user.id, data.userId, now, session.expiresAt).run();
      await env.LISTENING.getByName(id).create(session);
      await notify(env, data.userId, user.id, 'listening_invite', { ...session, displayName: user.display_name });
      return json(request, { session }, 201);
    }
    const queueMatch = path.match(/^\/listen\/([^/]+)\/(queue|next)$/);
    if (queueMatch && method === 'POST') {
      await rate(env,user.id,'listen_queue',40);
      const room=env.LISTENING.getByName(queueMatch[1]);
      if (queueMatch[2] === 'queue') { const data=await body(request); return json(request,{session:await room.enqueue(user.id,String(data.trackId||''))}); }
      return json(request,{session:await room.next(user.id)});
    }
    const listenMatch = path.match(/^\/listen\/([^/]+)$/);
    if (listenMatch && ['GET','POST','DELETE'].includes(method)) {
      const room = env.LISTENING.getByName(listenMatch[1]);
      if (method === 'POST') return json(request, { session: await room.join(user.id) });
      if (method === 'DELETE') { await room.end(user.id); return json(request, { ok: true }); }
      return json(request, { session: await room.snapshot(user.id) });
    }
    if (path === '/call' && method === 'POST') {
      await rate(env, user.id, 'call', 6, 300);
      const data = await body(request); await requireFriend(env, user.id, data.userId);
      if ((await settings(env, data.userId)).call_invites !== 'friends') throw problem('Este amigo não está recebendo chamadas.', 403);
      const callId = crypto.randomUUID();
      await emit(env, [data.userId], { type: 'call', actorId: user.id, callId, signal: { type: 'invite', video: Boolean(data.video) } });
      return json(request, { callId, iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, ...parseIce(env.SOCIAL_TURN_SERVERS)] });
    }
    if (path === '/call/config' && method === 'GET') return json(request, { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, ...parseIce(env.SOCIAL_TURN_SERVERS)] });
    if (path === '/reports' && method === 'POST') {
      await rate(env, user.id, 'report', 5, 3600);
      const data = await body(request), reason = safeText(data.reason, 2000);
      if (!uuid(data.userId) || data.userId === user.id || reason.length < 8) throw problem('Descreva o ocorrido com pelo menos 8 caracteres.');
      let evidence = {};
      if (data.messageId) {
        const row = await env.DB.prepare('SELECT m.* FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id WHERE m.id=? AND cm.user_id=? AND m.sender_id=?').bind(data.messageId, user.id, data.userId).first();
        if (!row) throw problem('Mensagem indisponível para denúncia.', 403); evidence = message(row);
      }
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO social_reports(id,reporter_id,target_id,message_id,reason,evidence_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(id, user.id, data.userId, data.messageId || null, reason, encode(evidence), Date.now()).run();
      return json(request, { id, ok: true }, 201);
    }
    return json(request, { error: 'Rota social não encontrada.' }, 404);
  } catch (error) {
    if (!error.status) console.error(JSON.stringify({ event: 'social_api_error', path, message: String(error) }));
    return json(request, { error: error.status ? error.message : 'Não foi possível concluir a ação social.' }, error.status || 500);
  }
}
const encode = value => JSON.stringify(value);
function parseIce(value) { try { const rows = JSON.parse(value || '[]'); return Array.isArray(rows) ? rows.slice(0, 4) : []; } catch { return []; } }

export async function cleanupSocial(env) {
  const rows = (await env.DB.prepare('SELECT id,media_key FROM social_attachments WHERE message_id IS NULL AND created_at<? ORDER BY created_at LIMIT 100').bind(Date.now() - 86400000).all()).results;
  for (const row of rows) { await env.MEDIA.delete(row.media_key); await env.DB.prepare('DELETE FROM social_attachments WHERE id=? AND message_id IS NULL').bind(row.id).run(); }
  await env.DB.prepare('DELETE FROM social_notifications WHERE created_at<? AND read_at IS NOT NULL').bind(Date.now() - 30 * 86400000).run();
}
