import React, { useState } from 'react';
import { ListMusic, Plus, Settings, X } from 'lucide-react';
import ImportWorkspace from './import/ImportWorkspace.jsx';

export default function SettingsPage({ userId, library, apiRequest, readTags, readDuration, onLibraryChange }) {
  const [tab, setTab] = useState('organizer'), [name, setName] = useState(''), [selection, setSelection] = useState([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  async function createPlaylist(event) {
    event.preventDefault(); setBusy(true);
    try { await apiRequest('/api/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, trackIds: selection }) }); onLibraryChange(await apiRequest('/api/library')); setName(''); setSelection([]); setMessage('Playlist criada.'); }
    catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  async function removePlaylist(id) {
    try { await apiRequest(`/api/playlists/${id}`, { method: 'DELETE' }); onLibraryChange(await apiRequest('/api/library')); setMessage('Playlist removida.'); } catch (error) { setMessage(error.message); }
  }
  return <main className="settings-page organizer-settings"><div className="settings-title"><span><Settings size={23}/></span><div><h1>Configurações</h1><p>Organize e configure músicas, álbuns e playlists da sua biblioteca.</p></div></div><div className="settings-tabs"><button className={tab === 'organizer' ? 'active' : ''} onClick={() => setTab('organizer')}><Plus size={15}/>Músicas e álbuns em lote</button><button className={tab === 'playlists' ? 'active' : ''} onClick={() => setTab('playlists')}><ListMusic size={15}/>Playlists</button></div>
    <div hidden={tab !== 'organizer'}><ImportWorkspace userId={userId} library={library} apiRequest={apiRequest} readTags={readTags} readDuration={readDuration} onLibraryChange={onLibraryChange}/></div>
    {tab === 'playlists' && <div className="playlist-form-panel"><form onSubmit={createPlaylist}><label>Nome da playlist<input value={name} onChange={event => setName(event.target.value)} required/></label><p>Selecione as músicas para incluir.</p><div className="playlist-select-list">{library.tracks.map(track => <label key={track.id}><input type="checkbox" checked={selection.includes(track.id)} onChange={event => setSelection(value => event.target.checked ? [...value, track.id] : value.filter(id => id !== track.id))}/><span>{track.title}<small>{track.artist}</small></span></label>)}</div><button className="save-track" disabled={busy}><Plus size={16}/>Criar playlist</button></form><div className="settings-playlist-list"><h3>Suas playlists</h3>{library.playlists.map(list => <div key={list.id}><span><ListMusic size={17}/>{list.name}</span><button onClick={() => removePlaylist(list.id)} aria-label={`Excluir playlist ${list.name}`}><X size={15}/></button></div>)}</div>{message && <p role="status">{message}</p>}</div>}
  </main>;
}
