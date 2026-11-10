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
function Spoiler({children}) { const [visible,setVisible]=useState(false);return <button type="button" className="social-spoiler" aria-label={visible?'Ocultar spoiler':'Mostrar spoiler'} onClick={()=>setVisible(!visible)}>{visible?children:'Clique para mostrar spoiler'}</button>; }
export function SafeText({ text = '' }) {
  return text.split(/(\|\|[^\n|]+\|\|)/g).map((part,index)=>part.startsWith('||') && part.endsWith('||') ? <Spoiler key={index}>{part.slice(2,-2)}</Spoiler> : <ReactMarkdown key={index} remarkPlugins={[remarkGfm]} skipHtml urlTransform={value => /^https?:\/\//i.test(value) ? value : ''} components={{ a: ({children, href}) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>, img: ({alt}) => <span>{alt}</span> }}>{part}</ReactMarkdown>);
}
function LinkPreview({ text, social }) {
  const href=text.match(/https:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.;!?]+$/, '') || '';
  const [preview,setPreview]=useState(null);
  useEffect(() => { let active=true; setPreview(null); let allowed=false; try { const host=new URL(href).hostname.toLowerCase(); allowed=['youtube.com','youtu.be','spotify.com','bandcamp.com','soundcloud.com','musicbrainz.org','last.fm','wikipedia.org'].some(d=>host===d || host.endsWith(`.${d}`)); } catch {} if(allowed) social.request(`/link-preview?url=${encodeURIComponent(href)}`).then(value=>{if(active && (value.title || value.description)) setPreview(value);}).catch(()=>{}); return()=>{active=false;}; },[href,social.request]);
  if(!preview) return null;
  return <a className="social-link-preview" href={preview.url} target="_blank" rel="noopener noreferrer"><span><small>{preview.domain}</small><strong>{preview.title}</strong><small>{preview.description}</small></span>{preview.image && <img src={preview.image} loading="lazy" referrerPolicy="no-referrer" alt=""/>}</a>;
}
function ExternalImage({text}){const [open,setOpen]=useState(false);const href=text.match(/https:\/\/[^\s<>]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s<>]*)?/i)?.[0];let allowed=false;try{const url=new URL(href),host=url.hostname.toLowerCase();allowed=url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&['i.imgur.com','images.unsplash.com','cdn.7tv.app','static.klipy.com','coverartarchive.org','upload.wikimedia.org','i.scdn.co'].some(d=>host===d);}catch{}if(!allowed)return null;return <><button type="button" onClick={()=>setOpen(true)} aria-label="Ampliar imagem externa"><img className="social-attachment-preview" src={href} alt="Imagem compartilhada" loading="lazy" referrerPolicy="no-referrer"/></button>{open && <div className="social-image-viewer" role="dialog" aria-modal="true" aria-label="Visualizador de imagem" onClick={()=>setOpen(false)}><button type="button" aria-label="Fechar imagem">×</button><img src={href} alt="Imagem compartilhada" referrerPolicy="no-referrer"/></div>}</>;}
export function CustomEmojiImage({ apiBase, item }) { const [src,setSrc]=useState('');useEffect(()=>{const controller=new AbortController();let object='';fetch(`${apiBase}/api/social/custom-emojis/${item.id}`,{signal:controller.signal,headers:{Authorization:`Bearer ${sessionStorage.getItem('consona-session') || ''}`}}).then(response=>{if(!response.ok)throw new Error('unavailable');return response.blob();}).then(blob=>{if(!controller.signal.aborted){object=URL.createObjectURL(blob);setSrc(object);}}).catch(()=>{});return()=>{controller.abort();if(object)URL.revokeObjectURL(object);};},[item.id,apiBase]);return src?<img loading="lazy" src={src} alt={item.name}/>:<span>:{item.name}:</span>; }
export function ReactionSymbol({value,apiBase}){if(value.startsWith('7tv:'))return <img className="social-reaction-image" src={`https://cdn.7tv.app/emote/${encodeURIComponent(value.slice(4))}/1x.webp`} alt="Emoji 7TV"/>;if(value.startsWith('consona:'))return <span className="social-reaction-image"><CustomEmojiImage apiBase={apiBase} item={{id:value.slice(8),name:'emoji'}}/></span>;return value;}
export function MediaPicker({ social, user, onSelect, apiBase }) {
  const [tab, setTab] = useState('7tv'), [query, setQuery] = useState(''), [items, setItems] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const key = `consona-media-favorites:${user.id}`;
  const [favorites, setFavorites] = useState(() => readLocal(key, []));
  useEffect(() => {
    if (tab === 'favorites') { setItems(favorites); return; }
    let active = true; const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try { const value = await social.request(tab==='custom'?'/custom-emojis':`/media/search?provider=${tab}&q=${encodeURIComponent(query)}`); if (active) setItems(tab==='custom'?value.items.filter(item=>`${item.name} ${item.pack}`.toLowerCase().includes(query.toLowerCase())):value.items); }
      catch (e) { if (active) { setItems([]); setError(e.message); } }
      finally { if (active) setLoading(false); }
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [tab, query, favorites]);
  function favorite(item) { const exists = favorites.some(x => x.provider === item.provider && x.id === item.id); const next = exists ? favorites.filter(x => x.provider !== item.provider || x.id !== item.id) : [item, ...favorites].slice(0,100); setFavorites(next); saveLocal(key, next); }
  async function upload(e){e.preventDefault();const element=e.currentTarget,form=new FormData(element);try{const item=await social.request('/custom-emojis','POST',form);setItems(old=>[item,...old]);element.reset();}catch(error){setError(error.message);}}
  return <div className="social-media-picker"><nav>{[['7tv','7TV'],['custom','Próprios'],['gif','GIFs'],['sticker','Stickers'],['favorites','Favoritos']].map(([value,label]) => <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</nav>
    {tab==='custom' && <form onSubmit={upload}><select name="type" aria-label="Tipo de mídia"><option value="emoji">Emoji</option><option value="sticker">Sticker</option></select><input name="name" aria-label="Nome do emoji" placeholder="Nome" pattern="[A-Za-z0-9_]{2,40}" required/><input name="pack" aria-label="Pack" placeholder="Pack (opcional)"/><input name="file" type="file" accept="image/png,image/gif,image/webp" required/><button>Enviar mídia</button></form>}
    {tab !== 'favorites' && <input aria-label="Buscar mídia" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar mídia..."/>}
    {loading && <p>Carregando...</p>}{error && <p role="status">{error}</p>}
    <div className="social-media-grid">{items.map(item => <span key={`${item.provider}:${item.id}`}><button type="button" onClick={() => onSelect(item,query)} title={item.name}>{item.provider==='consona'?<CustomEmojiImage apiBase={apiBase} item={item}/>:<img loading="lazy" src={item.url} alt={item.name}/>}</button><button type="button" aria-label={`Favoritar ${item.name}`} onClick={() => favorite(item)}>{favorites.some(x => x.provider === item.provider && x.id === item.id) ? '★' : '☆'}</button></span>)}</div>
    {(tab === 'gif' || tab === 'sticker') && <small>GIFs e stickers por KLIPY</small>}
  </div>;
}
export function Attachment({ payload, apiBase, fail, endpoint = 'attachments' }) {
  const [url, setUrl] = useState(''), [busy, setBusy] = useState(false);
  const [enlarged,setEnlarged]=useState(false);
  const [revealed,setRevealed]=useState(!payload.spoiler);
  const object = useRef('');
  useEffect(() => { let disposed=false; const controller=new AbortController(); if(revealed && payload.mime?.startsWith('image/')) fetch(`${apiBase}/api/social/${endpoint}/${payload.id}`, {signal:controller.signal,headers:{Authorization:`Bearer ${sessionStorage.getItem('consona-session') || ''}`}}).then(response=>{if(!response.ok) throw new Error('Não foi possível abrir a imagem.');return response.blob();}).then(blob=>{if(!disposed){object.current=URL.createObjectURL(blob);setUrl(object.current);}}).catch(error=>{if(error.name!=='AbortError'&&!disposed) fail(error);}); return () => {disposed=true;controller.abort();if(object.current) URL.revokeObjectURL(object.current);object.current='';}; }, [payload.id,endpoint,apiBase,revealed]);
  async function download() {
    if (url) return;
    setBusy(true);
    try {
      const response = await fetch(`${apiBase}/api/social/${endpoint}/${payload.id}`, { headers: { Authorization: `Bearer ${sessionStorage.getItem('consona-session') || ''}` } });
      if (!response.ok) throw new Error('Não foi possível abrir o anexo.');
      object.current = URL.createObjectURL(await response.blob()); setUrl(object.current);
    } catch (error) { fail(error); } finally { setBusy(false); }
  }
  if(!revealed)return <button type="button" className="social-spoiler" onClick={()=>setRevealed(true)}>Mostrar anexo marcado como spoiler</button>;
  return <div className="social-attachment">
    <FileText size={26}/><span><strong>{payload.name}</strong><small>{Math.ceil((payload.size || 0) / 1024)} KB</small></span>
    {url ? <a href={url} download={payload.name} aria-label="Baixar arquivo"><Download size={18}/></a> : <button onClick={download} disabled={busy} aria-label="Carregar anexo"><Download size={18}/></button>}
    {url && payload.mime?.startsWith('image/') && <><button type="button" onClick={()=>setEnlarged(true)} aria-label={`Ampliar ${payload.name}`}><img className="social-attachment-preview" src={url} alt={payload.name}/></button>{enlarged && <div className="social-image-viewer" role="dialog" aria-modal="true" aria-label="Visualizador de imagem" onClick={()=>setEnlarged(false)}><button type="button" aria-label="Fechar imagem" onClick={()=>setEnlarged(false)}>×</button><img src={url} alt={payload.name}/></div>}</>}
  </div>;
}
export function MediaSpoiler({hidden,children}){const [revealed,setRevealed]=useState(!hidden);return revealed?children:<button type="button" className="social-spoiler" onClick={()=>setRevealed(true)}>Mostrar mídia marcada como spoiler</button>;}
export function SharedCard({ payload, library, onPlay, onFavorite }) {
  const list = payload.kind === 'track' ? library.tracks : payload.kind === 'album' ? library.albums : library.playlists;
  const item = list.find(item => item.id === payload.id);
  const cover = item?.cover || (item?.trackIds && library.tracks.find(t => item.trackIds.includes(t.id) && t.cover)?.cover);
  return <div className="social-shared-card">
    <span className="social-cover">{cover ? <img src={cover} alt="" loading="lazy"/> : <Music2 size={32}/>}</span>
    <div><small>{{ track: 'Música compartilhada', album: 'Álbum compartilhado', playlist: 'Playlist compartilhada' }[payload.kind]}</small><strong>{payload.title}</strong><small>{payload.artist || (item?.trackIds ? `${item.trackIds.length} músicas` : '')}</small></div>
    <button className="social-play" onClick={() => onPlay(payload.kind, payload.id, payload.position || 0)} disabled={!item} aria-label={`Ouvir ${payload.title}`}><Play size={18} fill="currentColor"/></button>
    {payload.position>0 && <small>A partir de {Math.floor(payload.position/60)}:{String(Math.floor(payload.position%60)).padStart(2,'0')}</small>}
    {payload.kind === 'track' && item && <button type="button" aria-pressed={library.favorites.includes(item.id)} onClick={() => onFavorite(item.id)}>{library.favorites.includes(item.id) ? 'Remover dos favoritos' : 'Salvar nos favoritos'}</button>}
    {!item && <small>Este item não está mais disponível.</small>}
  </div>;
}

export default function ChatPane({ user, social, conversation, friend, library, apiBase, onPlay, onFavorite, onBack, onMarkUnread, onExpand, onProfile, onCall, onReport, drafts, setDrafts, scrolls, currentTrack, getPosition, expanded, jumpMessage, clearJump }) {
  const id = conversation?.id, rows = social.messages[id] || [], page = social.pages[id];
  const presence = social.state.presence[friend?.id];
  const scroller = useRef(null), input = useRef(null), picker = useRef(null), bottom = useRef(true), loadingOlder = useRef(false);
  const lastTyping = useRef(0), restore = useRef(null), lastMessage = useRef(null);
  const [search, setSearch] = useState(''), [found, setFound] = useState(null), [searching, setSearching] = useState(false);
  const [searchSender, setSearchSender] = useState(''), [searchKind, setSearchKind] = useState(''), [searchDate, setSearchDate] = useState('');
  const [emoji, setEmoji] = useState(false), [sharing, setSharing] = useState(false), [shareQuery, setShareQuery] = useState('');
  const [reacting,setReacting]=useState(null);
  const [emojiSuggestions,setEmojiSuggestions]=useState([]);
  const [media, setMedia] = useState(false);
  const [mediaSpoiler,setMediaSpoiler]=useState(false);
  const [forward, setForward] = useState(null);
  const [forwardGroups,setForwardGroups]=useState([]);
  useEffect(()=>{if(forward)social.request('/groups').then(v=>setForwardGroups(v.groups)).catch(social.fail);},[forward]);
  const [edit, setEdit] = useState(null), [editText, setEditText] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [reply, setReply] = useState(null), [features, setFeatures] = useState({ reactions: [], marks: [] });
  const [preview, setPreview] = useState(false);
  const [gallery,setGallery]=useState(null);
  async function loadGallery(before) { try { const value=await social.request(`/conversations/${socialPath(id)}/media${before?`?before=${before}`:''}`); setGallery(old=>({...value,messages:before?[...old.messages,...value.messages]:value.messages})); } catch(error) {social.fail(error);} }
  const [viewMarks, setViewMarks] = useState('');
  const [marked,setMarked]=useState(null);
  useEffect(()=>{let active=true;setMarked(null);if(id && viewMarks) social.request(`/conversations/${socialPath(id)}/marked?kind=${viewMarks}`).then(value=>{if(active)setMarked(value);}).catch(social.fail);return()=>{active=false;};},[id,viewMarks,features]);
  async function refreshFeatures() { if (id) try { setFeatures(await social.request(`/conversations/${socialPath(id)}/features`)); } catch (error) { social.fail(error); } }
  useEffect(() => { setReply(null); setViewMarks(''); refreshFeatures(); const listener = e => { if (e.detail === id) refreshFeatures(); }; window.addEventListener('consona-message-features', listener); return () => window.removeEventListener('consona-message-features', listener); }, [id]);
  async function toggleFeature(m, kind, emoji, superReaction = false) { const existing = kind === 'reaction' ? features.reactions.some(r => r.message_id === m.id && r.user_id === user.id && r.emoji === emoji) : features.marks.some(r => r.message_id === m.id && r.user_id === user.id && r.kind === kind); try { await social.request(`/messages/${m.id}/${kind}`, existing && !superReaction ? 'DELETE' : 'PUT', kind === 'reaction' ? { emoji, super:superReaction } : {}); await refreshFeatures(); } catch (error) { social.fail(error); } }
  async function jumpTo(messageId) {
    try {
      const result = await social.request(`/messages/${socialPath(messageId)}/location`);
      if (result.conversationId !== id) throw new Error('Mensagem pertence a outra conversa.');
      bottom.current = false; setFound(null); setSearch(''); setSearchSender(''); setSearchKind(''); setSearchDate(''); setViewMarks(''); social.receiveMessages(result.messages);
      setTimeout(() => document.getElementById(`social-message-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    } catch (error) { social.fail(error); }
  }
  async function remind(message) { const raw=window.prompt('Lembrar em quantos minutos?', '60'); if(raw===null)return;const minutes=Number(raw);if(!Number.isFinite(minutes)||minutes<1||minutes>525600) return social.fail(new Error('Informe de 1 a 525600 minutos.'));try{await social.request(`/messages/${message.id}/reminders`,'POST',{dueAt:Date.now()+minutes*60000});}catch(error){social.fail(error);} }
  async function shareLyrics(){const value=window.prompt('Cole um pequeno trecho de letra que você tenha autorização para compartilhar (até 200 caracteres):');if(value===null)return;const excerpt=value.trim();if(!excerpt || excerpt.length>200)return social.fail(new Error('Informe um trecho de até 200 caracteres.'));try{await social.send(id,{text:`Trecho de letra:\n> ${excerpt.replace(/\n/g,'\n> ')}`});}catch(error){social.fail(error);}}
  useEffect(() => { if (id && jumpMessage) { jumpTo(jumpMessage); clearJump(); } }, [id, jumpMessage]);
  const draft = drafts[id] || '';
  const mentionMatch = draft.match(/(?:^|\s)@([\w.-]*)$/);
  const mentionSuggestions = mentionMatch ? [...social.state.friends,...social.state.dmContacts.filter(person=>!social.state.friends.some(friend=>friend.id===person.id))].filter(person => person.username.toLowerCase().startsWith(mentionMatch[1].toLowerCase())).slice(0, 6) : [];
  useEffect(()=>{let active=true;const match=draft.match(/(?:^|\s):([a-z0-9_+-]{2,30})$/i);if(!match){setEmojiSuggestions([]);return;}const timer=setTimeout(()=>{Promise.all([import('emoji-picker-react/data'),import('emoji-picker-react/data/emojis-en')]).then(([api,data])=>{if(active)setEmojiSuggestions(api.searchEmojis(match[1].replaceAll('_',' '),{emojiData:data.default}).slice(0,8));}).catch(()=>{});},150);return()=>{active=false;clearTimeout(timer);};},[draft]);
  useEffect(() => {
    if (!id) return;
    setSearch(''); setSearchSender(''); setSearchKind(''); setSearchDate(''); setFound(null); setSharing(false); setGallery(null); setEdit(null); lastMessage.current = null;
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
    try { const form = new FormData(); form.set('file', file); const payload = await social.request(`/attachments?conversation=${socialPath(id)}`, 'POST', form); await social.send(id, { kind: 'attachment', attachmentId: payload.id, payload:{...payload,spoiler:mediaSpoiler},spoiler:mediaSpoiler }); setMediaSpoiler(false); }
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
      } else data = forward.kind === 'text' ? { text: `↪ ${forward.text}` } : forward.kind === 'external_media' ? { kind: forward.kind, payload: forward.payload } : forward.kind==='custom_emoji'?{kind:'custom_emoji',emojiId:forward.payload.id,payload:forward.payload} : { kind: forward.kind, itemId: forward.payload.id, payload: forward.payload };
      await social.send(destination, data); setForward(null);
    } catch (error) { social.fail(error); }
  }
  async function forwardToGroup(group){try{let data;if(forward.kind==='attachment'){const response=await fetch(`${apiBase}/api/social/attachments/${forward.payload.id}`,{headers:{Authorization:`Bearer ${sessionStorage.getItem('consona-session')||''}`}});if(!response.ok)throw new Error('Anexo indisponível.');const blob=await response.blob(),form=new FormData();form.set('file',new File([blob],forward.payload.name,{type:forward.payload.mime}));const uploaded=await social.request(`/groups/${group.id}/attachments`,'POST',form);data={attachmentId:uploaded.id};}else if(forward.kind==='text')data={text:`↪ ${forward.text}`};else if(forward.kind==='external_media')data={kind:forward.kind,payload:forward.payload};else if(forward.kind==='custom_emoji')data={kind:forward.kind,emojiId:forward.payload.id};else data={kind:forward.kind,itemId:forward.payload.id,position:forward.payload.position};await social.request(`/groups/${group.id}/messages`,'POST',{...data,clientId:crypto.randomUUID()});setForward(null);}catch(error){social.fail(error);}}
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
    <button type="button" className="social-load-more" onClick={()=>gallery?setGallery(null):loadGallery()}> {gallery?'Fechar galeria':'Mídia compartilhada'}</button>
    {gallery && <div className="social-gallery" aria-label="Galeria de mídia">{gallery.messages.map(m=><div key={m.id}>{m.kind==='attachment'?<Attachment payload={m.payload} apiBase={apiBase} fail={social.fail}/>:<img className="social-external-media" src={m.payload.url} alt={m.payload.name || 'Mídia'} loading="lazy" referrerPolicy="no-referrer"/>}<button onClick={()=>{setGallery(null);jumpTo(m.id);}}>Ir à mensagem</button></div>)}{gallery.hasMore && <button onClick={()=>loadGallery(gallery.nextBefore)}>Mais mídias</button>}{!gallery.messages.length && <p>Nenhuma mídia compartilhada.</p>}</div>}
    <details className="social-search-filters"><summary>Filtros de busca</summary><label>Autor <select value={searchSender} onChange={e => setSearchSender(e.target.value)}><option value="">Todos</option><option value="me">Eu</option><option value="other">Amigo</option></select></label><label>Tipo <select value={searchKind} onChange={e => setSearchKind(e.target.value)}><option value="">Todos</option><option value="text">Texto</option><option value="track">Música</option><option value="album">Álbum</option><option value="playlist">Playlist</option><option value="attachment">Anexo</option><option value="external_media">Mídia</option></select></label><label>A partir de <input type="date" value={searchDate} onChange={e => setSearchDate(e.target.value)}/></label></details>
    <div className="social-messages" ref={scroller} role="log" aria-label="Mensagens" aria-live="polite" onScroll={event => {
      const node = event.currentTarget; scrolls.current[id] = node.scrollTop; saveLocal(`consona-scroll:${user.id}`, scrolls.current);
      bottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
      if (node.scrollTop < 40 && page?.hasMore && !loading && !loadingOlder.current && !found) older();
      if (bottom.current && !document.hidden && !found) social.receipt(id, rows.at(-1)?.seq, true);
    }}>
      {!found && page?.hasMore && <button className="social-load-more" disabled={loading} onClick={older}>{loading ? 'Carregando...' : 'Carregar mensagens anteriores'}</button>}
      {searching && <p className="social-empty-small">Pesquisando...</p>}
      {(viewMarks ? marked?.messages || [] : found?.messages || rows).map(m => <div id={`social-message-${m.id}`} className={`social-message-row ${m.senderId === user.id ? 'mine' : ''}`} key={m.id}>
        <Avatar person={m.senderId === user.id ? user : friend}/>
        <div className={`social-bubble ${m.failed ? 'failed' : ''}`}>
          {m.deletedAt ? <em>Mensagem excluída</em> : <>
            {m.replyTo && <button className="social-reply-context" onClick={() => jumpTo(m.replyTo)}>↪ {rows.find(x => x.id === m.replyTo)?.text || 'Abrir mensagem respondida'}</button>}
            {m.text && <div className="social-markdown"><SafeText text={m.text}/></div>}
            {m.text && <LinkPreview text={m.text} social={social}/>}
            {m.text && <ExternalImage text={m.text}/>}
            {['track','album','playlist'].includes(m.kind) && <SharedCard payload={m.payload} library={library} onPlay={onPlay} onFavorite={onFavorite}/>}
            {m.kind === 'attachment' && <Attachment payload={m.payload} apiBase={apiBase} fail={social.fail}/>}
            {m.kind === 'external_media' && <MediaSpoiler hidden={m.payload.spoiler}><img className="social-external-media" loading="lazy" src={m.payload.url} alt={m.payload.name || 'Mídia compartilhada'} referrerPolicy="no-referrer"/></MediaSpoiler>}
            {m.kind === 'custom_emoji' && <MediaSpoiler hidden={m.payload.spoiler}><span className={`social-custom-emoji ${m.payload.type==='sticker'?'sticker':''}`}><CustomEmojiImage apiBase={apiBase} item={m.payload}/></span></MediaSpoiler>}
          </>}
          <div className="social-reactions">{[...new Set(features.reactions.filter(r => r.message_id === m.id).map(r => r.emoji))].map(value => <button key={value} className={features.reactions.some(r=>r.message_id===m.id && r.emoji===value && r.is_super)?'social-super-reaction':''} onClick={() => toggleFeature(m,'reaction',value)} aria-label={`Reagir com ${value}`} title={features.reactions.filter(r=>r.message_id===m.id && r.emoji===value).map(r=>r.user_id===user.id?'Você':social.state.friends.find(p=>p.id===r.user_id)?.displayName || 'Amigo').join(', ')}><ReactionSymbol value={value} apiBase={apiBase}/> {features.reactions.filter(r => r.message_id === m.id && r.emoji === value).length}</button>)}</div>
          <footer><time dateTime={new Date(m.createdAt).toISOString()} title={new Date(m.createdAt).toLocaleString('pt-BR')}>{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>{m.editedAt && <small>editada</small>}{m.senderId === user.id && <span title={m.failed ? 'Falha no envio' : m.pending ? 'Enviando' : conversation.peerReadSeq >= m.seq ? 'Lida' : conversation.peerDeliveredSeq >= m.seq ? 'Entregue' : 'Enviada'} className={conversation.peerReadSeq >= m.seq ? 'read' : ''}>{m.pending ? '…' : conversation.peerDeliveredSeq >= m.seq ? <CheckCheck size={14}/> : <Check size={14}/>}</span>}</footer>
          {m.failed && <button onClick={() => social.send(id, m.retryData, m.clientId).catch(social.fail)}>Tentar enviar novamente</button>}
          {!m.pending && !m.failed && !m.deletedAt && <details className="social-message-options"><summary aria-label="Opções da mensagem"><MoreHorizontal size={14}/></summary><div><button onClick={() => { setReply(m); input.current?.focus(); }}>Responder</button><button onClick={() => setForward(m)}>Encaminhar</button><button onClick={() => remind(m)}>Criar lembrete</button><button onClick={() => toggleFeature(m,'reaction','❤️')}>Reagir ❤️</button><button onClick={() => toggleFeature(m,'reaction','👍')}>Reagir 👍</button><button onClick={() => {setReacting(m);setEmoji(true);}}>Mais reacoes</button><button onClick={() => {setReacting(m);setMedia(true);}}>Reagir com emoji proprio ou 7TV</button><button onClick={() => toggleFeature(m,'reaction','\u2764\ufe0f',true)}>Super reacao</button><button onClick={() => toggleFeature(m,'pin')}>Fixar / desfixar</button><button onClick={() => toggleFeature(m,'favorite')}>Favoritar / remover</button><button onClick={() => navigator.clipboard.writeText(m.text).catch(social.fail)}>Copiar texto</button><button onClick={() => { const url = new URL(window.location.href); url.searchParams.set('socialMessage',m.id); navigator.clipboard.writeText(url.href).catch(social.fail); }}>Copiar link</button>{m.senderId === user.id ? <><button onClick={() => { setEdit(m); setEditText(m.text); }}><Edit3 size={13}/>Editar</button><button onClick={() => { if (window.confirm('Excluir esta mensagem para os dois participantes?')) social.request(`/messages/${m.id}`, 'DELETE').then(v => social.receiveMessages([v.message])).catch(social.fail); }}><Trash2 size={13}/>Excluir</button></> : <button onClick={() => onReport(friend, m.id)}>Denunciar mensagem</button>}</div></details>}
        </div>
      </div>)}
      {found && !found.messages.length && <p className="social-empty-small">Nenhuma mensagem encontrada.</p>}
      {viewMarks && marked && !marked.messages.length && <p className="social-empty-small">Nenhuma mensagem nesta lista.</p>}
      {viewMarks && marked?.hasMore && <button className="social-load-more" onClick={()=>social.request(`/conversations/${socialPath(id)}/marked?kind=${viewMarks}&before=${marked.nextBefore}`).then(value=>setMarked({...value,messages:[...marked.messages,...value.messages]})).catch(social.fail)}>Mais mensagens</button>}
      {found?.hasMore && <button className="social-load-more" onClick={() => social.request(`/conversations/${socialPath(id)}/messages?${searchParams()}&before=${found.nextBefore}`).then(v => setFound({ ...v, messages: [...v.messages, ...found.messages] })).catch(social.fail)}>Mais resultados</button>}
      {!rows.length && !loading && !found && <p className="social-empty-small">Diga um oi para {friend.displayName} 🎵</p>}
    </div>
    <div className="social-typing" aria-live="polite">{social.typing[id] > Date.now() ? `${friend.displayName} está digitando…` : conversation.muted ? 'Notificações desta conversa silenciadas' : ' '}</div>
    {reply && <div className="social-reply-bar">Respondendo: {reply.text || 'Mídia compartilhada'} <button onClick={() => setReply(null)}>Cancelar</button></div>}
    {forward && <div className="social-share-picker"><header><strong>Encaminhar para</strong><button type="button" onClick={() => setForward(null)}>Fechar</button></header><div>{[...social.state.friends,...social.state.dmContacts.filter(person=>!social.state.friends.some(friend=>friend.id===person.id))].map(person => <button key={person.id} type="button" onClick={() => forwardTo(person)}>{person.displayName}</button>)}{forwardGroups.map(group=><button key={group.id} type="button" onClick={()=>forwardToGroup(group)}>Grupo: {group.name}</button>)}</div></div>}
    {edit && <form className="social-edit" onSubmit={editMessage}><label>Editar mensagem<input autoFocus maxLength={4000} value={editText} onChange={e => setEditText(e.target.value)}/></label><button disabled={busy || !editText.trim()}>Salvar</button><button type="button" onClick={() => setEdit(null)}>Cancelar</button></form>}
    {sharing && <div className="social-share-picker"><header><strong>Compartilhar música</strong><button aria-label="Fechar compartilhamento" onClick={() => setSharing(false)}><X size={17}/></button></header>{currentTrack && <button type="button" onClick={() => { setSharing(false); social.send(id,{kind:'track',itemId:currentTrack.id,position:getPosition(),payload:{id:currentTrack.id,kind:'track',title:currentTrack.title,artist:currentTrack.artist,position:getPosition()}}).catch(social.fail); }}>Compartilhar ponto atual</button>}<input autoFocus placeholder="Música, álbum ou playlist..." aria-label="Buscar item para compartilhar" value={shareQuery} onChange={e => setShareQuery(e.target.value)}/><div>{currentTrack && <button onClick={() => { setSharing(false); social.send(id, {kind:'track',itemId:currentTrack.id,payload:{id:currentTrack.id,kind:'track',title:currentTrack.title,artist:currentTrack.artist}}).catch(social.fail); }}><Headphones size={17}/><span>Compartilhar música atual<small>{currentTrack.title}</small></span></button>}{shareItems.map(item => <button key={`${item.kind}:${item.id}`} onClick={() => { setSharing(false); social.send(id, { kind: item.kind, itemId: item.id, payload: { id: item.id, kind: item.kind, title: item.title, artist: item.artist } }).catch(social.fail); }}><Music2 size={16}/><span>{item.title}<small>{item.artist || { track: 'Música', album: 'Álbum', playlist: 'Playlist' }[item.kind]}</small></span></button>)}</div></div>}
    {emoji && <div className="social-emojis" aria-label="Emojis"><React.Suspense fallback={<span>Carregando emojis...</span>}><EmojiPicker onEmojiClick={item => { if(reacting) toggleFeature(reacting,'reaction',item.emoji); else changeDraft(draft + item.emoji); setReacting(null); setEmoji(false); input.current?.focus(); }} searchPlaceHolder="Buscar emoji" width="100%" height={280}/></React.Suspense></div>}
    {media && <MediaPicker social={social} user={user} apiBase={apiBase} onSelect={(item,query) => { setMedia(false);if(reacting){if(!['7tv','consona'].includes(item.provider))social.fail(new Error('Escolha um emoji 7TV ou próprio.'));else toggleFeature(reacting,'reaction',`${item.provider}:${item.id}`);setReacting(null);}else {social.send(id, item.provider==='consona'?{kind:'custom_emoji',emojiId:item.id,payload:item,spoiler:mediaSpoiler}:{ kind: 'external_media', payload: item, query,spoiler:mediaSpoiler }).catch(social.fail);setMediaSpoiler(false);} }}/>} 
    {preview && <div className="social-edit social-markdown"><strong>Prévia</strong><SafeText text={draft}/></div>}
    {mentionSuggestions.length > 0 && <div className="social-edit" aria-label="Sugestões de menção">{mentionSuggestions.map(person => <button type="button" key={person.id} onClick={() => { changeDraft(draft.replace(/@([\w.-]*)$/, `@${person.username} `)); input.current?.focus(); }}>@{person.username}</button>)}</div>}
    {emojiSuggestions.length > 0 && <div className="social-edit" aria-label="Sugestões de emoji">{emojiSuggestions.map(item=><button type="button" key={item.unified} title={item.name} onClick={()=>{changeDraft(draft.replace(/:[a-z0-9_+-]{2,30}$/i,`${item.emoji} `));input.current?.focus();}}>{item.emoji} {item.name}</button>)}</div>}
    <form className="social-composer" onSubmit={submit}>
      <label title="Ocultar próxima mídia como spoiler"><input type="checkbox" checked={mediaSpoiler} onChange={e=>setMediaSpoiler(e.target.checked)} aria-label="Próxima mídia é spoiler"/>S</label>
      <button type="button" aria-label="Emojis" aria-expanded={emoji} onClick={() => {setReacting(null);setEmoji(!emoji);}}><Smile size={23}/></button>
      <button type="button" aria-label="GIFs, stickers e 7TV" aria-expanded={media} onClick={() => {setReacting(null);setMedia(!media);}}>GIF</button>
      <button type="button" aria-label="Prévia da formatação" aria-pressed={preview} onClick={() => setPreview(!preview)}>Aa</button>
      <textarea ref={input} rows={1} maxLength={4000} aria-label="Mensagem" placeholder="Digite uma mensagem..." value={draft} onChange={e => changeDraft(e.target.value)} onPaste={e => { const file=[...e.clipboardData.files].find(item=>item.type.startsWith('image/')); if (file) { e.preventDefault(); attachFile(file); } }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(e); } }}/>
      <input ref={picker} hidden type="file" accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,.txt" onChange={attach}/>
      <button type="button" aria-label="Anexar arquivo" title="Anexar arquivo (até 8 MB)" disabled={busy} onClick={() => picker.current?.click()}><Paperclip size={20}/></button>
      <button type="button" aria-label="Compartilhar música, álbum ou playlist" title="Compartilhar música" aria-expanded={sharing} onClick={() => setSharing(!sharing)}><Music2 size={20}/></button>
      <button type="button" onClick={shareLyrics} title="Compartilhar trecho autorizado">Letra</button>
      <button className="social-send" aria-label="Enviar mensagem" disabled={!draft.trim()}><Send size={20}/></button>
    </form>
  </section>;
}
