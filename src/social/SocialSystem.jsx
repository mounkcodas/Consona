import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bell, BellOff, Check, ChevronDown, Headphones, Maximize2, MessageCircle, Minimize2, Minus, Music2, Play, Search, Settings, Shield, UserMinus, UserPlus, Users, X } from 'lucide-react';
import useSocial, { readLocal, saveLocal } from './useSocial.js';
import ChatPane, { Avatar, statusLabel } from './ChatPane.jsx';
import GroupPane from './GroupPane.jsx';
import CallPanel, { useCalls } from './CallPanel.jsx';
import './social.css';

const sections = [ ['conversations', 'Conversas', MessageCircle], ['groups', 'Grupos', Users], ['friends', 'Amigos', Users], ['requests', 'Solicitações', UserPlus], ['activity', 'Atividade musical', Music2], ['blocked', 'Bloqueados', Shield], ['settings', 'Privacidade', Settings] ];
function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); const node = ref.current; return () => node?.close(); }, []);
  return <dialog ref={ref} className="social-dialog social-surface" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><header className="social-gloss"><strong>{title}</strong><button aria-label="Fechar" onClick={onClose}><X size={20}/></button></header><div className="social-dialog-body">{children}</div></dialog>;
}
function FloatingWindow({ name, userId, title, children, className = '', onMinimize, onClose, onExpand }) {
  const key = `consona-window:${userId}:${name}`;
  const [position, setPosition] = useState(() => readLocal(key, null));
  const node = useRef(null), moving = useRef(null), saving = useRef(null);
  const clamp = value => ({ ...value, x: Math.max(8, Math.min(value.x, window.innerWidth - Math.min(value.width || 310, window.innerWidth - 16) - 8)), y: Math.max(8, Math.min(value.y, window.innerHeight - Math.min(value.height || 430, window.innerHeight - 130) - 100)) });
  useEffect(() => {
    const resize = () => { if (window.innerWidth > 700) setPosition(p => p ? clamp(p) : p); };
    resize();
    window.addEventListener('resize', resize);
    const observer = new ResizeObserver(() => { clearTimeout(saving.current); saving.current = setTimeout(() => { if (node.current && window.innerWidth > 700) { const rect = node.current.getBoundingClientRect(); saveLocal(key, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }); } }, 300); });
    if (node.current) observer.observe(node.current);
    return () => { window.removeEventListener('resize', resize); observer.disconnect(); clearTimeout(saving.current); };
  }, [key]);
  function move(event) {
    if (!moving.current) return;
    const value = clamp({ ...moving.current.rect, x: moving.current.rect.x + event.clientX - moving.current.x, y: moving.current.rect.y + event.clientY - moving.current.y });
    setPosition(value); saveLocal(key, value);
  }
  const style = position && window.innerWidth > 700 ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto', width: position.width, height: position.height } : {};
  return <section ref={node} className={`social-float social-surface ${className}`} style={style} aria-label={title}>
    <header className="social-gloss social-drag-handle" onPointerDown={e => {
      if (e.target.closest('button') || window.innerWidth <= 700) return;
      const rect = node.current.getBoundingClientRect(); moving.current = { x: e.clientX, y: e.clientY, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }; e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={move} onPointerUp={() => { moving.current = null; }} onPointerCancel={() => { moving.current = null; }}>
      <span tabIndex={0} aria-label={`${title}. Use as setas para mover a janela.`} onKeyDown={e => { if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) || window.innerWidth <= 700) return; e.preventDefault(); const rect = node.current.getBoundingClientRect(); const value = clamp({ x: rect.x + (e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0), y: rect.y + (e.key === 'ArrowUp' ? -20 : e.key === 'ArrowDown' ? 20 : 0), width: rect.width, height: rect.height }); setPosition(value); saveLocal(key, value); }}><Users size={19}/>{title}</span>
      <div>{onMinimize && <button aria-label={`Minimizar ${title}`} onClick={onMinimize}><Minus size={18}/></button>}{onExpand && <button aria-label={`Expandir ${title}`} onClick={onExpand}><Maximize2 size={16}/></button>}<button aria-label={`Fechar ${title}`} onClick={onClose}><X size={19}/></button></div>
    </header>{children}
  </section>;
}
function Privacy({ social }) {
  const settings = social.state.settings;
  const update = value => social.updateSettings(value).catch(social.fail);
  return <div className="social-settings"><h2>Sua privacidade</h2><p>Escolha como você aparece para seus amigos.</p>
    <label>Status<select aria-label="Status de presença" value={settings.presence || 'online'} onChange={e => update({ presence: e.target.value })}><option value="online">Online</option><option value="away">Ausente</option><option value="busy">Ocupado</option><option value="invisible">Invisível</option></select></label>
    <label>Mensagem pessoal<input maxLength={140} key={settings.status_text} defaultValue={settings.status_text} placeholder="O que você está pensando?" onBlur={e => { if (e.target.value !== settings.status_text) update({ status_text: e.target.value }); }}/></label>
    {[['show_presence','Mostrar minha presença'],['show_activity','Mostrar minha atividade musical'],['share_history','Compartilhar minhas últimas 20 músicas']].map(([key,label]) => <label className="social-toggle" key={key}><input type="checkbox" checked={Boolean(settings[key])} onChange={e => update({ [key]: e.target.checked })}/><span>{label}</span></label>)}
    <small>A música atual e o histórico só aparecem aos seus amigos quando a presença e a atividade musical estão visíveis. O modo invisível oculta tudo.</small>
    {[['requests','Solicitações de amizade','everyone','Qualquer usuário'],['messages','Mensagens','friends','Meus amigos'],['listening_invites','Convites para ouvir junto','friends','Meus amigos'],['call_invites','Chamadas de voz e vídeo','friends','Meus amigos']].map(([key,label,value,text]) => <label key={key}>{label}<select aria-label={label} value={settings[key] || 'none'} onChange={e => update({ [key]: e.target.value })}><option value={value}>{text}</option><option value="none">Ninguém</option></select></label>)}
    <button className="social-primary" onClick={async () => {
      if (!('Notification' in window)) return social.fail(new Error('Seu navegador não oferece notificações.'));
      if (settings.browser_notifications) return update({ browser_notifications: false });
      const permission = await Notification.requestPermission();
      if (permission === 'granted') update({ browser_notifications: true });
      else social.fail(new Error('Notificações não autorizadas. Você pode alterar a permissão nas configurações do navegador.'));
    }}>{settings.browser_notifications ? <BellOff size={17}/> : <Bell size={17}/>} {settings.browser_notifications ? 'Desativar notificações do navegador' : 'Ativar notificações do navegador'}</button>
  </div>;
}

