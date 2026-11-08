import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Disc3, FolderOpen, GripVertical, Play, Search, Trash2 } from 'lucide-react';
import { findAlbums, getAlbumDetails } from './import/musicLookup.js';
import './album-detail.css';

const languageNames = { eng: 'Inglês', por: 'Português', spa: 'Espanhol', jpn: 'Japonês', fra: 'Francês', deu: 'Alemão', ita: 'Italiano', kor: 'Coreano', und: 'Não determinado', mul: 'Vários idiomas' };
function releaseDate(value) {
  if (!value) return 'Não informada';
  const clean = String(value).trim();
  if (/^\d{4}$/.test(clean)) return clean;
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(clean)) {
    const [year, month, day] = clean.split('-');
    return day ? new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${year}-${month}-${day}T12:00:00Z`)) : `${month}/${year}`;
  }
  return clean.replace(/,\s*00:00$/, '');
}
function plainText(html) { return html ? new DOMParser().parseFromString(String(html), 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() || '' : ''; }
function Contributor({ person }) { return person ? <small className="contributor-badge">{person.avatar && <img src={person.avatar} alt=""/>}Adicionado por {person.displayName}</small> : null; }

function QuickTrack({ track, albums, onRefresh, apiRequest, onPlay, onOrder, index, total, onDrop }) {
  const [title, setTitle] = useState(track.title), [artist, setArtist] = useState(track.artist), [albumId, setAlbumId] = useState(track.primaryAlbumId || ''), [mode, setMode] = useState(track.coverMode || 'individual'), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(track.title); setArtist(track.artist); setAlbumId(track.primaryAlbumId || ''); setMode(track.coverMode || 'individual'); }, [track.title, track.artist, track.primaryAlbumId, track.coverMode]);
  async function save() {
    setBusy(true);
    try { await apiRequest(`/api/tracks/${track.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, artist, albumId, coverMode: mode }) }); await onRefresh(); setMessage('Salvo'); } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  return <article className="quick-album-track" draggable onDragStart={event => event.dataTransfer.setData('text/consona-order', track.id)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); onDrop(event.dataTransfer.getData('text/consona-order'), track.id); }}><GripVertical size={16}/><button className="quick-track-art" aria-label={`Reproduzir ${track.title}`} onClick={() => onPlay(track)}>{track.cover ? <img src={track.cover} alt=""/> : <Play size={18}/>}</button><div className="quick-track-fields"><input aria-label={`Nome de ${track.title}`} value={title} onChange={event => setTitle(event.target.value)}/><input aria-label={`Artista de ${track.title}`} value={artist} onChange={event => setArtist(event.target.value)}/><Contributor person={track.addedBy}/></div><select aria-label={`Álbum de ${track.title}`} value={albumId} onChange={event => setAlbumId(event.target.value)}><option value="">Sem álbum</option>{albums.map(album => <option key={album.id} value={album.id}>{album.title}</option>)}</select><select aria-label={`Capa de ${track.title}`} value={mode} onChange={event => setMode(event.target.value)}><option value="individual">Capa individual</option><option value="album">Capa do álbum</option></select><div className="quick-track-buttons"><button aria-label={`Subir ${track.title}`} disabled={index === 0} onClick={() => onOrder(-1)}><ArrowUp size={15}/></button><button aria-label={`Descer ${track.title}`} disabled={index === total - 1} onClick={() => onOrder(1)}><ArrowDown size={15}/></button><button aria-label={`Salvar ${track.title}`} disabled={busy || !title.trim() || !artist.trim()} onClick={save}><Check size={16}/></button></div>{message && <small className="quick-track-message" role="status">{message}</small>}</article>;
}

