import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  return text.split(/(https?:\/\/[^\s<>]+)/g).map((part, i) => {
    if (!/^https?:\/\//i.test(part)) return <React.Fragment key={i}>{part}</React.Fragment>;
    try { const url = new URL(part); return ['https:', 'http:'].includes(url.protocol) ? <a key={i} href={url.href} target="_blank" rel="noopener noreferrer">{part}</a> : part; } catch { return part; }
  });
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
export function SharedCard({ payload, library, onPlay }) {
  const list = payload.kind === 'track' ? library.tracks : payload.kind === 'album' ? library.albums : library.playlists;
  const item = list.find(item => item.id === payload.id);
  const cover = item?.cover || (item?.trackIds && library.tracks.find(t => item.trackIds.includes(t.id) && t.cover)?.cover);
  return <div className="social-shared-card">
    <span className="social-cover">{cover ? <img src={cover} alt="" loading="lazy"/> : <Music2 size={32}/>}</span>
    <div><small>{{ track: 'Música compartilhada', album: 'Álbum compartilhado', playlist: 'Playlist compartilhada' }[payload.kind]}</small><strong>{payload.title}</strong><small>{payload.artist || (item?.trackIds ? `${item.trackIds.length} músicas` : '')}</small></div>
    <button className="social-play" onClick={() => onPlay(payload.kind, payload.id)} disabled={!item} aria-label={`Ouvir ${payload.title}`}><Play size={18} fill="currentColor"/></button>
    {!item && <small>Este item não está mais disponível.</small>}
  </div>;
}

export default function ChatPane({ user, social, conversation, friend, library, apiBase, onPlay, onBack, onExpand, onProfile, onCall, onReport, drafts, setDrafts, scrolls, currentTrack, expanded }) {
  const id = conversation?.id, rows = social.messages[id] || [], page = social.pages[id];
  const presence = social.state.presence[friend?.id];
  const scroller = useRef(null), input = useRef(null), picker = useRef(null), bottom = useRef(true), loadingOlder = useRef(false);
  const lastTyping = useRef(0), restore = useRef(null), lastMessage = useRef(null);
  const [search, setSearch] = useState(''), [found, setFound] = useState(null), [searching, setSearching] = useState(false);
  const [emoji, setEmoji] = useState(false), [sharing, setSharing] = useState(false), [shareQuery, setShareQuery] = useState('');
  const [edit, setEdit] = useState(null), [editText, setEditText] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const draft = drafts[id] || '';
  useEffect(() => {
    if (!id) return;
    setSearch(''); setFound(null); setSharing(false); setEdit(null); lastMessage.current = null;
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
    if (search.trim().length < 2 || !id) { setFound(null); return; }
    let active = true;
    const timer = setTimeout(() => { setSearching(true); social.request(`/conversations/${socialPath(id)}/messages?q=${encodeURIComponent(search)}`).then(value => { if (active) setFound(value); }).catch(social.fail).finally(() => { if (active) setSearching(false); }); }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [search, id]);
  function changeDraft(value) {
    setDrafts(d => ({ ...d, [id]: value }));
    if (Date.now() - lastTyping.current > 2500 || !value) {
      social.sendEvent({ type: 'typing', conversationId: id, peerId: friend.id, typing: Boolean(value) }); lastTyping.current = Date.now();
    }
  }
  async function submit(event) {
    event.preventDefault(); if (!draft.trim()) return;
    const text = draft.trim(); changeDraft(''); bottom.current = true;
    try { await social.send(id, { text }); } catch (error) { social.fail(error); }
    input.current?.focus();
  }
  async function older() {
    setLoading(true); loadingOlder.current = true;
    const node = scroller.current, height = node.scrollHeight, top = node.scrollTop;
    try { await social.loadMessages(id, page.before); requestAnimationFrame(() => { node.scrollTop = top + node.scrollHeight - height; }); }
    catch (error) { social.fail(error); } finally { loadingOlder.current = false; setLoading(false); }
  }
  async function attach(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (file.size > 8 * 1024 * 1024) return social.fail(new Error('Anexos podem ter até 8 MB.'));
    setBusy(true);
    try { const form = new FormData(); form.set('file', file); const payload = await social.request(`/attachments?conversation=${socialPath(id)}`, 'POST', form); await social.send(id, { kind: 'attachment', attachmentId: payload.id, payload }); }
    catch (error) { social.fail(error); } finally { setBusy(false); }
  }
  async function editMessage(event) {
    event.preventDefault(); setBusy(true);
    try { const value = await social.request(`/messages/${edit.id}`, 'PUT', { text: editText }); social.receiveMessages([value.message]); setEdit(null); }
    catch (error) { social.fail(error); } finally { setBusy(false); }
  }
  if (!friend || !conversation) return <section className="social-chat social-chat-empty"><MessageCircle size={64}/><h2>Uma boa conversa começa aqui</h2><p>Escolha um amigo para conversar, compartilhar músicas e ouvir junto.</p><span>Seu player continua tocando.</span></section>;
  const shareItems = [...library.tracks.map(t => ({ ...t, kind: 'track' })), ...library.albums.map(t => ({ ...t, kind: 'album' })), ...library.playlists.map(t => ({ ...t, title: t.name, kind: 'playlist' }))].filter(t => `${t.title} ${t.artist || ''}`.toLocaleLowerCase().includes(shareQuery.toLocaleLowerCase())).slice(0, 25);
  return <section className="social-chat" aria-label={`Conversa com ${friend.displayName}`}>
    <header className="social-chat-head">
      <button className="social-mobile-back" aria-label="Voltar aos amigos" onClick={onBack}><ArrowLeft size={18}/></button>
      <button className="social-person-heading" onClick={onProfile}><Avatar person={friend} presence={presence}/><span><strong>{friend.displayName}</strong><small><i className={`social-dot ${presence?.status || 'offline'}`}/>{statusLabel(presence)}</small></span></button>
      <div className="social-chat-actions"><button aria-label="Chamada de voz" title="Chamada de voz" onClick={() => onCall(false)}><Phone size={18}/></button><button aria-label="Chamada de vídeo" title="Chamada de vídeo" onClick={() => onCall(true)}><Video size={19}/></button>{onExpand && <button aria-label="Abrir em tela cheia" onClick={onExpand}><Maximize2 size={18}/></button>}
        <details className="social-menu"><summary aria-label="Opções da conversa"><MoreHorizontal size={20}/></summary><div><button onClick={() => social.request(`/conversations/${socialPath(id)}`, 'PUT', { muted: !conversation.muted }).then(social.refresh).catch(social.fail)}>{conversation.muted ? 'Ativar notificações' : 'Silenciar conversa'}</button><button onClick={() => social.request(`/conversations/${socialPath(id)}`, 'PUT', { archived: !conversation.archived }).then(social.refresh).catch(social.fail)}>{conversation.archived ? 'Desarquivar' : 'Arquivar conversa'}</button><button onClick={() => onReport(friend)}>Denunciar usuário</button></div></details>
      </div>
    </header>
    <div className="social-message-search"><Search size={14}/><input aria-label="Pesquisar mensagens" value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar nesta conversa..."/>{search && <button onClick={() => setSearch('')} aria-label="Limpar pesquisa"><X size={14}/></button>}</div>
    <div className="social-messages" ref={scroller} role="log" aria-label="Mensagens" aria-live="polite" onScroll={event => {
      const node = event.currentTarget; scrolls.current[id] = node.scrollTop; saveLocal(`consona-scroll:${user.id}`, scrolls.current);
      bottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
      if (bottom.current && !document.hidden && !found) social.receipt(id, rows.at(-1)?.seq, true);
    }}>
      {!found && page?.hasMore && <button className="social-load-more" disabled={loading} onClick={older}>{loading ? 'Carregando...' : 'Carregar mensagens anteriores'}</button>}
      {searching && <p className="social-empty-small">Pesquisando...</p>}
      {(found?.messages || rows).map(m => <div className={`social-message-row ${m.senderId === user.id ? 'mine' : ''}`} key={m.id}>
        <Avatar person={m.senderId === user.id ? user : friend}/>
        <div className={`social-bubble ${m.failed ? 'failed' : ''}`}>
          {m.deletedAt ? <em>Mensagem excluída</em> : <>
            {m.text && <p><SafeText text={m.text}/></p>}
            {['track','album','playlist'].includes(m.kind) && <SharedCard payload={m.payload} library={library} onPlay={onPlay}/>}
            {m.kind === 'attachment' && <Attachment payload={m.payload} apiBase={apiBase} fail={social.fail}/>}
          </>}
          <footer><time dateTime={new Date(m.createdAt).toISOString()} title={new Date(m.createdAt).toLocaleString('pt-BR')}>{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>{m.editedAt && <small>editada</small>}{m.senderId === user.id && <span title={m.failed ? 'Falha no envio' : m.pending ? 'Enviando' : conversation.peerReadSeq >= m.seq ? 'Lida' : conversation.peerDeliveredSeq >= m.seq ? 'Entregue' : 'Enviada'} className={conversation.peerReadSeq >= m.seq ? 'read' : ''}>{m.pending ? '…' : conversation.peerDeliveredSeq >= m.seq ? <CheckCheck size={14}/> : <Check size={14}/>}</span>}</footer>
          {m.failed && <button onClick={() => social.send(id, m.retryData, m.clientId).catch(social.fail)}>Tentar enviar novamente</button>}
          {!m.pending && !m.failed && !m.deletedAt && <details className="social-message-options"><summary aria-label="Opções da mensagem"><MoreHorizontal size={14}/></summary><div>{m.senderId === user.id ? <><button onClick={() => { setEdit(m); setEditText(m.text); }}><Edit3 size={13}/>Editar</button><button onClick={() => { if (window.confirm('Excluir esta mensagem para os dois participantes?')) social.request(`/messages/${m.id}`, 'DELETE').then(v => social.receiveMessages([v.message])).catch(social.fail); }}><Trash2 size={13}/>Excluir</button></> : <button onClick={() => onReport(friend, m.id)}>Denunciar mensagem</button>}</div></details>}
        </div>
      </div>)}
      {found && !found.messages.length && <p className="social-empty-small">Nenhuma mensagem encontrada.</p>}
      {found?.hasMore && <button className="social-load-more" onClick={() => social.request(`/conversations/${socialPath(id)}/messages?q=${encodeURIComponent(search)}&before=${found.nextBefore}`).then(v => setFound({ ...v, messages: [...v.messages, ...found.messages] })).catch(social.fail)}>Mais resultados</button>}
      {!rows.length && !loading && !found && <p className="social-empty-small">Diga um oi para {friend.displayName} 🎵</p>}
    </div>
    <div className="social-typing" aria-live="polite">{social.typing[id] > Date.now() ? `${friend.displayName} está digitando…` : conversation.muted ? 'Notificações desta conversa silenciadas' : ' '}</div>
    {edit && <form className="social-edit" onSubmit={editMessage}><label>Editar mensagem<input autoFocus maxLength={4000} value={editText} onChange={e => setEditText(e.target.value)}/></label><button disabled={busy || !editText.trim()}>Salvar</button><button type="button" onClick={() => setEdit(null)}>Cancelar</button></form>}
    {sharing && <div className="social-share-picker"><header><strong>Compartilhar música</strong><button aria-label="Fechar compartilhamento" onClick={() => setSharing(false)}><X size={17}/></button></header><input autoFocus placeholder="Música, álbum ou playlist..." aria-label="Buscar item para compartilhar" value={shareQuery} onChange={e => setShareQuery(e.target.value)}/><div>{currentTrack && <button onClick={() => { setSharing(false); social.send(id, {kind:'track',itemId:currentTrack.id,payload:{id:currentTrack.id,kind:'track',title:currentTrack.title,artist:currentTrack.artist}}).catch(social.fail); }}><Headphones size={17}/><span>Compartilhar música atual<small>{currentTrack.title}</small></span></button>}{shareItems.map(item => <button key={`${item.kind}:${item.id}`} onClick={() => { setSharing(false); social.send(id, { kind: item.kind, itemId: item.id, payload: { id: item.id, kind: item.kind, title: item.title, artist: item.artist } }).catch(social.fail); }}><Music2 size={16}/><span>{item.title}<small>{item.artist || { track: 'Música', album: 'Álbum', playlist: 'Playlist' }[item.kind]}</small></span></button>)}</div></div>}
    {emoji && <div className="social-emojis" aria-label="Emojis">{'😀 😊 😂 ❤️ 🎵 🎧 🔥 👍 🙌 😢 😎 ✨'.split(' ').map(value => <button key={value} aria-label={`Inserir ${value}`} onClick={() => { changeDraft(draft + value); setEmoji(false); input.current?.focus(); }}>{value}</button>)}</div>}
    <form className="social-composer" onSubmit={submit}>
      <button type="button" aria-label="Emojis" aria-expanded={emoji} onClick={() => setEmoji(!emoji)}><Smile size={23}/></button>
      <textarea ref={input} rows={1} maxLength={4000} aria-label="Mensagem" placeholder="Digite uma mensagem..." value={draft} onChange={e => changeDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(e); } }}/>
      <input ref={picker} hidden type="file" accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,.txt" onChange={attach}/>
      <button type="button" aria-label="Anexar arquivo" title="Anexar arquivo (até 8 MB)" disabled={busy} onClick={() => picker.current?.click()}><Paperclip size={20}/></button>
      <button type="button" aria-label="Compartilhar música, álbum ou playlist" title="Compartilhar música" aria-expanded={sharing} onClick={() => setSharing(!sharing)}><Music2 size={20}/></button>
      <button className="social-send" aria-label="Enviar mensagem" disabled={!draft.trim()}><Send size={20}/></button>
    </form>
  </section>;
}
