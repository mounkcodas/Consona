import { useCallback, useEffect, useRef, useState } from 'react';

export const readLocal = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
export const saveLocal = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
export const socialPath = id => encodeURIComponent(id);
const initial = { friends: [], incoming: [], outgoing: [], blocked: [], dmContacts:[], dmIncoming:[], dmOutgoing:[], conversations: [], notifications: [], settings: {}, presence: {}, notificationCount: 0 };
export function mergeMessages(rows = [], incoming = []) {
  const map = new Map(rows.map(row => [row.clientId ? `${row.senderId}:${row.clientId}` : row.id, row]));
  for (const row of incoming) map.set(row.clientId ? `${row.senderId}:${row.clientId}` : row.id, row);
  return [...map.values()].sort((a, b) => (a.seq || Number.MAX_SAFE_INTEGER) - (b.seq || Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt);
}

export default function useSocial({ user, api, player, onListening, onIncoming }) {
  const [state, setState] = useState(initial);
  const [connection, setConnection] = useState('connecting');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState({});
  const [pages, setPages] = useState({});
  const [typing, setTyping] = useState({});
  const [groupUnread, setGroupUnread] = useState(0);
  const [lastfm,setLastfm]=useState({configured:false,connected:false,username:''});
  const [session, setSession] = useState(null);
  const [callEvent, setCallEvent] = useState([]);
  const socket = useRef(null), latest = useRef({}), pendingPages = useRef(new Set()), receiptSeq = useRef({});
  const ignorePlayerUntil = useRef(0), skew = useRef(0), refreshTimer = useRef(null), refreshInFlight = useRef(null);
  const settingsQueue = useRef(Promise.resolve()), settingsVersion = useRef(0);
  const deferredControl = useRef(null);
  const activeRoomKey = `consona-listening:${user.id}`;
  const request = useCallback((path, method = 'GET', data) => api(`/api/social${path}`, { method, ...(data instanceof FormData ? { body: data } : data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) }), [api]);
  latest.current = { state, messages, player, onListening, onIncoming, session };
  const fail = useCallback(error => { if (error?.name !== 'AbortError') setError(error?.message || String(error)); }, []);
  const refreshGroupUnread = useCallback(async () => { try { const value=await request('/groups'); setGroupUnread(value.groups.reduce((total,group)=>total+group.unread,0)); } catch (error) { fail(error); } },[request,fail]);
  const refreshLastfm = useCallback(async()=>{try{setLastfm(await request('/lastfm/state'));}catch(error){fail(error);}},[request,fail]);
  useEffect(()=>{refreshGroupUnread();},[refreshGroupUnread]);
  useEffect(()=>{refreshLastfm();},[refreshLastfm]);
  useEffect(()=>{const audio=player.audioRef.current,trackId=player.current?.id;if(!audio || !trackId || !lastfm.connected)return;const state={clientId:crypto.randomUUID(),startedAt:0,played:0,lastPosition:null,lastWall:0,submitted:false,retryAfter:0};
    function progress(){if(audio.paused || audio.seeking)return;const now=Date.now(),position=audio.currentTime;if(!state.startedAt)state.startedAt=now;if(state.lastPosition!==null){const delta=position-state.lastPosition,wall=(now-state.lastWall)/1000;if(delta>0 && delta<5 && wall>0 && wall<10)state.played+=Math.min(delta,wall+0.5);}state.lastPosition=position;state.lastWall=now;const duration=Number.isFinite(audio.duration)?audio.duration:player.current?.seconds;if(duration>=30 && state.played>=Math.min(duration/2,240) && !state.submitted && now>=state.retryAfter){state.submitted=true;request('/lastfm/scrobble','POST',{trackId,clientId:state.clientId,startedAt:state.startedAt,playedSeconds:state.played}).catch(()=>{state.submitted=false;state.retryAfter=Date.now()+60000;});}}
    function seek(){state.lastPosition=audio.currentTime;state.lastWall=Date.now();}function ended(){state.clientId=crypto.randomUUID();state.startedAt=0;state.played=0;state.lastPosition=null;state.submitted=false;state.retryAfter=0;}
    audio.addEventListener('timeupdate',progress);audio.addEventListener('seeked',seek);audio.addEventListener('ended',ended);return()=>{audio.removeEventListener('timeupdate',progress);audio.removeEventListener('seeked',seek);audio.removeEventListener('ended',ended);};
  },[player.audioRef,player.current?.id,lastfm.connected,request]);
  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current;
    refreshInFlight.current = request('/state').then(value => {
      setState(value); setLoading(false);
      const allowed = new Set(value.conversations.map(c => c.id));
      setMessages(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => allowed.has(id))));
      return value;
    }).catch(error => { fail(error); setLoading(false); }).finally(() => { refreshInFlight.current = null; });
    return refreshInFlight.current;
  }, [request, fail]);
  const scheduleRefresh = useCallback(() => { clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(refresh, 180); }, [refresh]);
  const sendEvent = useCallback(value => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    socket.current.send(JSON.stringify(value)); return true;
  }, []);
  const receiveMessages = useCallback(rows => {
    const grouped = {};
    for (const row of rows) (grouped[row.conversationId] ||= []).push(row);
    setMessages(previous => { const next = { ...previous }; for (const [id, items] of Object.entries(grouped)) next[id] = mergeMessages(previous[id], items); return next; });
  }, []);
  const receipt = useCallback(async (id, seq, read = false) => {
    if (!seq) return;
    const key = `${id}:${read ? 'read' : 'delivered'}`;
    if ((receiptSeq.current[key] || 0) >= seq) return;
    receiptSeq.current[key] = seq;
    try {
      await request(`/conversations/${socialPath(id)}/receipt`, 'POST', { seq, read });
      if (read) setState(s => ({ ...s, conversations: s.conversations.map(c => c.id === id ? { ...c, unread: 0, lastReadSeq: Math.max(c.lastReadSeq, seq) } : c) }));
    } catch (error) { delete receiptSeq.current[key]; fail(error); }
  }, [request, fail]);
  const markUnread = useCallback(async id => {
    await request(`/conversations/${socialPath(id)}`, 'PUT', { manual_unread: true });
    delete receiptSeq.current[`${id}:read`];
    setState(s => ({ ...s, conversations: s.conversations.map(c => c.id === id ? { ...c, unread: Math.max(1, c.unread) } : c) }));
  }, [request]);
  const loadMessages = useCallback(async (id, before) => {
    const key = `${id}:${before || 'latest'}`;
    if (pendingPages.current.has(key)) return;
    pendingPages.current.add(key);
    try {
      const value = await request(`/conversations/${socialPath(id)}/messages${before ? `?before=${before}` : ''}`);
      receiveMessages(value.messages);
      setPages(p => ({ ...p, [id]: { hasMore: value.hasMore, before: value.nextBefore } }));
      receipt(id, value.nextAfter);
      return value;
    } finally { pendingPages.current.delete(key); }
  }, [request, receiveMessages, receipt]);
  const applySession = useCallback(value => {
    const previous = latest.current.session;
    if (previous?.id === value.id && previous.revision >= value.revision) return;
    latest.current.session = value; setSession(value);
    saveLocal(activeRoomKey, value.status === 'active' ? value.id : null);
    if (value.status === 'active') {
      ignorePlayerUntil.current = Date.now() + 1600;
      const position = value.position + (value.playing ? Math.max(0, Date.now() + skew.current - value.updatedAt) / 1000 : 0);
      latest.current.onListening({ ...value, position });
    }
  }, [activeRoomKey]);
  const announce = useCallback(() => {
    const p = latest.current.player;
    if (!p) return;
    sendEvent({ type: 'presence', away: document.hidden, trackId: p.current?.id || null, playing: p.playing,
      position: p.audioRef.current?.currentTime || 0, changedAt: Date.now() });
  }, [sendEvent]);
  const control = useCallback(() => {
    const { player: p, session: room } = latest.current;
    if (!room || room.status !== 'active' || !p.current || (room.hostId !== user.id && !room.guestCanControl)) return;
    if (Date.now() < ignorePlayerUntil.current) {
      const expected = room.position + (room.playing ? Math.max(0, Date.now() + skew.current - room.updatedAt) / 1000 : 0);
      if (p.current.id !== room.trackId || p.playing !== room.playing || Math.abs((p.audioRef.current?.currentTime || 0) - expected) > 1.5) {
        clearTimeout(deferredControl.current);
        deferredControl.current = setTimeout(control, ignorePlayerUntil.current - Date.now() + 50);
      }
      return;
    }
    sendEvent({ type: 'listen_control', sessionId: room.id, trackId: p.current.id, playing: p.playing, position: p.audioRef.current?.currentTime || 0 });
  }, [sendEvent, user.id]);
  useEffect(() => {
    let disposed = false, retry = 1000, reconnectTimer, pingTimer;
    const notifyBrowser = (id, title, body) => {
      if (!document.hidden || !latest.current.state.settings.browser_notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
      const key = `consona-notified:${user.id}`;
      if (readLocal(key, '') === id) return;
      saveLocal(key, id);
      const notification = new Notification(title, { body, tag: id, icon: '/consona-mark.png' });
      notification.onclick = () => { window.focus(); notification.close(); };
    };
    const connect = async () => {
      setConnection('connecting');
      try {
        const { url } = await request('/ticket', 'POST');
        if (disposed) return;
        const ws = new WebSocket(url); socket.current = ws;
        ws.onopen = () => { retry = 1000; setConnection('online'); announce(); pingTimer = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 25000); };
        ws.onmessage = async ({ data }) => {
          if (data === 'pong' || disposed) return;
          let event; try { event = JSON.parse(data); } catch { return; }
          if (event.serverTime) skew.current = event.serverTime - Date.now();
          if (event.type === 'ready') {
            setState(s => ({ ...s, settings: event.settings, presence: event.presence }));
            const value = await refresh();
            // Reconnect recovers a bounded page per known conversation, including edits.
            for (const c of value?.conversations || []) if (latest.current.messages[c.id]) loadMessages(c.id).catch(fail);
            const saved = readLocal(activeRoomKey, null);
            if (saved) request(`/listen/${saved}`).then(v => applySession(v.session)).catch(() => { saveLocal(activeRoomKey, null); setSession(null); });
          } else if (event.type === 'presence') setState(s => ({ ...s, presence: { ...s.presence, [event.userId]: event.value } }));
          else if (event.type === 'social_changed') {
            if (event.removed?.length) {
              setMessages(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !event.removed.some(peer => id.split(':').includes(peer)))));
              setState(s => ({ ...s, friends: s.friends.filter(f => !event.removed.includes(f.id)), conversations: s.conversations.filter(c => !event.removed.includes(c.peerId)) }));
            }
            scheduleRefresh();
          } else if (event.type === 'message') {
            const m = event.message;
            const known = latest.current.messages[m.conversationId]?.some(row => row.id === m.id);
            receiveMessages([m]);
            const old = latest.current.state.conversations.find(c => c.id === m.conversationId);
            if (!old) scheduleRefresh();
            else setState(s => ({ ...s, conversations: s.conversations.map(c => c.id !== m.conversationId ? c : { ...c, updatedAt: Math.max(c.updatedAt, m.createdAt),
              lastSeq: Math.max(c.lastSeq, m.seq), preview: m.seq >= c.lastSeq ? (m.deletedAt ? 'Mensagem excluída' : m.text || 'Compartilhou um arquivo ou música') : c.preview,
              unread: c.unread + (!known && m.senderId !== user.id && m.seq > c.lastSeq ? 1 : 0), archived: false }) }));
            if (m.senderId !== user.id && !m.deletedAt && !m.editedAt) {
              receipt(m.conversationId, m.seq);
              if (!known) setState(s => {
                const id = `message:${m.id}`;
                if (s.notifications.some(n => n.id === id)) return s;
                const friend = s.friends.find(f => f.id === m.senderId);
                return { ...s, notificationCount: s.notificationCount + 1, notifications: [{ id, actorId:m.senderId, kind:'message', createdAt:m.createdAt, readAt:null, payload:{conversationId:m.conversationId, displayName:friend?.displayName || 'Amigo'} }, ...s.notifications].slice(0,50) };
              });
              if (!known && !old?.muted) {
                latest.current.onIncoming(m.conversationId);
                const friend = latest.current.state.friends.find(f => f.id === m.senderId);
                notifyBrowser(m.id, friend?.displayName || 'Mensagem no Consona', m.kind === 'text' ? m.text : 'Compartilhou um arquivo ou música');
              }
            }
          } else if (event.type === 'group_update') { refreshGroupUnread(); window.dispatchEvent(new CustomEvent('consona-group-update', { detail: event.groupId })); }
          else if (event.type === 'group_typing') window.dispatchEvent(new CustomEvent('consona-group-typing', { detail: event }));
          else if (event.type === 'message_features') window.dispatchEvent(new CustomEvent('consona-message-features', { detail: event.conversationId }));
          else if (event.type === 'receipt') setState(s => ({ ...s, conversations: s.conversations.map(c => c.id !== event.conversationId ? c : event.actorId === user.id ? { ...c, lastReadSeq: event.readSeq, unread: event.readSeq >= c.lastSeq ? 0 : c.unread } : { ...c, peerReadSeq: event.readSeq, peerDeliveredSeq: event.deliveredSeq }) }));
          else if (event.type === 'typing') setTyping(t => ({ ...t, [event.conversationId]: event.typing ? Date.now() + 4500 : 0 }));
          else if (event.type === 'notification') {
            setState(s => ({ ...s, notifications: [event, ...s.notifications.filter(n => n.id !== event.id)].slice(0, 50), notificationCount: s.notificationCount + 1 }));
            notifyBrowser(event.id, 'Consona · Amigos', event.kind === 'listening_invite' ? `${event.payload.displayName} quer ouvir com você` : 'Você tem uma novidade nos amigos');
            if (event.kind !== 'message') scheduleRefresh();
          } else if (event.type === 'listening') applySession(event.session);
          else if (event.type === 'call') setCallEvent(events => [...events, event]);
          else if (event.type === 'error') fail(new Error(event.error));
        };
        ws.onclose = () => { clearInterval(pingTimer); if (!disposed) { setConnection('offline'); reconnectTimer = setTimeout(connect, retry); retry = Math.min(30000, retry * 2); } };
        ws.onerror = () => ws.close();
      } catch (error) { if (!disposed) { setConnection('offline'); fail(error); reconnectTimer = setTimeout(connect, retry); retry = Math.min(30000, retry * 2); } }
    };
    refresh(); connect();
    const heartbeat = setInterval(() => { announce(); control(); setTyping(t => Object.fromEntries(Object.entries(t).filter(([, expiry]) => expiry > Date.now()))); }, 30000);
    const onVisibility = () => { announce(); if (!document.hidden && socket.current?.readyState === 1) control(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { disposed = true; clearTimeout(reconnectTimer); clearTimeout(refreshTimer.current); clearTimeout(deferredControl.current); clearInterval(pingTimer); clearInterval(heartbeat); socket.current?.close(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [user.id, request, refresh, scheduleRefresh, announce, control, fail, receiveMessages, receipt, loadMessages, activeRoomKey, applySession]);
  useEffect(() => { const timer = setTimeout(() => { announce(); control(); }, 250); return () => clearTimeout(timer); }, [player.current?.id, player.playing, announce, control]);
  useEffect(() => {
    const audio = player.audioRef.current; let timer;
    const seek = () => { clearTimeout(timer); timer = setTimeout(() => { announce(); control(); }, 500); };
    audio?.addEventListener('seeked', seek);
    return () => { clearTimeout(timer); audio?.removeEventListener('seeked', seek); };
  }, [player.audioRef, announce, control]);
  const openConversation = async peer => {
    const { id } = await request('/conversations', 'POST', { userId: peer });
    await refresh(); await loadMessages(id); return id;
  };
  const send = async (id, data, clientId = crypto.randomUUID()) => {
    const optimistic = { id: clientId, clientId, senderId: user.id, conversationId: id, text: data.text || '', kind: data.kind || 'text', payload: data.payload || {}, createdAt: Date.now(), pending: true, retryData: data };
    receiveMessages([optimistic]);
    try { const value = await request(`/conversations/${socialPath(id)}/messages`, 'POST', { ...data, clientId }); receiveMessages([value.message]); return value.message; }
    catch (error) { receiveMessages([{ ...optimistic, pending: false, failed: true }]); throw error; }
  };
  const updateSettings = async data => {
    const version = ++settingsVersion.current;
    setState(s => ({ ...s, settings: { ...s.settings, ...data } }));
    const pending = settingsQueue.current.catch(() => {}).then(() => request('/settings', 'PUT', data));
    settingsQueue.current = pending;
    try { const value = await pending; if (version === settingsVersion.current) setState(s => ({ ...s, settings: value.settings })); announce(); }
    catch (error) { await refresh(); throw error; }
  };
  const leaveSession = async () => { if (session?.id) await request(`/listen/${session.id}`, 'DELETE'); saveLocal(activeRoomKey, null); setSession(null); };
  return { state, loading, connection, error, setError, fail, request, refresh, groupUnread, refreshGroupUnread, lastfm, refreshLastfm, messages, pages, loadMessages, receiveMessages, receipt, markUnread, openConversation, send, sendEvent, typing, updateSettings,
    session, applySession, leaveSession, callEvent, clearCallEvent: () => setCallEvent([]) };
}
