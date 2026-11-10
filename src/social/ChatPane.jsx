import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
const EmojiPicker = React.lazy(() => import('emoji-picker-react'));
import { ArrowLeft, Check, CheckCheck, Download, Edit3, FileText, Headphones, Maximize2, MessageCircle, MoreHorizontal, Music2, Paperclip, Phone, Play, Search, Send, Smile, Trash2, Video, X } from 'lucide-react';
import { readLocal, saveLocal, socialPath } from './useSocial.js';

export const statusLabel = value => ({ online: 'Online', away: 'Ausente', busy: 'Ocupado', offline: 'Offline' }[value?.status] || 'Offline');
export function Avatar({ person, size = '', presence }) {
  return <span className={`social-avatar ${size}`}>
    {person?.avatar ? <img src={person.avatar} alt="" loading="lazy"/> : <span>{(person?.displayName || person?.username || '?').slice(0, 1).toLocaleUpperCase()}</span>}
    {presence && <i className={`social-dot ${presence.status || 'offline'}`} aria-label={statusLabel(presence)}/>}
  </span>;
}
export function SafeText({ text = '' }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={value => /^https?:\/\//i.test(value) ? value : ''} components={{ a: ({children, href}) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>, img: ({alt}) => <span>{alt}</span> }}>{text}</ReactMarkdown>;
}
function MediaPicker({ social, user, onSelect }) {
  const [tab, setTab] = useState('7tv'), [query, setQuery] = useState(''), [items, setItems] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const key = `consona-media-favorites:${user.id}`;
  const [favorites, setFavorites] = useState(() => readLocal(key, []));
  useEffect(() => {
    if (tab === 'favorites') { setItems(favorites); return; }
    let active = true; const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try { const value = await social.request(`/media/search?provider=${tab}&q=${encodeURIComponent(query)}`); if (active) setItems(value.items); }
      catch (e) { if (active) { setItems([]); setError(e.message); } }
      finally { if (active) setLoading(false); }
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [tab, query, favorites]);
  function favorite(item) { const exists = favorites.some(x => x.provider === item.provider && x.id === item.id); const next = exists ? favorites.filter(x => x.provider !== item.provider || x.id !== item.id) : [item, ...favorites].slice(0,100); setFavorites(next); saveLocal(key, next); }
  return <div className="social-media-picker"><nav>{[['7tv','7TV'],['gif','GIFs'],['sticker','Stickers'],['favorites','Favoritos']].map(([value,label]) => <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</nav>
    {tab !== 'favorites' && <input aria-label="Buscar mídia" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar mídia..."/>}
    {loading && <p>Carregando...</p>}{error && <p role="status">{error}</p>}
    <div className="social-media-grid">{items.map(item => <span key={`${item.provider}:${item.id}`}><button type="button" onClick={() => onSelect(item)} title={item.name}><img loading="lazy" src={item.url} alt={item.name}/></button><button type="button" aria-label={`Favoritar ${item.name}`} onClick={() => favorite(item)}>{favorites.some(x => x.provider === item.provider && x.id === item.id) ? '★' : '☆'}</button></span>)}</div>
    {(tab === 'gif' || tab === 'sticker') && <small>GIFs e stickers por KLIPY</small>}
  </div>;
}
function Attachment({ payload, apiBase, fail }) {
  const [url, setUrl] = useState(''), [busy, setBusy] = useState(false);
  const object = useRef('');
  useEffect(() => () => { if (object.current) URL.revokeObjectURL(object.current); }, [payload.id]);
  async function download() {
    if (url) return;
    setBusy(true);
    try {
      const response = await fetch(`${apiBase}/api/social/attachments/${payload.id}`, { headers: { Authorization: `Bearer ${sessionStorage.getItem('consona-session') || ''}` } });
      if (!response.ok) throw new Error('Não foi possível abrir o anexo.');
      object.current = URL.createObjectURL(await response.blob()); setUrl(object.current);
    } catch (error) { fail(error); } finally { setBusy(false); }
  }
  return <div className="social-attachment">
    <FileText size={26}/><span><strong>{payload.name}</strong><small>{Math.ceil((payload.size || 0) / 1024)} KB</small></span>
    {url ? <a href={url} download={payload.name} aria-label="Baixar arquivo"><Download size={18}/></a> : <button onClick={download} disabled={busy} aria-label="Carregar anexo"><Download size={18}/></button>}
    {url && payload.mime?.startsWith('image/') && <img className="social-attachment-preview" src={url} alt={payload.name}/>}
  </div>;
}
export function SharedCard({ payload, library, onPlay, onFavorite }) {
  const list = payload.kind === 'track' ? library.tracks : payload.kind === 'album' ? library.albums : library.playlists;
  const item = list.find(item => item.id === payload.id);
  const cover = item?.cover || (item?.trackIds && library.tracks.find(t => item.trackIds.includes(t.id) && t.cover)?.cover);
  return <div className="social-shared-card">
    <span className="social-cover">{cover ? <img src={cover} alt="" loading="lazy"/> : <Music2 size={32}/>}</span>
    <div><small>{{ track: 'Música compartilhada', album: 'Álbum compartilhado', playlist: 'Playlist compartilhada' }[payload.kind]}</small><strong>{payload.title}</strong><small>{payload.artist || (item?.trackIds ? `${item.trackIds.length} músicas` : '')}</small></div>
    <button className="social-play" onClick={() => onPlay(payload.kind, payload.id)} disabled={!item} aria-label={`Ouvir ${payload.title}`}><Play size={18} fill="currentColor"/></button>
    {payload.kind === 'track' && item && <button type="button" aria-pressed={library.favorites.includes(item.id)} onClick={() => onFavorite(item.id)}>{library.favorites.includes(item.id) ? 'Remover dos favoritos' : 'Salvar nos favoritos'}</button>}
    {!item && <small>Este item não está mais disponível.</small>}
  </div>;
}

export default function ChatPane({ user, social, conversation, friend, library, apiBase, onPlay, onFavorite, onBack, onMarkUnread, onExpand, onProfile, onCall, onReport, drafts, setDrafts, scrolls, currentTrack, expanded, jumpMessage, clearJump }) {
  const id = conversation?.id, rows = social.messages[id] || [], page = social.pages[id];
  const presence = social.state.presence[friend?.id];
  const scroller = useRef(null), input = useRef(null), picker = useRef(null), bottom = useRef(true), loadingOlder = useRef(false);
  const lastTyping = useRef(0), restore = useRef(null), lastMessage = useRef(null);
  const [search, setSearch] = useState(''), [found, setFound] = useState(null), [searching, setSearching] = useState(false);
  const [searchSender, setSearchSender] = useState(''), [searchKind, setSearchKind] = useState(''), [searchDate, setSearchDate] = useState('');
  const [emoji, setEmoji] = useState(false), [sharing, setSharing] = useState(false), [shareQuery, setShareQuery] = useState('');
  const [media, setMedia] = useState(false);
  const [forward, setForward] = useState(null);
  const [edit, setEdit] = useState(null), [editText, setEditText] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [reply, setReply] = useState(null), [features, setFeatures] = useState({ reactions: [], marks: [] });
  const [preview, setPreview] = useState(false);
  const [viewMarks, setViewMarks] = useState('');
  async function refreshFeatures() { if (id) try { setFeatures(await social.request(`/conversations/${socialPath(id)}/features`)); } catch (error) { social.fail(error); } }
  useEffect(() => { setReply(null); setViewMarks(''); refreshFeatures(); const listener = e => { if (e.detail === id) refreshFeatures(); }; window.addEventListener('consona-message-features', listener); return () => window.removeEventListener('consona-message-features', listener); }, [id]);
  async function toggleFeature(m, kind, emoji) { const existing = kind === 'reaction' ? features.reactions.some(r => r.message_id === m.id && r.user_id === user.id && r.emoji === emoji) : features.marks.some(r => r.message_id === m.id && r.user_id === user.id && r.kind === kind); try { await social.request(`/messages/${m.id}/${kind}`, existing ? 'DELETE' : 'PUT', kind === 'reaction' ? { emoji } : {}); await refreshFeatures(); } catch (error) { social.fail(error); } }
  async function jumpTo(messageId) {
    try {
      const result = await social.request(`/messages/${socialPath(messageId)}/location`);
      if (result.conversationId !== id) throw new Error('Mensagem pertence a outra conversa.');
      bottom.current = false; setFound(null); setSearch(''); setSearchSender(''); setSearchKind(''); setSearchDate(''); setViewMarks(''); social.receiveMessages(result.messages);
      setTimeout(() => document.getElementById(`social-message-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    } catch (error) { social.fail(error); }
  }
  useEffect(() => { if (id && jumpMessage) { jumpTo(jumpMessage); clearJump(); } }, [id, jumpMessage]);
  const draft = drafts[id] || '';
  const mentionMatch = draft.match(/(?:^|\s)@([\w.-]*)$/);
  const mentionSuggestions = mentionMatch ? social.state.friends.filter(person => person.username.toLowerCase().startsWith(mentionMatch[1].toLowerCase())).slice(0, 6) : [];
  useEffect(() => {
    if (!id) return;
    setSearch(''); setSearchSender(''); setSearchKind(''); setSearchDate(''); setFound(null); setSharing(false); setEdit(null); lastMessage.current = null;
    restore.current = scrolls.current[id]; bottom.current = restore.current == null;
    setLoading(true); social.loadMessages(id).catch(social.fail).finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { const timer = setInterval(() => setTick(t => t + 1), 1500); return () => clearInterval(timer); }, []);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || !id || !rows.length || loadingOlder.current) return;
    if (restore.current != null) { node.scrollTop = restore.current; restore.current = null; }
    else if (bottom.current || rows.at(-1)?.senderId === user.id && rows.at(-1)?.id !== lastMessage.current) node.scrollTop = node.scrollHeight;
    lastMessage.current = rows.at(-1)?.id;
    bottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
    if (bottom.current && !document.hidden && !found) social.receipt(id, rows.at(-1)?.seq, true);
  }, [id, rows, expanded, loading]);
  useEffect(() => {
    const visible = () => { if (!document.hidden && bottom.current && id) social.receipt(id, rows.at(-1)?.seq, true); };
    document.addEventListener('visibilitychange', visible); return () => document.removeEventListener('visibilitychange', visible);
  }, [id, rows]);
  useEffect(() => {
    if ((search.trim().length < 2 && !searchSender && !searchKind && !searchDate) || !id) { setFound(null); return; }
    let active = true;
    const timer = setTimeout(() => { setSearching(true); social.request(`/conversations/${socialPath(id)}/messages?${searchParams()}`).then(value => { if (active) setFound(value); }).catch(social.fail).finally(() => { if (active) setSearching(false); }); }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [search, searchSender, searchKind, searchDate, id]);
  function searchParams() { const params = new URLSearchParams(); if (search.trim().length >= 2) params.set('q', search.trim()); if (searchSender) params.set('sender', searchSender); if (searchKind) params.set('kind', searchKind); if (searchDate) params.set('since', String(new Date(`${searchDate}T00:00:00`).getTime())); return params.toString(); }
  function changeDraft(value) {
    setDrafts(d => ({ ...d, [id]: value }));
    if (Date.now() - lastTyping.current > 2500 || !value) {
      social.sendEvent({ type: 'typing', conversationId: id, peerId: friend.id, typing: Boolean(value) }); lastTyping.current = Date.now();
    }
  }
  async function submit(event) {
    event.preventDefault(); if (!draft.trim()) return;
    const text = draft.trim(); changeDraft(''); bottom.current = true;
    try { await social.send(id, { text, replyTo: reply?.id }); setReply(null); } catch (error) { social.fail(error); }
    input.current?.focus();
  }
  async function older() {
    setLoading(true); loadingOlder.current = true;
    const node = scroller.current, height = node.scrollHeight, top = node.scrollTop;
    try { await social.loadMessages(id, page.before); requestAnimationFrame(() => { node.scrollTop = top + node.scrollHeight - height; }); }
    catch (error) { social.fail(error); } finally { loadingOlder.current = false; setLoading(false); }
  }
  async function attachFile(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return social.fail(new Error('Anexos podem ter até 8 MB.'));
    setBusy(true);
    try { const form = new FormData(); form.set('file', file); const payload = await social.request(`/attachments?conversation=${socialPath(id)}`, 'POST', form); await social.send(id, { kind: 'attachment', attachmentId: payload.id, payload }); }
    catch (error) { social.fail(error); } finally { setBusy(false); }
  }
  function attach(event) { const file = event.target.files?.[0]; event.target.value = ''; attachFile(file); }
  async function editMessage(event) {
    event.preventDefault(); setBusy(true);
    try { const value = await social.request(`/messages/${edit.id}`, 'PUT', { text: editText }); social.receiveMessages([value.message]); setEdit(null); }
    catch (error) { social.fail(error); } finally { setBusy(false); }
  }
  async function forwardTo(person) {
    try {
      const destination = await social.openConversation(person.id);
      let data;
      if (forward.kind === 'attachment') {
        const response = await fetch(`${apiBase}/api/social/attachments/${forward.payload.id}`, { headers: { Authorization: `Bearer ${sessionStorage.getItem('consona-session') || ''}` } });
        if (!response.ok) throw new Error('Não foi possível abrir o anexo para encaminhamento.');
        const blob = await response.blob(), form = new FormData();
        form.set('file', new File([blob], forward.payload.name, { type: forward.payload.mime }));
        const uploaded = await social.request(`/attachments?conversation=${socialPath(destination)}`, 'POST', form);
        data = { kind: 'attachment', attachmentId: uploaded.id, payload: uploaded };
      } else data = forward.kind === 'text' ? { text: `↪ ${forward.text}` } : forward.kind === 'external_media' ? { kind: forward.kind, payload: forward.payload } : { kind: forward.kind, itemId: forward.payload.id, payload: forward.payload };
      await social.send(destination, data); setForward(null);
    } catch (error) { social.fail(error); }
  }
  if (!friend || !conversation) return <section className="social-chat social-chat-empty"><MessageCircle size={64}/><h2>Uma boa conversa começa aqui</h2><p>Escolha um amigo para conversar, compartilhar músicas e ouvir junto.</p><span>Seu player continua tocando.</span></section>;
  const shareItems = [...library.tracks.map(t => ({ ...t, kind: 'track' })), ...library.albums.map(t => ({ ...t, kind: 'album' })), ...library.playlists.map(t => ({ ...t, title: t.name, kind: 'playlist' }))].filter(t => `${t.title} ${t.artist || ''}`.toLocaleLowerCase().includes(shareQuery.toLocaleLowerCase())).slice(0, 25);
  return <section className="social-chat" aria-label={`Conversa com ${friend.displayName}`} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { if (e.dataTransfer.files?.length) { e.preventDefault(); attachFile(e.dataTransfer.files[0]); } }}>
    <header className="social-chat-head">
      <button className="social-mobile-back" aria-label="Voltar aos amigos" onClick={onBack}><ArrowLeft size={18}/></button>
      <button className="social-person-heading" onClick={onProfile}><Avatar person={friend} presence={presence}/><span><strong>{friend.displayName}</strong><small><i className={`social-dot ${presence?.status || 'offline'}`}/>{statusLabel(presence)}</small></span></button>
      <div className="social-chat-actions"><button aria-label="Chamada de voz" title="Chamada de voz" onClick={() => onCall(false)}><Phone size={18}/></button><button aria-label="Chamada de vídeo" title="Chamada de vídeo" onClick={() => onCall(true)}><Video size={19}/></button>{onExpand && <button aria-label="Abrir em tela cheia" onClick={onExpand}><Maximize2 size={18}/></button>}
        <details className="social-menu"><summary aria-label="Opções da conversa"><MoreHorizontal size={20}/></summary><div><button onClick={() => social.markUnread(id).then(onMarkUnread).catch(social.fail)}>Marcar como não lida</button><button onClick={() => social.request(`/conversations/${socialPath(id)}`, 'PUT', { muted: !conversation.muted }).then(social.refresh).catch(social.fail)}>{conversation.muted ? 'Ativar notificações' : 'Silenciar conversa'}</button><button onClick={() => social.request(`/conversations/${socialPath(id)}`, 'PUT', { archived: !conversation.archived }).then(social.refresh).catch(social.fail)}>{conversation.archived ? 'Desarquivar' : 'Arquivar conversa'}</button><button onClick={() => onReport(friend)}>Denunciar usuário</button></div></details>
      </div>
    </header>
    <div className="social-message-search"><button onClick={() => setViewMarks(viewMarks === 'pin' ? '' : 'pin')}>Fixadas</button><button onClick={() => setViewMarks(viewMarks === 'favorite' ? '' : 'favorite')}>Favoritas</button><Search size={14}/><input aria-label="Pesquisar mensagens" value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar nesta conversa..."/>{search && <button onClick={() => setSearch('')} aria-label="Limpar pesquisa"><X size={14}/></button>}</div>
    <details className="social-search-filters"><summary>Filtros de busca</summary><label>Autor <select value={searchSender} onChange={e => setSearchSender(e.target.value)}><option value="">Todos</option><option value="me">Eu</option><option value="other">Amigo</option></select></label><label>Tipo <select value={searchKind} onChange={e => setSearchKind(e.target.value)}><option value="">Todos</option><option value="text">Texto</option><option value="track">Música</option><option value="album">Álbum</option><option value="playlist">Playlist</option><option value="attachment">Anexo</option><option value="external_media">Mídia</option></select></label><label>A partir de <input type="date" value={searchDate} onChange={e => setSearchDate(e.target.value)}/></label></details>
    <div className="social-messages" ref={scroller} role="log" aria-label="Mensagens" aria-live="polite" onScroll={event => {
      const node = event.currentTarget; scrolls.current[id] = node.scrollTop; saveLocal(`consona-scroll:${user.id}`, scrolls.current);
      bottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
      if (node.scrollTop < 40 && page?.hasMore && !loading && !loadingOlder.current && !found) older();
      if (bottom.current && !document.hidden && !found) social.receipt(id, rows.at(-1)?.seq, true);
    }}>
      {!found && page?.hasMore && <button className="social-load-more" disabled={loading} onClick={older}>{loading ? 'Carregando...' : 'Carregar mensagens anteriores'}</button>}
      {searching && <p className="social-empty-small">Pesquisando...</p>}
      {(found?.messages || rows).filter(m => !viewMarks || features.marks.some(x => x.message_id === m.id && x.kind === viewMarks)).map(m => <div id={`social-message-${m.id}`} className={`social-message-row ${m.senderId === user.id ? 'mine' : ''}`} key={m.id}>
        <Avatar person={m.senderId === user.id ? user : friend}/>
        <div className={`social-bubble ${m.failed ? 'failed' : ''}`}>
          {m.deletedAt ? <em>Mensagem excluída</em> : <>
            {m.replyTo && <button className="social-reply-context" onClick={() => jumpTo(m.replyTo)}>↪ {rows.find(x => x.id === m.replyTo)?.text || 'Abrir mensagem respondida'}</button>}
            {m.text && <div className="social-markdown"><SafeText text={m.text}/></div>}
            {['track','album','playlist'].includes(m.kind) && <SharedCard payload={m.payload} library={library} onPlay={onPlay} onFavorite={onFavorite}/>}
            {m.kind === 'attachment' && <Attachment payload={m.payload} apiBase={apiBase} fail={social.fail}/>}
            {m.kind === 'external_media' && <img className="social-external-media" loading="lazy" src={m.payload.url} alt={m.payload.name || 'Mídia compartilhada'} referrerPolicy="no-referrer"/>}
          </>}
          <div className="social-reactions">{[...new Set(features.reactions.filter(r => r.message_id === m.id).map(r => r.emoji))].map(value => <button key={value} onClick={() => toggleFeature(m,'reaction',value)} aria-label={`Reagir com ${value}`}>{value} {features.reactions.filter(r => r.message_id === m.id && r.emoji === value).length}</button>)}</div>
          <footer><time dateTime={new Date(m.createdAt).toISOString()} title={new Date(m.createdAt).toLocaleString('pt-BR')}>{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>{m.editedAt && <small>editada</small>}{m.senderId === user.id && <span title={m.failed ? 'Falha no envio' : m.pending ? 'Enviando' : conversation.peerReadSeq >= m.seq ? 'Lida' : conversation.peerDeliveredSeq >= m.seq ? 'Entregue' : 'Enviada'} className={conversation.peerReadSeq >= m.seq ? 'read' : ''}>{m.pending ? '…' : conversation.peerDeliveredSeq >= m.seq ? <CheckCheck size={14}/> : <Check size={14}/>}</span>}</footer>
          {m.failed && <button onClick={() => social.send(id, m.retryData, m.clientId).catch(social.fail)}>Tentar enviar novamente</button>}
          {!m.pending && !m.failed && !m.deletedAt && <details className="social-message-options"><summary aria-label="Opções da mensagem"><MoreHorizontal size={14}/></summary><div><button onClick={() => { setReply(m); input.current?.focus(); }}>Responder</button><button onClick={() => setForward(m)}>Encaminhar</button><button onClick={() => toggleFeature(m,'reaction','❤️')}>Reagir ❤️</button><button onClick={() => toggleFeature(m,'reaction','👍')}>Reagir 👍</button><button onClick={() => toggleFeature(m,'pin')}>Fixar / desfixar</button><button onClick={() => toggleFeature(m,'favorite')}>Favoritar / remover</button><button onClick={() => navigator.clipboard.writeText(m.text).catch(social.fail)}>Copiar texto</button><button onClick={() => { const url = new URL(window.location.href); url.searchParams.set('socialMessage',m.id); navigator.clipboard.writeText(url.href).catch(social.fail); }}>Copiar link</button>{m.senderId === user.id ? <><button onClick={() => { setEdit(m); setEditText(m.text); }}><Edit3 size={13}/>Editar</button><button onClick={() => { if (window.confirm('Excluir esta mensagem para os dois participantes?')) social.request(`/messages/${m.id}`, 'DELETE').then(v => social.receiveMessages([v.message])).catch(social.fail); }}><Trash2 size={13}/>Excluir</button></> : <button onClick={() => onReport(friend, m.id)}>Denunciar mensagem</button>}</div></details>}
        </div>
      </div>)}
      {found && !found.messages.length && <p className="social-empty-small">Nenhuma mensagem encontrada.</p>}
      {found?.hasMore && <button className="social-load-more" onClick={() => social.request(`/conversations/${socialPath(id)}/messages?${searchParams()}&before=${found.nextBefore}`).then(v => setFound({ ...v, messages: [...v.messages, ...found.messages] })).catch(social.fail)}>Mais resultados</button>}
      {!rows.length && !loading && !found && <p className="social-empty-small">Diga um oi para {friend.displayName} 🎵</p>}
    </div>
    <div className="social-typing" aria-live="polite">{social.typing[id] > Date.now() ? `${friend.displayName} está digitando…` : conversation.muted ? 'Notificações desta conversa silenciadas' : ' '}</div>
    {reply && <div className="social-reply-bar">Respondendo: {reply.text || 'Mídia compartilhada'} <button onClick={() => setReply(null)}>Cancelar</button></div>}
    {forward && <div className="social-share-picker"><header><strong>Encaminhar para</strong><button type="button" onClick={() => setForward(null)}>Fechar</button></header><div>{social.state.friends.map(person => <button key={person.id} type="button" onClick={() => forwardTo(person)}>{person.displayName}</button>)}</div></div>}
    {edit && <form className="social-edit" onSubmit={editMessage}><label>Editar mensagem<input autoFocus maxLength={4000} value={editText} onChange={e => setEditText(e.target.value)}/></label><button disabled={busy || !editText.trim()}>Salvar</button><button type="button" onClick={() => setEdit(null)}>Cancelar</button></form>}
    {sharing && <div className="social-share-picker"><header><strong>Compartilhar música</strong><button aria-label="Fechar compartilhamento" onClick={() => setSharing(false)}><X size={17}/></button></header><input autoFocus placeholder="Música, álbum ou playlist..." aria-label="Buscar item para compartilhar" value={shareQuery} onChange={e => setShareQuery(e.target.value)}/><div>{currentTrack && <button onClick={() => { setSharing(false); social.send(id, {kind:'track',itemId:currentTrack.id,payload:{id:currentTrack.id,kind:'track',title:currentTrack.title,artist:currentTrack.artist}}).catch(social.fail); }}><Headphones size={17}/><span>Compartilhar música atual<small>{currentTrack.title}</small></span></button>}{shareItems.map(item => <button key={`${item.kind}:${item.id}`} onClick={() => { setSharing(false); social.send(id, { kind: item.kind, itemId: item.id, payload: { id: item.id, kind: item.kind, title: item.title, artist: item.artist } }).catch(social.fail); }}><Music2 size={16}/><span>{item.title}<small>{item.artist || { track: 'Música', album: 'Álbum', playlist: 'Playlist' }[item.kind]}</small></span></button>)}</div></div>}
    {emoji && <div className="social-emojis" aria-label="Emojis"><React.Suspense fallback={<span>Carregando emojis...</span>}><EmojiPicker onEmojiClick={item => { changeDraft(draft + item.emoji); setEmoji(false); input.current?.focus(); }} searchPlaceHolder="Buscar emoji" width="100%" height={280}/></React.Suspense></div>}
    {media && <MediaPicker social={social} user={user} onSelect={item => { setMedia(false); social.send(id, { kind: 'external_media', payload: item }).catch(social.fail); }}/>} 
    {preview && <div className="social-edit social-markdown"><strong>Prévia</strong><SafeText text={draft}/></div>}
    {mentionSuggestions.length > 0 && <div className="social-edit" aria-label="Sugestões de menção">{mentionSuggestions.map(person => <button type="button" key={person.id} onClick={() => { changeDraft(draft.replace(/@([\w.-]*)$/, `@${person.username} `)); input.current?.focus(); }}>@{person.username}</button>)}</div>}
    <form className="social-composer" onSubmit={submit}>
      <button type="button" aria-label="Emojis" aria-expanded={emoji} onClick={() => setEmoji(!emoji)}><Smile size={23}/></button>
      <button type="button" aria-label="GIFs, stickers e 7TV" aria-expanded={media} onClick={() => setMedia(!media)}>GIF</button>
      <button type="button" aria-label="Prévia da formatação" aria-pressed={preview} onClick={() => setPreview(!preview)}>Aa</button>
      <textarea ref={input} rows={1} maxLength={4000} aria-label="Mensagem" placeholder="Digite uma mensagem..." value={draft} onChange={e => changeDraft(e.target.value)} onPaste={e => { const file=[...e.clipboardData.files].find(item=>item.type.startsWith('image/')); if (file) { e.preventDefault(); attachFile(file); } }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(e); } }}/>
      <input ref={picker} hidden type="file" accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,.txt" onChange={attach}/>
      <button type="button" aria-label="Anexar arquivo" title="Anexar arquivo (até 8 MB)" disabled={busy} onClick={() => picker.current?.click()}><Paperclip size={20}/></button>
      <button type="button" aria-label="Compartilhar música, álbum ou playlist" title="Compartilhar música" aria-expanded={sharing} onClick={() => setSharing(!sharing)}><Music2 size={20}/></button>
      <button className="social-send" aria-label="Enviar mensagem" disabled={!draft.trim()}><Send size={20}/></button>
    </form>
  </section>;
}
