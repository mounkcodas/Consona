import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SafeText } from './ChatPane.jsx';

export default function GroupPane({ social, user }) {
  const [groups,setGroups]=useState([]), [selected,setSelected]=useState(''), [messages,setMessages]=useState([]), [before,setBefore]=useState(null), [more,setMore]=useState(false);
  const [name,setName]=useState(''), [members,setMembers]=useState([]), [draft,setDraft]=useState(''), [busy,setBusy]=useState(false);
  const currentGroup=useRef(selected); currentGroup.current=selected;
  const refreshGroups=useCallback(async () => { try { setGroups((await social.request('/groups')).groups); } catch (e) { social.fail(e); } },[social.request,social.fail]);
  const load=useCallback(async (id, cursor) => {
    if (!id) return;
    try { const data=await social.request(`/groups/${encodeURIComponent(id)}/messages${cursor ? `?before=${cursor}` : ''}`);
      if (currentGroup.current !== id) return;
      setMessages(old => cursor ? [...data.messages,...old.filter(m=>!data.messages.some(x=>x.id===m.id))] : data.messages);
      setBefore(data.nextBefore); setMore(data.hasMore);
      if (!cursor && data.messages.length && !document.hidden) { await social.request(`/groups/${encodeURIComponent(id)}/receipt`,'POST',{seq:data.messages.at(-1).seq}); await refreshGroups(); }
    } catch (e) { social.fail(e); }
  },[social.request,social.fail,refreshGroups,before]);
  useEffect(() => { refreshGroups(); },[refreshGroups]);
  useEffect(() => { setMessages([]); setBefore(null); setMore(false); if (selected) load(selected); },[selected]);
  useEffect(() => { const listener=e=>{ refreshGroups(); if(e.detail===selected) load(selected); }; window.addEventListener('consona-group-update',listener); return ()=>window.removeEventListener('consona-group-update',listener); },[selected,load,refreshGroups]);
  async function create(e) { e.preventDefault(); setBusy(true); try { const value=await social.request('/groups','POST',{name,members}); await refreshGroups(); setSelected(value.id); setName(''); setMembers([]); } catch(error) { social.fail(error); } finally { setBusy(false); } }
  async function send(e) { e.preventDefault(); const text=draft.trim(); if (!text) return; setBusy(true); try { await social.request(`/groups/${encodeURIComponent(selected)}/messages`,'POST',{text,clientId:crypto.randomUUID()}); setDraft(''); await load(selected); } catch(error) { social.fail(error); } finally { setBusy(false); } }
  async function changeMessage(message, remove) { try { const text=remove ? '' : window.prompt('Editar mensagem',message.text); if (!remove && text == null) return; if (remove && !window.confirm('Excluir esta mensagem para o grupo?')) return; await social.request(`/group-messages/${message.id}`,remove?'DELETE':'PUT',remove?undefined:{text}); await load(selected); } catch(error) { social.fail(error); } }
  return <div className="social-groups"><h2>Conversas em grupo</h2><form onSubmit={create}><label>Nome do grupo <input maxLength={80} required value={name} onChange={e=>setName(e.target.value)}/></label><fieldset><legend>Escolha pelo menos dois amigos</legend>{social.state.friends.map(friend=><label key={friend.id}><input type="checkbox" checked={members.includes(friend.id)} onChange={e=>setMembers(old=>e.target.checked?[...old,friend.id]:old.filter(id=>id!==friend.id))}/>{friend.displayName}</label>)}</fieldset><button disabled={busy || members.length<2}>Criar grupo</button></form>
    <nav aria-label="Seus grupos">{groups.map(group=><button key={group.id} aria-pressed={selected===group.id} onClick={()=>setSelected(group.id)}>{group.name}{group.unread>0 && ` (${group.unread})`}</button>)}</nav>
    {selected && <section aria-label="Mensagens do grupo"><h3>{groups.find(g=>g.id===selected)?.name}</h3>{more && <button onClick={()=>load(selected,before)}>Carregar anteriores</button>}<div className="social-group-messages" role="log">{messages.map(m=><article key={m.id}><strong>{m.senderName}</strong> <time>{new Date(m.createdAt).toLocaleString('pt-BR')}</time>{m.deletedAt ? <em>Mensagem excluída</em> : <><SafeText text={m.text}/>{m.editedAt && <small>Editada</small>}{m.senderId===user.id && <span><button onClick={()=>changeMessage(m,false)}>Editar</button><button onClick={()=>changeMessage(m,true)}>Excluir</button></span>}</>}</article>)}</div><form onSubmit={send}><textarea aria-label="Mensagem do grupo" maxLength={4000} value={draft} onChange={e=>setDraft(e.target.value)}/><button disabled={busy || !draft.trim()}>Enviar</button></form></section>}
  </div>;
}