function AlbumDetail({ album, tracks, library, apiRequest, onRefresh, onSelect, onPlay, onPlayAlbum }) {
  const [details, setDetails] = useState(null), [loading, setLoading] = useState(true), [detailError, setDetailError] = useState('');
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [title, setTitle] = useState(album.title), [artist, setArtist] = useState(album.artist), [cover, setCover] = useState(album.cover || ''), [lookup, setLookup] = useState(null), [results, setResults] = useState([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setTitle(album.title); setArtist(album.artist); setCover(album.cover || ''); setLookup(null); setResults([]); setMessage(''); setConfirmDelete(false); }, [album.id]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setDetailError(''); setDetails(null); setDescriptionOpen(false);
    getAlbumDetails(album, apiRequest).then(value => { if (!cancelled) setDetails(value); }).catch(error => { if (!cancelled) setDetailError(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [album.id, album.title, album.artist, album.metadata?.releaseGroupId, album.metadata?.spotifyId]);
  async function saveAlbum() {
    setBusy(true);
    try {
      const body = { title, artist };
      if (cover !== album.cover) body.coverUrl = cover;
      if (lookup) body.metadata = { ...album.metadata, releaseGroupId: lookup.releaseGroupId || '', spotifyId: lookup.spotifyId || '', releaseYear: lookup.year || '', releaseYearSource: lookup.source || '', sourceUrl: lookup.sourceUrl || '' };
      await apiRequest(`/api/albums/${album.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await onRefresh(); setMessage('Álbum atualizado.');
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  async function searchCover() { setBusy(true); try { setResults(await findAlbums(title, artist, apiRequest)); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  async function order(from, to) {
    const ids = [...album.trackIds], index = ids.indexOf(from), destination = ids.indexOf(to); if (index < 0 || destination < 0 || index === destination) return;
    ids.splice(destination, 0, ...ids.splice(index, 1));
    try { await apiRequest(`/api/albums/${album.id}/tracks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackIds: ids }) }); await onRefresh(); } catch (error) { setMessage(error.message); }
  }
  async function remove() { setBusy(true); try { await apiRequest(`/api/albums/${album.id}`, { method: 'DELETE' }); await onRefresh(); onSelect(''); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  const description = plainText(details?.description);
  const visibleDescription = descriptionOpen || description.length <= 900 ? description : `${description.slice(0, 900).trim()}…`;
  const year = Number(String(details?.releaseDate || album.metadata?.releaseYear || '').slice(0, 4));
  return <>
    <button className="quick-back" onClick={() => onSelect('')}><ArrowLeft size={15}/>Todos os álbuns</button>
    <div className="album-profile">
      <aside className="album-profile-left">
        <div className="album-profile-art">{cover ? <img src={cover} alt={`Capa de ${album.title}`}/> : <Disc3 size={72}/>}</div>
        <button className="audio-select album-profile-play" onClick={() => onPlayAlbum(album)} disabled={!tracks.some(track => track.src)}><Play size={17} fill="currentColor"/>Reproduzir álbum completo</button>
        <div className="album-profile-tracklist"><h2>Faixas <span>{tracks.length}</span></h2>{tracks.map((track, index) => <button key={track.id} onClick={() => onPlay(track)} aria-label={`Reproduzir ${track.title}`}><span className="album-profile-track-number">{String(index + 1).padStart(2, '0')}</span><span className="album-profile-track-name"><strong>{track.title}</strong><small>{track.artist}</small></span><span className="album-profile-track-duration">{track.duration || '—'}</span><Play size={15}/></button>)}{!tracks.length && <p>Este álbum ainda não tem músicas.</p>}</div>
      </aside>
      <section className="album-profile-info">
        <div className="album-profile-title"><span>ÁLBUM</span><h2>{album.title}</h2><p>{year && year <= new Date().getFullYear() ? `${new Date().getFullYear() - year} anos desde o lançamento` : 'Data de lançamento não informada'}</p></div>
        <dl className="album-profile-facts">
          <div><dt>Artista</dt><dd>{album.artist || 'Não informado'}</dd></div>
          <div><dt>Lançamento</dt><dd>{releaseDate(details?.releaseDate || album.metadata?.releaseYear)}</dd></div>
          <div><dt>Gravação</dt><dd>{details?.recordedDate || 'Não informada'}</dd></div>
          <div><dt>Avaliação Last.fm</dt><dd>Indisponível pela API</dd></div>
          {details?.musicBrainzRating && <div><dt>Avaliação MusicBrainz</dt><dd>{details.musicBrainzRating} / 5 {details.musicBrainzRatingCount ? `· ${details.musicBrainzRatingCount} votos` : ''}</dd></div>}
          <div><dt>Rank Last.fm</dt><dd>{details?.rank ? `#${details.rank} entre álbuns do artista` : 'Não encontrado no ranking consultado'}</dd></div>
          <div><dt>Gêneros e tags</dt><dd>{details?.genres?.length ? <span className="album-profile-tags">{details.genres.map(genre => <span key={genre}>{genre}</span>)}</span> : 'Não informados'}</dd></div>
          <div><dt>Idioma</dt><dd>{details?.language ? languageNames[details.language] || details.language : 'Não informado'}</dd></div>
          {(details?.listeners || details?.playcount) ? <div><dt>Last.fm</dt><dd>{details.listeners ? `${details.listeners.toLocaleString('pt-BR')} ouvintes` : ''}{details.listeners && details.playcount ? ' · ' : ''}{details.playcount ? `${details.playcount.toLocaleString('pt-BR')} reproduções` : ''}</dd></div> : null}
        </dl>
        <div className="album-profile-description"><h3>Sobre o álbum</h3>{loading ? <p>Buscando informações do álbum…</p> : <p>{visibleDescription || 'Descrição não disponível nas fontes conectadas.'}</p>}{description.length > 900 && <button onClick={() => setDescriptionOpen(value => !value)}>{descriptionOpen ? 'Mostrar menos' : 'Ler descrição completa'}</button>}{detailError && <small>Não foi possível atualizar os dados externos: {detailError}</small>}</div>
        <Contributor person={album.addedBy}/>
      </section>
    </div>
    <details className="album-profile-edit"><summary>Editar álbum e faixas</summary><div className="quick-album-editor"><div className="quick-album-cover">{cover ? <img src={cover} alt=""/> : <Disc3 size={45}/>}</div><label>Nome do álbum<input value={title} onChange={event => setTitle(event.target.value)}/></label><label>Artista<input value={artist} onChange={event => setArtist(event.target.value)}/></label><div className="quick-album-editor-buttons"><button className="audio-select" disabled={busy || !title.trim()} onClick={saveAlbum}><Check size={15}/>Salvar alterações</button><button disabled={busy} onClick={searchCover}><Search size={15}/>Buscar capa</button><button onClick={() => setConfirmDelete(true)}><Trash2 size={14}/>Excluir álbum</button></div></div>{!!results.length && <div className="quick-cover-results">{results.map(item => <button key={item.releaseGroupId || item.spotifyId} onClick={() => { setCover(item.coverUrl || cover); setTitle(item.title); setArtist(item.artist); setLookup(item); setResults([]); }}><span>{item.coverUrl ? <img src={item.coverUrl} alt=""/> : <Disc3 size={26}/>}</span><strong>{item.title}</strong><small>{item.artist} · {item.year || 'Sem ano'}</small></button>)}</div>}{confirmDelete && <div className="organizer-confirm"><strong>Excluir este álbum? As músicas continuam na biblioteca.</strong><button onClick={() => setConfirmDelete(false)}>Cancelar</button><button disabled={busy} onClick={remove}>Excluir álbum</button></div>}{message && <p role="status" className="organizer-message">{message}</p>}<div className="quick-album-track-list">{tracks.map((track, index) => <QuickTrack key={track.id} track={track} albums={library.albums} apiRequest={apiRequest} onRefresh={onRefresh} onPlay={onPlay} index={index} total={tracks.length} onOrder={direction => order(track.id, tracks[index + direction]?.id)} onDrop={order}/>)}</div></details>
  </>;
}

export default function QuickAlbums({ library, selectedId, onSelect, apiRequest, onLibraryChange, onPlayAlbum, onOpenWorkspace }) {
  const active = library.albums.find(album => album.id === selectedId);
  const tracks = (active?.trackIds || []).map(id => library.tracks.find(track => track.id === id)).filter(Boolean);
  const refresh = async () => onLibraryChange(await apiRequest('/api/library'));
  return <main className="albums-page quick-albums"><div className="collection-heading"><div><span className="collection-icon"><Disc3/></span><div><h1>{active?.title || 'Álbuns'}</h1><p>{active ? `${tracks.length} faixas na biblioteca` : 'Seus álbuns, prontos para ouvir e explorar.'}</p></div></div><button className="audio-select" onClick={onOpenWorkspace}><FolderOpen size={16}/>Organizar em lote</button></div>
    {active ? <AlbumDetail key={active.id} album={active} tracks={tracks} library={library} apiRequest={apiRequest} onRefresh={refresh} onSelect={onSelect} onPlay={track => onPlayAlbum(active, track.id)} onPlayAlbum={onPlayAlbum}/> : <div className="album-grid">{library.albums.map(album => <button className="playlist-tile" key={album.id} onClick={() => onSelect(album.id)}><span className="playlist-tile-art" style={album.cover ? { backgroundImage: `url("${album.cover}")` } : undefined}>{!album.cover && <Disc3 size={30}/>}</span><strong>{album.title}</strong><small>{album.artist || 'Vários artistas'} · {album.trackIds.length} músicas</small>{album.metadata?.releaseYear && <small>{album.metadata.releaseYear}</small>}<Contributor person={album.addedBy}/></button>)}{!library.albums.length && <div className="collection-empty">Crie seus álbuns na Área de Organização em Configurações.</div>}</div>}
  </main>;
}
