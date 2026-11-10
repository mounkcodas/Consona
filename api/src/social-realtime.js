import { DurableObject } from 'cloudflare:workers';
import { defaults, parse, pairId, settings, requireFriend, member, groupMember, problem, uuid } from './social-core.js';

const ACTIVE_FOR = 95000;
const encode = value => JSON.stringify(value);
export class SocialUser extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS limits(scope TEXT PRIMARY KEY,start INTEGER NOT NULL,total INTEGER NOT NULL)');
    this.config = this.get('config');
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  get(key) { return parse(this.sql.exec('SELECT value FROM state WHERE key=?', key).toArray()[0]?.value); }
  put(key, value) { this.sql.exec('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, encode(value)); }
  async ensure(id) { if (!this.config?.id) await this.refresh(id); }
  async profileUpdated(id) { await this.refresh(id); await Promise.all((this.config.friends || []).map(friend => this.env.SOCIAL.getByName(friend).deliver({ type:'social_changed' }))); }
  async refresh(id) {
    const next = (this.refreshing || Promise.resolve()).catch(() => {}).then(() => this.refreshNow(id));
    this.refreshing = next;
    return next;
  }
  async refreshNow(id) {
    const [profile, contacts, preferences, dmPeers] = await this.env.DB.batch([
      this.env.DB.prepare('SELECT id,username,display_name,avatar_key FROM users WHERE id=?').bind(id),
      this.env.DB.prepare(`SELECT f.friend_id FROM friendships f WHERE f.user_id=?
        AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=f.user_id AND b.blocked_id=f.friend_id) OR (b.user_id=f.friend_id AND b.blocked_id=f.user_id))`).bind(id),
      this.env.DB.prepare('SELECT * FROM user_social_settings WHERE user_id=?').bind(id),
      this.env.DB.prepare("SELECT CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END AS peer_id FROM social_dm_requests WHERE (sender_id=? OR receiver_id=?) AND status='accepted' AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=sender_id AND b.blocked_id=receiver_id) OR (b.user_id=receiver_id AND b.blocked_id=sender_id))").bind(id,id,id),
    ]);
    if (!profile.results[0]) { for (const ws of this.ctx.getWebSockets()) ws.close(4001, 'Conta indisponível'); return; }
    const before = this.config?.friends || [];
    this.config = { ...profile.results[0], friends: contacts.results.map(row => row.friend_id), dmPeers:dmPeers.results.map(row=>row.peer_id), settings: { ...defaults, ...preferences.results[0] } };
    this.put('config', this.config);
    const removed = before.filter(friend => !this.config.friends.includes(friend));
    for (const friend of removed) this.sql.exec('DELETE FROM state WHERE key=?', `peer:${friend}`);
    if (!this.config.settings.share_history || !this.config.settings.show_activity) this.put('history', []);
    this.broadcast({ type: 'social_changed', removed:removed.filter(friend=>!this.config.dmPeers.includes(friend)), settings: this.config.settings });
    // Reset recipients before returning from privacy/block changes.
    await Promise.all(removed.map(friend => this.env.SOCIAL.getByName(friend).forget(id)));
    await this.announce();
  }
  consume(scope, limit, seconds) {
    const start = Math.floor(Date.now() / (seconds * 1000));
    const row = this.sql.exec('SELECT start,total FROM limits WHERE scope=?', scope).toArray()[0];
    const total = row?.start === start ? row.total + 1 : 1;
    if (total > limit) return false;
    this.sql.exec('INSERT INTO limits(scope,start,total) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET start=excluded.start,total=excluded.total', scope, start, total);
    return true;
  }
  async schedule(delay) {
    const deadline = Date.now() + delay, previous = await this.ctx.storage.getAlarm();
    // A live tab must not postpone cleanup of another tab's stale connection.
    if (previous == null || previous > deadline) await this.ctx.storage.setAlarm(deadline);
  }
  async scheduleReminder(due) { await this.schedule(Math.max(0,due-Date.now())); }
  async ticket(id, sessionHash, expiresAt) {
    await this.ensure(id);
    if (this.get(`revoked:${sessionHash}`).at) throw problem('Sessão encerrada.', 401);
    if (!this.consume('ticket', 20, 60)) throw problem('Aguarde antes de reconectar.', 429);
    const ticket = crypto.randomUUID();
    this.put(`ticket:${ticket}`, { sessionHash, userId: id, expiresAt: Date.parse(expiresAt.replace(' ', 'T') + 'Z'), deadline: Date.now() + 60000 });
    await this.schedule(60000);
    return ticket;
  }
  async fetch(request) {
    const url = new URL(request.url), key = `ticket:${url.searchParams.get('ticket')}`;
    const ticket = this.get(key);
    this.sql.exec('DELETE FROM state WHERE key=?', key);
    if (!ticket.userId || ticket.deadline < Date.now() || ticket.expiresAt <= Date.now() || this.get(`revoked:${ticket.sessionHash}`).at) return new Response('Ticket expirado', { status: 401 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket obrigatório', { status: 426 });
    if (this.ctx.getWebSockets().filter(ws => ws.readyState === 1).length >= 12) return new Response('Muitas conexões', { status: 429 });
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    server.serializeAttachment({ ...ticket, lastActive: Date.now(), origin: url.origin, presence: 'online', activity: null });
    this.ctx.acceptWebSocket(server, [ticket.sessionHash]);
    server.send(encode({ type: 'ready', serverTime: Date.now(), presence: this.snapshot(), settings: this.config.settings }));
    await this.announce();
    return new Response(null, { status: 101, webSocket: client });
  }
  broadcast(event) {
    const data = encode({ ...event, serverTime: Date.now() });
    for (const socket of this.ctx.getWebSockets()) {
      const identity = socket.deserializeAttachment();
      if (identity.expiresAt <= Date.now()) { socket.close(4001, 'Sessão expirada'); continue; }
      try { socket.send(data); } catch { socket.close(1011, 'Reconecte'); }
    }
  }
  deliver(event) {
    // These methods are binding-only RPC. Browsers cannot call them directly.
    if (event.actorId && event.actorId !== this.config.id && ['message', 'typing', 'receipt', 'call'].includes(event.type) && !this.config.friends?.includes(event.actorId) && !(event.type!=='call' && this.config.dmPeers?.includes(event.actorId))) return false;
    this.broadcast(event); return true;
  }
  forget(id) { this.sql.exec('DELETE FROM state WHERE key=?', `peer:${id}`); this.broadcast({ type: 'presence', userId: id, value: { status: 'offline', activity: null, hidden: true } }); }
  receivePresence(id, value) {
    if (!this.config.friends?.includes(id)) return;
    this.put(`peer:${id}`, value);
    this.broadcast({ type: 'presence', userId: id, value });
  }
  ownState() {
    const prefs = this.config.settings || defaults;
    const clients = this.ctx.getWebSockets().filter(ws => ws.readyState === 1).map(ws => ws.deserializeAttachment()).filter(c => c.expiresAt > Date.now() && c.lastActive > Date.now() - ACTIVE_FOR);
    const playing = clients.filter(c => c.activity?.playing).sort((a, b) => b.activity.changedAt - a.activity.changedAt)[0];
    const active = playing || clients.sort((a, b) => b.lastActive - a.lastActive)[0];
    const hidden = !prefs.show_presence || prefs.presence === 'invisible';
    return { status: hidden || !active ? 'offline' : prefs.presence === 'online' ? (clients.some(c => c.presence === 'online') ? 'online' : 'away') : prefs.presence,
      hidden, statusText: prefs.status_text, activity: active && prefs.show_activity && !hidden ? active.activity : null,
      updatedAt: Date.now(), lastSeen: hidden ? null : active?.lastActive || this.get('lastSeen').at || null };
  }
  snapshot() {
    const result = {};
    for (const id of this.config.friends || []) {
      const value = this.get(`peer:${id}`);
      result[id] = value.updatedAt > Date.now() - ACTIVE_FOR ? value : { ...value, status: 'offline', activity: null };
    }
    return result;
  }
  async publicState(viewer) {
    if (!this.config.friends?.includes(viewer)) return { status: 'offline', activity: null };
    return this.ownState();
  }
  async recent(viewer) {
    if (!this.config.friends?.includes(viewer) || !this.config.settings.share_history || !this.config.settings.show_activity || !this.config.settings.show_presence || this.config.settings.presence === 'invisible') return [];
    const rows = this.get('history'); return Array.isArray(rows) ? rows : [];
  }
  async announce() {
    if (!this.config.id) return;
    const value = this.ownState();
    this.broadcast({ type: 'self_presence', value });
    // No D1 writes for heartbeats, track position, presence or typing.
    const friends = this.config.friends || [];
    for (let i = 0; i < friends.length; i += 20) await Promise.all(friends.slice(i, i + 20).map(id => this.env.SOCIAL.getByName(id).receivePresence(this.config.id, value)));
  }
  async resolveTrack(id, origin) {
    const cached = this.get('track');
    if (cached.id === id) return cached;
    const row = await this.env.DB.prepare(`SELECT t.id,t.title,t.artist,t.album,t.duration_seconds,t.cover_key,t.metadata_json,a.cover_key AS album_cover_key,a.cover_url
      FROM tracks t LEFT JOIN albums a ON a.id=t.primary_album_id WHERE t.id=? AND t.import_batch_id IS NULL`).bind(id).first();
    if (!row) return null;
    const metadata = parse(row.metadata_json);
    const media = key => key ? `${origin}/api/media/${encodeURIComponent(key)}` : '';
    const track = { id: row.id, title: row.title, artist: row.artist, album: row.album, seconds: row.duration_seconds,
      cover: metadata.coverMode === 'album' ? media(row.album_cover_key) || row.cover_url || metadata.coverUrl || media(row.cover_key) : metadata.coverUrl || media(row.cover_key) || media(row.album_cover_key) || row.cover_url || '' };
    this.put('track', track); return track;
  }
  async webSocketMessage(ws, input) {
    const identity = ws.deserializeAttachment();
    if (!identity || identity.expiresAt <= Date.now()) { ws.close(4001, 'Sessão expirada'); return; }
    if (typeof input !== 'string' || input.length > 32000 || !this.consume('socket', 120, 60)) { ws.send(encode({ type: 'error', error: 'Limite de mensagens em tempo real.' })); return; }
    try {
      const event = JSON.parse(input);
      if (event.type === 'presence') {
        if (!this.consume('presence', 20, 60)) return;
        identity.lastActive = Date.now(); identity.presence = event.away ? 'away' : 'online';
        if (this.config.settings.show_activity && event.trackId) {
          const track = await this.resolveTrack(String(event.trackId), identity.origin);
          identity.activity = track ? { track, playing: Boolean(event.playing), position: Math.min(track.seconds || 86400, Math.max(0, Number(event.position) || 0)), updatedAt: Date.now(), changedAt: Math.min(Date.now(), Number(event.changedAt) || Date.now()) } : null;
          if (track && event.playing && this.config.settings.share_history) {
            const history = this.get('history');
            const rows = Array.isArray(history) ? history : [];
            if (rows[0]?.track.id !== track.id) this.put('history', [{ track, at: Date.now() }, ...rows].slice(0, 20));
          }
        } else identity.activity = null;
        ws.serializeAttachment(identity); this.put('lastSeen', { at: Date.now() });
        await this.schedule(ACTIVE_FOR);
        await this.announce();
      } else if (event.type === 'typing') {
        if (!(this.config.friends.includes(event.peerId) || this.config.dmPeers?.includes(event.peerId)) || event.conversationId !== pairId(identity.userId, event.peerId) || !this.consume('typing', 20, 60)) return;
        await this.env.SOCIAL.getByName(event.peerId).deliver({ type: 'typing', actorId: identity.userId, conversationId: event.conversationId, typing: Boolean(event.typing) });
      } else if (event.type === 'listen_control' && typeof event.sessionId === 'string') {
        if (!this.consume('listen_control', 45, 60)) return;
        await this.env.LISTENING.getByName(event.sessionId).control(identity.userId, event);
      } else if (event.type === 'call_signal') {
        if (!uuid(event.callId) || !this.config.friends.includes(event.peerId) || !['accept','offer','answer','ice','hangup'].includes(event.signal?.type)) return;
        const remote = this.env.SOCIAL.getByName(event.peerId);
        await remote.callSignal(identity.userId, event.callId, event.signal);
      }
    } catch (error) { ws.send(encode({ type: 'error', error: error.status ? error.message : 'Não foi possível concluir a ação em tempo real.' })); }
  }
  callSignal(sender, callId, signal) {
    if (!this.config.friends?.includes(sender) || this.config.settings.call_invites !== 'friends') return;
    this.broadcast({ type: 'call', actorId: sender, callId, signal });
  }
  async revoke(hash) { this.put(`revoked:${hash}`, { at: Date.now() }); for (const ws of this.ctx.getWebSockets(hash)) ws.close(4001, 'Sessão encerrada'); await this.announce(); }
  async webSocketClose(ws, code) { ws.close(code === 1006 ? 1000 : code, 'Desconectado'); await this.announce(); }
  async webSocketError(ws) { ws.close(1011, 'Reconecte'); await this.announce(); }
  async alarm() {
    if(this.config?.id) {
      const due=await this.env.DB.prepare('SELECT * FROM social_reminders WHERE user_id=? AND delivered_at IS NULL AND due_at<=? ORDER BY due_at LIMIT 100').bind(this.config.id,Date.now()).all();
      for(const reminder of due.results) { let allowed=true; try {await member(this.env,reminder.conversation_id,this.config.id);if(!await this.env.DB.prepare('SELECT id FROM messages WHERE id=? AND deleted_at IS NULL').bind(reminder.message_id).first())allowed=false;} catch {allowed=false;}
        if(allowed) { const payload={conversationId:reminder.conversation_id,messageId:reminder.message_id,displayName:'Lembrete'}; const id=`reminder:${reminder.id}`,at=Date.now(); const inserted=await this.env.DB.prepare("INSERT OR IGNORE INTO social_notifications(id,user_id,actor_id,kind,payload_json,created_at) VALUES(?,?,NULL,'reminder',?,?)").bind(id,this.config.id,encode(payload),at).run();if(inserted.meta.changes) this.broadcast({type:'notification',id,actorId:null,kind:'reminder',payload,createdAt:at}); }
        await this.env.DB.prepare('UPDATE social_reminders SET delivered_at=? WHERE id=? AND user_id=?').bind(Date.now(),reminder.id,this.config.id).run();
      }
      const next=await this.env.DB.prepare('SELECT MIN(due_at) AS due FROM social_reminders WHERE user_id=? AND delivered_at IS NULL').bind(this.config.id).first(); if(next?.due) await this.scheduleReminder(next.due);
      const groupDue=await this.env.DB.prepare('SELECT * FROM social_group_reminders WHERE user_id=? AND delivered_at IS NULL AND due_at<=? ORDER BY due_at LIMIT 100').bind(this.config.id,Date.now()).all();
      for(const reminder of groupDue.results){let allowed=true;try{await groupMember(this.env,reminder.group_id,this.config.id);if(!await this.env.DB.prepare('SELECT id FROM social_group_messages WHERE id=? AND deleted_at IS NULL').bind(reminder.message_id).first())allowed=false;}catch{allowed=false;}if(allowed){const payload={groupId:reminder.group_id,messageId:reminder.message_id,displayName:'Lembrete'},id=`group-reminder:${reminder.id}`,at=Date.now();const inserted=await this.env.DB.prepare("INSERT OR IGNORE INTO social_notifications(id,user_id,actor_id,kind,payload_json,created_at) VALUES(?,?,NULL,'group_reminder',?,?)").bind(id,this.config.id,encode(payload),at).run();if(inserted.meta.changes)this.broadcast({type:'notification',id,actorId:null,kind:'group_reminder',payload,createdAt:at});}await this.env.DB.prepare('UPDATE social_group_reminders SET delivered_at=? WHERE id=? AND user_id=?').bind(Date.now(),reminder.id,this.config.id).run();}
      const nextGroup=await this.env.DB.prepare('SELECT MIN(due_at) AS due FROM social_group_reminders WHERE user_id=? AND delivered_at IS NULL').bind(this.config.id).first();if(nextGroup?.due)await this.scheduleReminder(nextGroup.due);
    }
    for (const row of this.sql.exec("SELECT key,value FROM state WHERE key LIKE 'ticket:%'").toArray()) if (parse(row.value).deadline < Date.now()) this.sql.exec('DELETE FROM state WHERE key=?', row.key);
    this.sql.exec("DELETE FROM state WHERE key LIKE 'revoked:%' AND json_extract(value,'$.at')<?", Date.now() - 31 * 86400000);
    for (const ws of this.ctx.getWebSockets()) { const data = ws.deserializeAttachment(); if (data.lastActive < Date.now() - ACTIVE_FOR || data.expiresAt <= Date.now()) ws.close(4001, 'Reconecte para atualizar sua presença'); }
    await this.announce();
    if (this.ctx.getWebSockets().some(ws => ws.readyState === 1)) await this.schedule(ACTIVE_FOR);
  }
}

export class ListeningSession extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
  }
  state() { return parse(this.ctx.storage.sql.exec('SELECT value FROM room WHERE id=1').toArray()[0]?.value); }
  save(value) { this.ctx.storage.sql.exec('INSERT INTO room(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', encode(value)); }
  async create(value) {
    const existing = this.state();
    if (existing.id) return existing;
    this.save({ ...value, status: 'pending', revision: 1, updatedAt: Date.now(), position: 0, playing: false, guestCanControl: false });
    await this.ctx.storage.setAlarm(Date.now() + 300000);
  }
  async join(userId) {
    let state = this.state();
    if (!state || state.guestId !== userId || state.status !== 'pending' || state.expiresAt < Date.now()) throw problem('Convite expirado ou indisponível.', 409);
    await requireFriend(this.env, state.hostId, state.guestId);
    if ((await settings(this.env, userId)).listening_invites === 'none') throw problem('Convites estão desativados.', 403);
    // Re-read after network I/O: a concurrent block/end must never be undone.
    state = this.state();
    if (state.status !== 'pending' || state.expiresAt < Date.now()) throw problem('Convite encerrado.', 409);
    state.status = 'active'; state.playing = true; state.updatedAt = Date.now(); state.startedAt=state.updatedAt; state.played=[{trackId:state.trackId,at:state.startedAt}]; state.expiresAt = Date.now() + 4 * 3600000; state.revision++;
    this.save(state);
    await this.env.DB.prepare("UPDATE listening_sessions SET status='active',started_at=? WHERE id=? AND status='pending'").bind(state.startedAt,state.id).run();
    await this.ctx.storage.setAlarm(Date.now() + 4 * 3600000);
    await this.publish(state); return state;
  }
  async snapshot(userId) {
    const state = this.state();
    if (!state || ![state.hostId, state.guestId].includes(userId)) throw problem('Sessão não encontrada.', 404);
    await requireFriend(this.env, state.hostId, state.guestId); return state;
  }
  async enqueue(userId, trackId) {
    let state = await this.snapshot(userId);
    if (state.status !== 'active') throw problem('Sessão indisponível.',403);
    if (!await this.env.DB.prepare('SELECT id FROM tracks WHERE id=? AND import_batch_id IS NULL').bind(trackId).first()) throw problem('Música indisponível.',404);
    state = this.state();
    if (state.status !== 'active' || ![state.hostId,state.guestId].includes(userId)) throw problem('Sessão encerrada.',403);
    state.queue = Array.isArray(state.queue) ? state.queue : [];
    if (state.queue.length >= 100) throw problem('Fila cheia.',409);
    state.queue.push({id:crypto.randomUUID(),trackId,addedBy:userId}); state.revision++; this.save(state); await this.publish(state); return state;
  }
  async next(userId) {
    let state = await this.snapshot(userId);
    state = this.state();
    if (state.status !== 'active' || (userId !== state.hostId && !state.guestCanControl)) throw problem('Controle indisponível.',403);
    if (!state.queue?.length) throw problem('A fila está vazia.',409);
    const item=state.queue.shift(); state.trackId=item.trackId; state.position=0; state.playing=true; state.updatedAt=Date.now(); state.played=[...(state.played||[]),{trackId:item.trackId,at:state.updatedAt}].slice(-500); state.revision++;
    this.save(state); await this.publish(state); return state;
  }
  async control(userId, event) {
    let state = this.state();
    if (!state || state.status !== 'active' || ![state.hostId, state.guestId].includes(userId)) throw problem('Sessão indisponível.', 403);
    if (userId !== state.hostId && !state.guestCanControl) throw problem('O anfitrião controla esta sessão. Você pode sair para ouvir por conta própria.', 403);
    if (event.trackId && event.trackId !== state.trackId && !await this.env.DB.prepare('SELECT id FROM tracks WHERE id=? AND import_batch_id IS NULL').bind(event.trackId).first()) throw problem('Música indisponível.', 404);
    state = this.state();
    if (state.status !== 'active' || (userId !== state.hostId && !state.guestCanControl)) throw problem('Sessão encerrada ou controle indisponível.', 403);
    if (event.action === 'permissions' && userId === state.hostId) state.guestCanControl = Boolean(event.guestCanControl);
    else {
      if (event.trackId && event.trackId!==state.trackId) { state.trackId = event.trackId; state.played=[...(state.played||[]),{trackId:event.trackId,at:Date.now()}].slice(-500); }
      state.position = Math.min(86400, Math.max(0, Number(event.position) || 0)); state.playing = Boolean(event.playing);
    }
    state.updatedAt = Date.now(); state.revision++;
    this.save(state); await this.publish(state);
  }
  async publish(state) {
    await Promise.all([state.hostId, state.guestId].map(id => this.env.SOCIAL.getByName(id).deliver({ type: 'listening', session: state })));
  }
  async end(userId) {
    const state = this.state();
    if (!state.id || ![state.hostId, state.guestId].includes(userId) || state.status === 'ended') return;
    state.status = 'ended'; state.revision++; state.updatedAt = Date.now();
    this.save(state);
    await this.env.DB.prepare("UPDATE listening_sessions SET status='ended',ended_at=?,history_json=? WHERE id=?").bind(state.updatedAt,encode(state.played||[]),state.id).run();
    await this.publish(state); await this.ctx.storage.deleteAlarm();
  }
  async alarm() { const state = this.state(); if (state.id) await this.end(state.hostId); }
}