export default function SocialSystem({ user, api, apiBase, library, player, expanded, onExpand, onCollapse, onPlay, onFavorite, onOpenAlbum, onListening, onUnread }) {
  const [mode, setMode] = useState(() => readLocal(`consona-social-mode:${user.id}`, 'minimized'));
  const [view, setView] = useState('conversations'), [selected, setSelected] = useState(() => readLocal(`consona-chat:${user.id}`, ''));
  const [chatVisible, setChatVisible] = useState(false), [selectedFriend, setSelectedFriend] = useState('');
  const [drafts, setDrafts] = useState(() => readLocal(`consona-drafts:${user.id}`, {}));
  const scrolls = useRef(readLocal(`consona-scroll:${user.id}`, {}));
  const [query, setQuery] = useState(''), [sort, setSort] = useState('presence'), [users, setUsers] = useState([]), [searchBusy, setSearchBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false), [notifications, setNotifications] = useState(false), [profile, setProfile] = useState(null), [report, setReport] = useState(null), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [profileBusy, setProfileBusy] = useState(false);
  const [sessionTrack, setSessionTrack] = useState('');
  const [jumpMessage, setJumpMessage] = useState('');
  const social = useSocial({ user, api, player, onListening, onIncoming: id => { setMode('floating'); setChatVisible(true); setSelected(current => current || id); } });
  const calls = useCalls(social);
  const unread = social.state.conversations.reduce((total, c) => total + c.unread, 0), requests = social.state.incoming.length;
  const conversation = social.state.conversations.find(c => c.id === selected);
  const friend = social.state.friends.find(f => f.id === (conversation?.peerId || selectedFriend));
  const presence = social.state.presence[friend?.id] || { status: 'offline' };
  useEffect(() => { saveLocal(`consona-social-mode:${user.id}`, mode); }, [mode, user.id]);
  useEffect(() => { saveLocal(`consona-chat:${user.id}`, selected); }, [selected, user.id]);
  useEffect(() => { const timer = setTimeout(() => saveLocal(`consona-drafts:${user.id}`, drafts), 250); return () => clearTimeout(timer); }, [drafts, user.id]);
  useEffect(() => { onUnread(unread + requests); }, [unread, requests, onUnread]);
  useEffect(() => { if (expanded && selected) setChatVisible(true); }, [expanded]);
  useEffect(() => {
    if (social.loading) return;
    const messageId = new URL(window.location.href).searchParams.get('socialMessage');
    if (!messageId) return;
    let active = true;
    social.request(`/messages/${encodeURIComponent(messageId)}/location`).then(value => {
      if (!active) return;
      setSelected(value.conversationId); setView('conversations'); setChatVisible(true); setJumpMessage(messageId); onExpand();
      const next = new URL(window.location.href); next.searchParams.delete('socialMessage'); window.history.replaceState(null, '', next);
    }).catch(social.fail);
    return () => { active = false; };
  }, [social.loading]);
  useEffect(() => { if (!social.loading && selected && !social.state.conversations.some(c => c.id === selected)) { setSelected(''); setChatVisible(false); } }, [social.state.conversations, social.loading]);
  useEffect(() => { if (profile?.isFriend && !social.state.friends.some(f => f.id === profile.id)) setProfile(null); }, [social.state.friends]);
  useEffect(() => {
    if (view !== 'friends' || query.trim().replace(/^@/,'').length < 2) { setUsers([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearchBusy(true);
      try { const result = await social.request(`/users?q=${encodeURIComponent(query.trim())}`); if (!cancelled) setUsers(result.users); }
      catch (error) { if (!cancelled) social.fail(error); } finally { if (!cancelled) setSearchBusy(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, view]);
  const run = async action => { setBusy(true); try { return await action(); } catch (error) { social.fail(error); } finally { setBusy(false); } };
  async function open(friend) { await run(async () => { const id = await social.openConversation(friend.id); setSelected(id); setSelectedFriend(friend.id); setChatVisible(true); setView('conversations'); if (!expanded) setMode('floating'); }); }
  function chooseConversation(c) { setSelected(c.id); setSelectedFriend(c.peerId); setChatVisible(true); }
  async function showProfile(target = friend) {
    if (!target) return;
    setProfileBusy(true); try { setProfile(await social.request(`/profiles/${target.id}`)); } catch (error) { social.fail(error); } finally { setProfileBusy(false); }
  }
  async function mutate(path, method = 'POST', body) { await social.request(path, method, body); await social.refresh(); }
  function reportUser(target, messageId) { setReport({ user: target, messageId }); setReason(''); }
  async function invite(target, trackId) {
    if (!trackId) return social.fail(new Error('Escolha uma música no player ou na atividade do amigo.'));
    await run(async () => {
      if (social.session?.status === 'active') await social.leaveSession();
      const value = await social.request('/listen', 'POST', { userId: target.id, trackId }); social.applySession({ ...value.session, revision: 1, status: 'pending' });
    });
  }
  const filter = item => `${item.displayName || ''} ${item.username || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().replace(/^@/,''));
  const rank = { online: 0, busy: 1, away: 2, offline: 3 };
  const friends = social.state.friends.filter(filter).sort((a,b) => {
    const pa = social.state.presence[a.id], pb = social.state.presence[b.id];
    return (sort === 'presence' ? (rank[pa?.status] ?? 3) - (rank[pb?.status] ?? 3) : sort === 'activity' ? Number(Boolean(pb?.activity?.playing)) - Number(Boolean(pa?.activity?.playing)) : 0) || a.displayName.localeCompare(b.displayName, 'pt-BR');
  });
  const filteredConversations = social.state.conversations.filter(c => Boolean(c.archived) === showArchived && (filter(social.state.friends.find(f => f.id === c.peerId) || {}) || c.preview.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a,b) => b.updatedAt - a.updatedAt);
  function friendRow(person, { requestType, searchResult = false, blocked = false } = {}) {
    const p = social.state.presence[person.id], c = social.state.conversations.find(c => c.peerId === person.id);
    const isFriend = social.state.friends.some(f => f.id === person.id), pending = social.state.outgoing.some(f => f.id === person.id), incoming = social.state.incoming.some(f => f.id === person.id);
    return <div className={`social-contact ${friend?.id === person.id ? 'selected' : ''}`} key={person.id}>
      <button className="social-contact-main" onClick={() => isFriend ? open(person) : showProfile(person)}><Avatar person={person} presence={isFriend ? p || { status: 'offline' } : null}/><span><strong>{person.displayName}</strong><small>{requestType === 'incoming' ? 'Quer ser seu amigo' : requestType === 'outgoing' ? 'Solicitação enviada' : p?.activity ? `${p.activity.playing ? '♫ Ouvindo' : 'Ⅱ Pausado'}: ${p.activity.track.title}` : p?.statusText || (isFriend ? p?.status === 'online' ? 'Navegando no Consona' : statusLabel(p) : `@${person.username}`)}</small></span></button>
      {requestType === 'incoming' ? <div className="social-contact-buttons"><button className="social-accept" disabled={busy} aria-label={`Aceitar ${person.displayName}`} onClick={() => run(() => mutate(`/requests/${person.id}`, 'POST', { action: 'accept' }))}><Check size={16}/></button><button className="social-decline" disabled={busy} aria-label={`Recusar ${person.displayName}`} onClick={() => run(() => mutate(`/requests/${person.id}`, 'POST', { action: 'decline' }))}><X size={16}/></button></div> : requestType === 'outgoing' ? <button disabled={busy} onClick={() => run(() => mutate(`/requests/${person.id}`, 'POST', { action: 'cancel' }))}>Cancelar</button> : blocked ? <button disabled={busy} onClick={() => run(() => mutate(`/blocks/${person.id}`, 'DELETE'))}>Desbloquear</button> : searchResult && !isFriend ? <button aria-label={`Adicionar ${person.displayName}`} disabled={busy || pending || incoming} onClick={() => run(() => mutate(`/friends/${person.id}`))}>{pending ? 'Enviada' : incoming ? 'Pendente' : <UserPlus size={18}/>}</button> : <>{c?.unread > 0 && <b className="social-badge">{c.unread}</b>}{p?.activity && <button aria-label={`Ouvir o que ${person.displayName} está ouvindo`} onClick={() => onPlay('track', p.activity.track.id)}><Headphones size={18}/></button>}</>}
    </div>;
  }
  function contactList() {
    return <>
      <div className="social-search"><Search size={18}/><input value={query} onChange={e => setQuery(e.target.value)} aria-label="Buscar amigos e conversas" placeholder={view === 'friends' ? 'Nome ou @username...' : 'Buscar conversas...'}/>{query && <button onClick={() => setQuery('')} aria-label="Limpar busca"><X size={15}/></button>}<button title="Adicionar amigos" aria-label="Adicionar amigos" onClick={() => { setView('friends'); setQuery(''); }}><UserPlus size={19}/></button></div>
      <div className="social-mini-tabs"><button className={view === 'friends' ? 'active' : ''} onClick={() => setView('friends')}>Amigos ({social.state.friends.length})</button><button className={view === 'conversations' ? 'active' : ''} onClick={() => setView('conversations')}>Conversas {unread > 0 && <b className="social-badge">{unread}</b>}</button></div>
      <div className="social-contact-list">
        {social.loading ? <p className="social-empty-small">Conectando aos seus amigos...</p> : view === 'friends' ? <>
          <label className="social-sort">Ordenar<select value={sort} onChange={e => setSort(e.target.value)}><option value="presence">Presença</option><option value="name">Nome</option><option value="activity">Atividade musical</option></select></label>
          {['online','away','offline'].map(group => {
            const rows = friends.filter(f => { const status = social.state.presence[f.id]?.status || 'offline'; return group === 'online' ? ['online','busy'].includes(status) : status === group; });
            return rows.length ? <details open key={group} className="social-group"><summary>{{ online:'Online',away:'Ausentes',offline:'Offline' }[group]} ({rows.length})<ChevronDown size={14}/></summary>{rows.map(p => friendRow(p))}</details> : null;
          })}
          {!friends.length && <p className="social-empty-small">{query ? 'Nenhum amigo encontrado.' : 'Encontre seus amigos pelo nome ou @username.'}</p>}
          {query.replace(/^@/,'').length >= 2 && <div className="social-discovery"><h4>Encontrar pessoas</h4>{searchBusy ? <p>Buscando...</p> : users.length ? users.map(p => friendRow(p, { searchResult: true })) : <p>Nenhum usuário encontrado.</p>}</div>}
        </> : <>
          <label className="social-archive-toggle"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}/>Mostrar arquivadas</label>
          {filteredConversations.map(c => { const f = social.state.friends.find(f => f.id === c.peerId); if (!f) return null; return <button key={c.id} className={`social-conversation ${selected === c.id ? 'selected' : ''}`} onClick={() => chooseConversation(c)}><Avatar person={f} presence={social.state.presence[f.id] || { status:'offline' }}/><span><strong>{f.displayName}</strong><small>{c.preview}</small></span><span className="social-conversation-end"><time>{new Date(c.updatedAt).toLocaleDateString() === new Date().toLocaleDateString() ? new Date(c.updatedAt).toLocaleTimeString('pt-BR', { hour:'2-digit',minute:'2-digit' }) : new Date(c.updatedAt).toLocaleDateString('pt-BR', { day:'2-digit',month:'2-digit' })}</time>{c.unread > 0 && <b className="social-badge">{c.unread}</b>}{c.muted && <BellOff size={12}/>}</span></button>; })}
          {!filteredConversations.length && <div className="social-empty-small"><MessageCircle size={32}/><p>{showArchived ? 'Nenhuma conversa arquivada.' : 'Suas conversas aparecerão aqui.'}</p><button className="social-primary" onClick={() => setView('friends')}>Encontrar amigos</button></div>}
        </>}
      </div>
      {requests > 0 && <button className="social-requests-shortcut" onClick={() => { setView('requests'); onExpand(); }}><UserPlus size={17}/>{requests} solicitaç{requests === 1 ? 'ão' : 'ões'} de amizade <ChevronDown size={14}/></button>}
    </>;
  }
  function musicCard(person, activity) {
    if (!activity) return <p className="social-empty-small">Nenhuma atividade compartilhada agora.</p>;
    const track = activity.track;
    return <div className="social-activity-card"><div><span className="social-cover">{track.cover ? <img src={track.cover} alt="" loading="lazy"/> : <Music2 size={30}/>}</span><span><small className={activity.playing ? 'social-listening' : ''}>{activity.playing ? 'Ouvindo agora' : 'Pausado'}</small><strong>{track.title}</strong><small>{track.artist}</small></span>{activity.playing && <span className="social-equalizer" aria-label="Reproduzindo"><i/><i/><i/><i/></span>}</div><small>{track.album}</small><div className="social-activity-actions"><button onClick={() => onPlay('track', track.id)}><Play size={14}/>Ouvir</button><button onClick={() => invite(person, track.id)} disabled={busy}><Headphones size={15}/>Ouvir junto</button></div><button className="social-text-link" onClick={() => onOpenAlbum(track.id)}>Abrir álbum</button></div>;
  }
  function profilePanel() {
    return <aside className="social-profile-panel">{friend ? <>
      <div className="social-profile-heading"><Avatar person={friend} size="large" presence={presence}/><div><h2>{friend.displayName}</h2><small><i className={`social-dot ${presence.status}`}/>{statusLabel(presence)}</small></div></div>
      {presence.lastSeen && presence.status === 'offline' && <small>Última atividade: {new Date(presence.lastSeen).toLocaleString('pt-BR')}</small>}
      {presence.statusText && <p>{presence.statusText}</p>}
      <h3>Atividade musical</h3>{musicCard(friend, presence.activity)}
      <h3>Informações</h3><dl><dt>Usuário</dt><dd>@{friend.username}</dd><dt>Membro desde</dt><dd>{new Date(friend.joinedAt).toLocaleDateString('pt-BR')}</dd><dt>Playlists públicas</dt><dd>{library.playlists.filter(p => p.addedBy?.id === friend.id).length}</dd></dl>
      <h3>Amizade</h3><button disabled={profileBusy} onClick={() => showProfile()}><Users size={17}/>Ver perfil</button>
      <button onClick={() => invite(friend, player.current?.id)}><Headphones size={17}/>Convidar para ouvir comigo</button>
      <button onClick={() => { if (window.confirm(`Remover ${friend.displayName} dos seus amigos?`)) run(() => mutate(`/friends/${friend.id}`, 'DELETE')); }}><UserMinus size={17}/>Remover amigo</button>
      <button onClick={() => { if (window.confirm(`Bloquear ${friend.displayName}? A amizade e as sessões serão encerradas.`)) run(() => mutate(`/blocks/${friend.id}`)); }}><Shield size={17}/>Bloquear usuário</button>
      <button className="social-text-link" onClick={() => reportUser(friend)}>Denunciar usuário</button>
    </> : <div className="social-empty-small"><Headphones size={42}/><h3>Música aproxima</h3><p>Veja o que seus amigos estão ouvindo e descubra algo novo juntos.</p></div>}</aside>;
  }
  const chat = <ChatPane user={user} social={social} conversation={conversation} friend={friend} library={library} apiBase={apiBase} onPlay={onPlay} onFavorite={onFavorite} onBack={() => setChatVisible(false)} onMarkUnread={() => { setChatVisible(false); setSelected(''); }} onExpand={!expanded ? onExpand : null} onProfile={() => showProfile()} onCall={video => friend && calls.start(friend, video)} onReport={reportUser} drafts={drafts} setDrafts={setDrafts} scrolls={scrolls} currentTrack={player.current} expanded={expanded} jumpMessage={jumpMessage} clearJump={() => setJumpMessage('')}/>;
  const sessionBar = social.session && social.session.status !== 'ended' && <div className="social-session"><Headphones size={18}/><span>{social.session.status === 'pending' ? 'Convite enviado · aguardando aceitação' : `Ouvindo junto · ${social.session.hostId === user.id ? 'você é o anfitrião' : social.session.guestCanControl ? 'controle compartilhado' : 'o amigo controla a reprodução'}`}</span>{social.session.status === 'active' && <><label>Fila <select aria-label="Música para fila compartilhada" value={sessionTrack} onChange={e => setSessionTrack(e.target.value)}><option value="">Escolher música</option>{library.tracks.map(track => <option key={track.id} value={track.id}>{track.title} — {track.artist}</option>)}</select></label><button disabled={!sessionTrack || busy} onClick={() => run(async () => { const value=await social.request(`/listen/${social.session.id}/queue`,'POST',{trackId:sessionTrack}); social.applySession(value.session); setSessionTrack(''); })}>Adicionar</button><span>{(social.session.queue || []).length} na fila</span>{(social.session.hostId === user.id || social.session.guestCanControl) && <button disabled={!social.session.queue?.length} onClick={() => run(async () => { const value=await social.request(`/listen/${social.session.id}/next`,'POST'); social.applySession(value.session); })}>Próxima da fila</button>}</>}{social.session.status === 'active' && social.session.hostId === user.id && <label><input type="checkbox" checked={social.session.guestCanControl} onChange={e => social.sendEvent({ type:'listen_control',sessionId:social.session.id,action:'permissions',guestCanControl:e.target.checked })}/>Permitir controle do amigo</label>}<button onClick={() => run(social.leaveSession)}>Sair</button></div>;
  return <div className={`social-root ${expanded ? 'social-expanded' : 'social-overlay'}`}>
    {expanded ? <main className={`social-central social-surface ${chatVisible ? 'social-chat-visible' : ''}`}>
      <header className="social-central-title social-gloss"><Users size={30}/><h1>Amigos e Conversas</h1><span className={`social-connection ${social.connection}`}>{social.connection === 'online' ? 'Conectado' : social.connection === 'connecting' ? 'Conectando...' : 'Reconectando...'}</span><button aria-label="Notificações sociais" onClick={() => setNotifications(true)}><Bell size={21}/>{social.state.notificationCount > 0 && <b className="social-badge">{social.state.notificationCount}</b>}</button><button title="Modo flutuante" aria-label="Modo flutuante" onClick={() => { setMode('floating'); onCollapse(); }}><Minimize2 size={21}/></button></header>
      {sessionBar}
      <div className="social-central-body"><nav className="social-navigation" aria-label="Navegação social">{sections.map(([key,label,Icon]) => <button key={key} aria-label={label} className={view === key ? 'active' : ''} onClick={() => { setView(key); setQuery(''); if (!['friends','conversations'].includes(key)) setChatVisible(false); }}><Icon size={23}/><span>{label}</span>{key === 'friends' ? <b className="social-badge">{social.state.friends.length}</b> : key === 'requests' && requests > 0 ? <b className="social-badge">{requests}</b> : null}</button>)}<div className="social-self"><Avatar person={user}/><strong>{user.displayName}</strong><small>@{user.username}</small><button onClick={() => setView('settings')}>{social.state.settings.presence === 'invisible' ? 'Invisível' : statusLabel({ status:social.state.settings.presence })}<ChevronDown size={12}/></button></div></nav>
        {['friends','conversations'].includes(view) ? <><aside className="social-contacts">{contactList()}</aside>{chat}{profilePanel()}</> : <section className="social-content">
          {view === 'groups' && <GroupPane social={social} user={user}/>}
          {view === 'requests' && <><h2>Solicitações de amizade</h2><p>Uma nova conversa pode começar aqui.</p><h3>Recebidas ({requests})</h3>{social.state.incoming.map(p => friendRow(p, { requestType:'incoming' }))}{!requests && <p className="social-empty-small">Nenhuma solicitação pendente.</p>}<h3>Enviadas ({social.state.outgoing.length})</h3>{social.state.outgoing.map(p => friendRow(p, { requestType:'outgoing' }))}</>}
          {view === 'blocked' && <><h2>Usuários bloqueados</h2><p>Desbloquear não restaura a amizade automaticamente.</p>{social.state.blocked.map(p => friendRow(p, { blocked:true }))}{!social.state.blocked.length && <p className="social-empty-small">Você não bloqueou ninguém.</p>}</>}
          {view === 'settings' && <Privacy social={social}/>}
          {view === 'activity' && <><h2>Amigos ouvindo agora</h2><p>Descobertas musicais, em boa companhia.</p>{!social.state.settings.show_activity && <div className="social-opt-in"><Music2 size={25}/><span>Compartilhe também o que você está ouvindo.</span><button className="social-primary" onClick={() => social.updateSettings({ show_activity:true }).catch(social.fail)}>Mostrar minha atividade</button></div>}<div className="social-activity-grid">{social.state.friends.filter(f => social.state.presence[f.id]?.activity).map(f => <article key={f.id}><button className="social-person-heading" onClick={() => open(f)}><Avatar person={f} presence={social.state.presence[f.id]}/><strong>{f.displayName}</strong></button>{musicCard(f, social.state.presence[f.id].activity)}</article>)}</div>{!social.state.friends.some(f => social.state.presence[f.id]?.activity) && <div className="social-empty-small"><Headphones size={48}/><h3>Seu próximo som pode vir de um amigo</h3><p>Quando seus amigos compartilharem a atividade musical, ela aparecerá aqui.</p></div>}</>}
        </section>}
      </div>
    </main> : <>
      {mode === 'floating' && <FloatingWindow name="friends" userId={user.id} title="Amigos" className={chatVisible && conversation ? 'social-friends-float social-mobile-hidden' : 'social-friends-float'} onMinimize={() => setMode('minimized')} onClose={() => setMode('closed')} onExpand={onExpand}>{contactList()}<footer><button onClick={onExpand}><Maximize2 size={15}/>Abrir em tela cheia</button><button aria-label="Notificações sociais" onClick={() => setNotifications(true)}><Bell size={17}/>{social.state.notificationCount > 0 && <b className="social-badge">{social.state.notificationCount}</b>}</button></footer></FloatingWindow>}
      {mode === 'floating' && chatVisible && conversation && <FloatingWindow name="chat" userId={user.id} title={friend?.displayName || 'Conversa'} className="social-chat-float" onMinimize={() => setChatVisible(false)} onClose={() => setChatVisible(false)} onExpand={onExpand}>{sessionBar}{chat}</FloatingWindow>}
      {mode !== 'floating' && <button className={`social-launcher ${unread ? 'has-unread' : ''}`} onClick={() => { setMode('floating'); setView('friends'); }} aria-label={`Abrir amigos e mensagens${unread ? `, ${unread} não lidas` : ''}`}><Users size={22}/><span>Amigos</span>{unread + requests > 0 && <b className="social-badge">{unread + requests}</b>}<ChevronDown size={15}/></button>}
      {mode !== 'floating' && sessionBar && <div className="social-session-floating">{sessionBar}</div>}
    </>}
    {social.error && <div className="social-error" role="alert"><span>{social.error}</span><button aria-label="Fechar aviso" onClick={() => social.setError('')}><X size={18}/></button></div>}
    {notifications && <Modal title="Notificações" onClose={() => setNotifications(false)}><button className="social-primary" onClick={() => run(() => mutate('/notifications/read', 'POST', {}))}>Marcar todas como lidas</button>{social.state.notifications.map(n => <article className={`social-notification ${!n.readAt ? 'unread' : ''}`} key={n.id}><Bell size={19}/><div><strong>{n.payload.displayName || 'Consona'}</strong><p>{{ friend_request:'Enviou uma solicitação de amizade.',friend_accepted:'Aceitou sua solicitação de amizade.',listening_invite:'Convidou você para ouvir junto.',message:'Enviou uma mensagem.' }[n.kind] || 'Nova atividade'}</p><small>{new Date(n.createdAt).toLocaleString('pt-BR')}</small>{n.kind === 'listening_invite' && n.payload.expiresAt > Date.now() && !n.readAt && <div className="social-inline-actions"><button disabled={busy} onClick={() => run(async () => { if (social.session?.status === 'active') await social.leaveSession(); const value = await social.request(`/listen/${n.payload.id}`, 'POST'); social.applySession(value.session); await mutate('/notifications/read','POST',{id:n.id}); setNotifications(false); })}><Headphones size={15}/>Aceitar e ouvir junto</button><button onClick={() => run(async () => { await social.request(`/listen/${n.payload.id}`, 'DELETE'); await mutate('/notifications/read','POST',{id:n.id}); })}>Recusar</button></div>}{n.kind === 'friend_request' && <button onClick={() => { setNotifications(false); setView('requests'); onExpand(); }}>Ver solicitação</button>}{n.kind === 'message' && <button onClick={() => { setSelected(n.payload.conversationId); setChatVisible(true); setView('conversations'); setNotifications(false); onExpand(); }}>Abrir conversa</button>}</div></article>)}{!social.state.notifications.length && <p>Você está em dia. Nenhuma notificação.</p>}</Modal>}
    {profile && <Modal title={`Perfil de ${profile.displayName}`} onClose={() => setProfile(null)}><div className="social-public-profile"><Avatar person={profile} size="large"/><div><h2>{profile.displayName}</h2><p>@{profile.username}</p><small>Membro desde {new Date(profile.joinedAt).toLocaleDateString('pt-BR')}</small></div></div>{profile.isFriend && <div className="social-inline-actions"><button onClick={() => { open(profile); setProfile(null); }}><MessageCircle size={16}/>Conversar</button><button onClick={() => invite(profile, social.state.presence[profile.id]?.activity?.track.id || player.current?.id)}><Headphones size={16}/>Ouvir junto</button></div>}<h3>Playlists públicas ({profile.playlists.length})</h3>{profile.playlists.map(p => <button className="social-profile-playlist" key={p.id} onClick={() => onPlay('playlist',p.id)}><Music2 size={20}/>{p.name}<Play size={16}/></button>)}{!profile.playlists.length && <p>Nenhuma playlist pública disponível.</p>}{profile.recent?.length > 0 && <><h3>Atividade recente compartilhada</h3>{profile.recent.map((item,i) => <button className="social-profile-playlist" key={`${item.track.id}:${i}`} onClick={() => onPlay('track',item.track.id)}><Music2 size={18}/><span>{item.track.title}<small>{item.track.artist}</small></span><Play size={16}/></button>)}</>}<button className="social-text-link" onClick={() => { reportUser(profile); setProfile(null); }}>Denunciar usuário</button></Modal>}
    {report && <Modal title="Denunciar usuário ou conteúdo" onClose={() => setReport(null)}><form onSubmit={e => { e.preventDefault(); run(async () => { await social.request('/reports','POST',{userId:report.user.id,messageId:report.messageId,reason}); setReport(null); social.setError('Denúncia registrada para análise.'); }); }}><p>Denúncia sobre <strong>{report.user.displayName}</strong>{report.messageId ? ' e esta mensagem' : ''}.</p><label>Descreva o ocorrido<textarea autoFocus required minLength={8} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)}/></label><button className="social-primary" disabled={busy || reason.trim().length < 8}>Enviar denúncia</button></form></Modal>}
    <CallPanel calls={calls}/>
  </div>;
}
