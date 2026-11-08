import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, Check, Disc3, FolderOpen, GripVertical, Library, ListOrdered, LoaderCircle, Music2, Plus, Redo2, Save, Search, Undo2, Upload, WandSparkles, X } from 'lucide-react';
import { clearDraftAssets, getAsset, loadDraft, persistDraft, putAsset } from './draftStore.js';
import { filenameMetadata, groupDetected, historyReducer, moveTracks, newDraft, normalize, orderAlbumTracks, validateDraft } from './model.js';
import { findAlbums, getAlbumTracklist, identifyTrack } from './musicLookup.js';

function Cover({ fileKey, url, title = '' }) {
  const [local, setLocal] = useState('');
  useEffect(() => {
    let disposed = false, objectUrl;
    setLocal('');
    if (fileKey) getAsset(fileKey).then(blob => { if (blob && !disposed) { objectUrl = URL.createObjectURL(blob); setLocal(objectUrl); } }).catch(() => {});
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [fileKey]);
  return <span className="organizer-cover">{local || url ? <img src={local || url} alt={title} onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/>:<Disc3 size={24}/>}</span>;
}
function SpotifyMark() { return <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1ed760"/><path d="M5 8c4.5-1.5 10-1.2 14 1M6 12c4-1.1 8.7-.7 12 1.2M7 16c3.2-.7 6.7-.4 9.5 1" fill="none" stroke="#103923" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
const jsonOptions = value => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });

export default function ImportWorkspace({ userId, library, apiRequest, readTags, readDuration, onLibraryChange }) {
  const [history, dispatch] = useReducer(historyReducer, null, () => ({ past: [], present: newDraft(), future: [], lastKey: '' }));
  const draft = history.present, latest = useRef(draft);
  latest.current = draft;
  const [ready, setReady] = useState(false), [draftStatus, setDraftStatus] = useState('Carregando rascunho…');
  const [selected, setSelected] = useState([]), [message, setMessage] = useState(''), [job, setJob] = useState('');
  const [review, setReview] = useState(false), [acknowledged, setAcknowledged] = useState(false), [discard, setDiscard] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false), [catalogQuery, setCatalogQuery] = useState(''), [catalogAlbums, setCatalogAlbums] = useState(false);
  const [albumResults, setAlbumResults] = useState({}), [rowStatus, setRowStatus] = useState({}), [albumBusy, setAlbumBusy] = useState('');
  const [albumFeedback, setAlbumFeedback] = useState({});
  const [dropTarget, setDropTarget] = useState(null);
  const fileInput = useRef(null), folderInput = useRef(null), lastSelected = useRef(null), cancelSearch = useRef(false), mounted = useRef(true);
  const reviewRef = useRef(null);
  const change = (value, coalesce) => { setAcknowledged(false); dispatch({ type: 'change', value, coalesce }); };
  const patchRow = (key, values, field) => change(value => ({ ...value, tracks: value.tracks.map(row => row.key === key ? { ...row, ...values } : row) }), field && `${key}:${field}`);
  const patchAlbum = (key, values, field) => change(value => ({ ...value, albums: value.albums.map(album => album.key === key ? { ...album, ...values } : album) }), field && `${key}:${field}`);

  useEffect(() => {
    mounted.current = true;
    loadDraft(userId).then(saved => { if (mounted.current) { if (saved?.version === 1 && saved.batchId) dispatch({ type: 'restore', value: saved }); setReady(true); setDraftStatus('Rascunho salvo neste dispositivo'); } }).catch(() => { if (mounted.current) { setReady(true); setDraftStatus('Não foi possível abrir o rascunho local.'); } });
    return () => { mounted.current = false; cancelSearch.current = true; };
  }, [userId]);
  useEffect(() => {
    if (!ready) return;
    setDraftStatus('Salvando rascunho…');
    // Only metadata is rewritten here; audio and image blobs live in a separate store.
    persistDraft(userId, draft).then(() => { if (mounted.current) setDraftStatus('Rascunho salvo neste dispositivo'); }).catch(() => { if (mounted.current) setDraftStatus('Sem espaço para salvar o rascunho. Mantenha esta página aberta.'); });
  }, [draft, ready, userId]);
  useEffect(() => { setSelected(keys => keys.filter(key => draft.tracks.some(row => row.key === key))); }, [draft.tracks]);
  useEffect(() => { if (review) reviewRef.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, [review]);
  const issues = useMemo(() => validateDraft(draft, library.tracks), [draft, library.tracks]);
  const errors = issues.filter(item => item.severity === 'error'), warnings = issues.filter(item => item.severity === 'warning');

  async function addFiles(files, albumKey = '') {
    const accepted = Array.from(files || []).filter(file => /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(file.name));
    if (!accepted.length) { setMessage('Selecione arquivos de áudio compatíveis.'); return; }
    if (draft.tracks.length + accepted.length > 500) { setMessage('Organize até 500 músicas por lote.'); return; }
    let working = latest.current;
    setJob('Preparando arquivos…'); setMessage('');
    try {
      for (let i = 0; i < accepted.length; i++) {
        const file = accepted[i];
        if (!file.size || file.size > 32 * 1024 * 1024) throw new Error(`“${file.name}” precisa ter entre 1 byte e 32 MB.`);
        setJob(`Preparando ${i + 1} de ${accepted.length}…`);
        const key = crypto.randomUUID(), prefix = `${userId}:${working.batchId}:${key}`;
        const fileKey = `${prefix}:audio`;
        await putAsset(fileKey, file);
        const tags = await readTags(file).catch(() => ({}));
        const duration = await readDuration(file);
        const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        const fileHash = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        let coverFileKey = '';
        if (tags.picture?.data?.length) { coverFileKey = `${prefix}:cover`; await putAsset(coverFileKey, new Blob([tags.picture.data], { type: tags.picture.type })); }
        const guessed = filenameMetadata(file);
        const row = { ...guessed, key, filename: file.name, fileKey, fileHash, coverFileKey, coverUrl: '', title: tags.title || guessed.title, artist: tags.artist || guessed.artist, albumHint: tags.album || guessed.albumHint, albumArtistHint: tags.albumartist || tags.artist || guessed.artist, albumKey, coverMode: albumKey ? 'album' : 'individual', duration, trackNo: tags.trackNo || 0, metadata: { id3: { year: tags.year || '', genres: tags.genre || [], track: tags.trackNo || 0 } } };
        working = { ...working, tracks: [...working.tracks, row] };
        await persistDraft(userId, working);
      }
      setMessage(`${accepted.length} arquivos preparados. Revise os nomes e arraste para os álbuns.`);
    } catch (error) { setMessage(error.message); }
    finally { if (mounted.current) { change(working); setJob(''); } }
  }
  function addAlbum() {
    const album = { key: crypto.randomUUID(), title: '', artist: '', coverUrl: '', coverFileKey: '', existingId: '' };
    change(value => ({ ...value, albums: [...value.albums, album] }));
  }
  function catalogRow(track, albumKey = '') {
    return { key: `existing:${track.id}`, existingId: track.id, title: track.title, artist: track.artist, filename: 'Música da biblioteca', albumHint: track.album, albumKey, coverMode: track.coverMode || 'individual', coverUrl: track.individualCover || track.cover || '', duration: track.seconds, fileHash: track.fileHash || '', metadata: track.metadata || {} };
  }
  function addExistingAlbum(album) {
    if (draft.albums.some(item => item.existingId === album.id)) return;
    const card = { key: crypto.randomUUID(), existingId: album.id, title: album.title, artist: album.artist, coverUrl: album.cover, initialTitle: album.title, initialArtist: album.artist, initialCover: album.cover, releaseGroupId: album.metadata?.releaseGroupId || '', spotifyId: album.metadata?.spotifyId || '', releaseYear: album.metadata?.releaseYear || '', releaseYearSource: album.metadata?.releaseYearSource || '', sourceUrl: album.metadata?.sourceUrl || '' };
    const missing = (album.trackIds || []).filter(id => !draft.tracks.some(row => row.existingId === id)).map(id => library.tracks.find(track => track.id === id)).filter(Boolean).map(track => catalogRow(track, card.key));
    change(value => ({ ...value, albums: [...value.albums, card], tracks: [...value.tracks, ...missing] }));
    setCatalogAlbums(false);
  }
  function toggleSelection(row, event = {}) {
    if (event.shiftKey && lastSelected.current) {
      const from = draft.tracks.findIndex(item => item.key === lastSelected.current), to = draft.tracks.findIndex(item => item.key === row.key);
      if (from >= 0 && to >= 0) { const keys = draft.tracks.slice(Math.min(from, to), Math.max(from, to) + 1).map(item => item.key); setSelected(value => [...new Set([...value, ...keys])]); }
    } else setSelected(value => value.includes(row.key) ? value.filter(key => key !== row.key) : [...value, row.key]);
    lastSelected.current = row.key;
  }
  function move(keys, albumKey, beforeKey = '') { change(value => moveTracks(value, keys, albumKey === '__pool' ? '' : albumKey, beforeKey)); setDropTarget(null); }
  function drop(event, albumKey, beforeKey = '') {
    event.preventDefault(); event.stopPropagation(); setDropTarget(null);
    if (job) return;
    const payload = event.dataTransfer.getData('application/x-consona-tracks');
    if (payload) { try { move(JSON.parse(payload), albumKey, beforeKey); } catch {} }
    else if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files, albumKey);
  }
  async function setCoverFile(album, file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024 || !/^image\/(jpeg|png|webp|avif)$/.test(file.type)) { setMessage('Escolha uma capa JPG, PNG, WebP ou AVIF de até 5 MB.'); return; }
    try { const key = `${userId}:${draft.batchId}:${crypto.randomUUID()}:album-cover`; await putAsset(key, file); patchAlbum(album.key, { coverFileKey: key, uploadedCoverId: '' }); } catch { setMessage('Não foi possível guardar a imagem no rascunho.'); }
  }
  async function setIndividualCover(row, file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024 || !/^image\/(jpeg|png|webp|avif)$/.test(file.type)) { setMessage('Escolha uma capa JPG, PNG, WebP ou AVIF de até 5 MB.'); return; }
    try { const key = `${userId}:${draft.batchId}:${crypto.randomUUID()}:individual-cover`; await putAsset(key, file); patchRow(row.key, { coverFileKey: key, coverDirty: true, uploadedIndividualCoverId: '', coverMode: 'individual' }); }
    catch { setMessage('Não foi possível guardar a capa individual no rascunho.'); }
  }
  async function identify(keys) {
    cancelSearch.current = false; setMessage('');
    const rows = draft.tracks.filter(row => keys.includes(row.key));
    for (let i = 0; i < rows.length; i++) {
      if (cancelSearch.current) break;
      const row = rows[i]; setJob(`Identificando ${i + 1} de ${rows.length}…`); setRowStatus(value => ({ ...value, [row.key]: 'Buscando dados…' }));
      try { const suggestions = await identifyTrack(row, apiRequest); patchRow(row.key, { suggestions, matchConflict: normalize(suggestions[0].title) !== normalize(row.title) || (row.artist && normalize(suggestions[0].artist) !== normalize(row.artist)) }); setRowStatus(value => ({ ...value, [row.key]: 'Revise a correspondência' })); }
      catch (error) { setRowStatus(value => ({ ...value, [row.key]: error.message })); }
    }
    if (mounted.current) { setJob(''); setMessage('Busca concluída. Aplique as sugestões desejadas e use “Agrupar detectados”.'); }
  }
  function applySuggestion(row, item) {
    patchRow(row.key, { title: item.title, artist: item.artist, albumHint: item.album || row.albumHint, albumArtistHint: item.artist, duration: row.duration || item.duration, releaseGroupId: item.releaseGroupId, suggestedCover: item.releaseGroupId ? `https://coverartarchive.org/release-group/${item.releaseGroupId}/front-500` : '', suggestions: [], matchConflict: false, metadata: { ...row.metadata, identification: item } });
    setRowStatus(value => ({ ...value, [row.key]: 'Dados aplicados' }));
  }
  async function searchAlbum(album) {
    if (!album.title.trim()) { setMessage('Informe o nome do álbum antes de buscar a capa.'); return; }
    setAlbumBusy(album.key);
    try { const results = await findAlbums(album.title, album.artist, apiRequest); setAlbumResults(value => ({ ...value, [album.key]: results })); setAlbumFeedback(value => ({ ...value, [album.key]: results.length ? 'Escolha a edição correta. O ano e a capa serão aplicados juntos.' : 'Nenhuma opção encontrada. Confira o nome e tente novamente.' })); }
    catch (error) { setMessage(error.message); }
    finally { setAlbumBusy(''); }
  }
  async function sortAlbum(album) {
    const rows = latest.current.tracks.filter(row => row.albumKey === album.key);
    if (rows.length < 2) return;
    setAlbumBusy(album.key);
    const sortFromTags = () => {
      const tagged = orderAlbumTracks(latest.current, album.key, []);
      if (!tagged.matched) return false;
      change(value => orderAlbumTracks(value, album.key, []).draft);
      setAlbumFeedback(value => ({ ...value, [album.key]: `${tagged.matched} de ${tagged.total} faixas ordenadas pelos números gravados nos arquivos. Revise a sequência antes de salvar.` }));
      return true;
    };
    try {
      let chosen = album;
      if (!chosen.releaseGroupId && !chosen.spotifyId) {
        const results = await findAlbums(album.title, album.artist, apiRequest);
        if (!results.length) { if (!sortFromTags()) setAlbumFeedback(value => ({ ...value, [album.key]: 'Não encontrei a edição nem números de faixa nos arquivos. Revise o nome do álbum.' })); return; }
        if (results[0].matchScore < .88) { setAlbumResults(value => ({ ...value, [album.key]: results })); setAlbumFeedback(value => ({ ...value, [album.key]: 'Escolha o álbum correto antes de ordenar as faixas.' })); return; }
        chosen = results[0];
        patchAlbum(album.key, { title: chosen.title, artist: chosen.artist, coverUrl: album.coverUrl || chosen.coverUrl, releaseGroupId: chosen.releaseGroupId || '', spotifyId: chosen.spotifyId || '', releaseYear: chosen.year || '', releaseYearSource: chosen.source, sourceUrl: chosen.sourceUrl || '' });
      }
      const listing = await getAlbumTracklist(chosen, apiRequest, rows.map(row => row.title));
      const result = orderAlbumTracks(latest.current, album.key, listing.tracks);
      if (!result.matched) { if (!sortFromTags()) setAlbumFeedback(value => ({ ...value, [album.key]: 'A edição foi encontrada, mas nenhuma faixa correspondeu. Revise nomes ou escolha outra edição.' })); return; }
      change(value => orderAlbumTracks(value, album.key, listing.tracks).draft);
      setAlbumFeedback(value => ({ ...value, [album.key]: `${result.matched} de ${result.total} faixas ordenadas pela edição do ${listing.source}. ${result.matched < result.total ? 'As demais foram mantidas no fim para revisão.' : ''}` }));
    } catch (error) { if (!sortFromTags()) setAlbumFeedback(value => ({ ...value, [album.key]: error.message })); }
    finally { setAlbumBusy(''); }
  }
  async function save() {
    if (errors.length || (warnings.length && !acknowledged)) return;
    let working = latest.current;
    setJob('Iniciando envio…'); setMessage('');
    try {
      for (let index = 0; index < working.albums.length; index++) {
        const album = working.albums[index];
        if (album.coverFileKey && !album.uploadedCoverId) {
          const cover = await getAsset(album.coverFileKey); if (!cover) throw new Error(`Selecione novamente a capa de “${album.title}”.`);
          const data = new FormData(); data.set('batchId', working.batchId); data.set('itemKey', album.coverFileKey); data.set('cover', cover, 'album-cover');
          const result = await apiRequest('/api/import/covers', { method: 'POST', body: data });
          working = { ...working, albums: working.albums.map(item => item.key === album.key ? { ...item, uploadedCoverId: result.id } : item) };
          await persistDraft(userId, working); dispatch({ type: 'restore', value: working });
        }
      }
      for (let index = 0; index < working.tracks.length; index++) {
        let row = working.tracks[index];
        if (row.coverDirty && row.coverFileKey && !row.uploadedIndividualCoverId) {
          const cover = await getAsset(row.coverFileKey); if (!cover) throw new Error(`Selecione novamente a capa individual de “${row.title}”.`);
          const data = new FormData(); data.set('batchId', working.batchId); data.set('itemKey', row.coverFileKey); data.set('cover', cover, 'individual-cover');
          const result = await apiRequest('/api/import/covers', { method: 'POST', body: data });
          row = { ...row, uploadedIndividualCoverId: result.id };
          working = { ...working, tracks: working.tracks.map(item => item.key === row.key ? row : item) };
          await persistDraft(userId, working); dispatch({ type: 'restore', value: working });
        }
        if (row.existingId || row.uploadedId) continue;
        setJob(`Enviando música ${index + 1} de ${working.tracks.length}…`);
        const file = await getAsset(row.fileKey); if (!file) throw new Error(`O arquivo de “${row.title}” não está mais no rascunho. Selecione-o novamente.`);
        const album = working.albums.find(item => item.key === row.albumKey);
        const data = new FormData(); data.set('batchId', working.batchId); data.set('itemKey', row.key); data.set('fileHash', row.fileHash || ''); data.set('title', row.title); data.set('artist', row.artist); data.set('album', album.title); data.set('duration', String(row.duration || 0)); data.set('audio', file, row.filename); data.set('metadata', JSON.stringify(row.metadata || {}));
        if (row.coverFileKey && !row.uploadedIndividualCoverId) { const cover = await getAsset(row.coverFileKey); if (cover) data.set('cover', cover, 'individual-cover'); }
        if (row.coverUrl) data.set('coverUrl', row.coverUrl);
        const result = await apiRequest('/api/import/tracks', { method: 'POST', body: data });
        working = { ...working, tracks: working.tracks.map(item => item.key === row.key ? { ...item, uploadedId: result.id } : item) };
        await persistDraft(userId, working); dispatch({ type: 'restore', value: working });
      }
      setJob('Salvando organização…');
      const payload = { batchId: working.batchId, albums: working.albums.map(({ key, existingId, title, artist, coverUrl, uploadedCoverId, releaseGroupId, spotifyId, releaseYear, releaseYearSource, sourceUrl, initialTitle, initialArtist, initialCover }) => ({ key, existingId, title, artist, coverUrl: uploadedCoverId ? '' : coverUrl, coverAssetId: uploadedCoverId, releaseGroupId, spotifyId, releaseYear, releaseYearSource, sourceUrl, initialTitle, initialArtist, initialCover })), tracks: working.tracks.map(row => ({ id: row.existingId || row.uploadedId, albumKey: row.albumKey, title: row.title, artist: row.artist, coverMode: row.coverMode || 'album', identification: row.metadata?.identification || null, coverAssetId: row.uploadedIndividualCoverId || '' })) };
      await apiRequest('/api/import/commit', { method: 'POST', ...jsonOptions(payload) });
      const next = newDraft(); await persistDraft(userId, next); dispatch({ type: 'restore', value: next });
      await clearDraftAssets(userId, working.batchId);
      setReview(false); setSelected([]); setMessage(`${working.tracks.length} músicas e ${working.albums.length} álbuns salvos. Sua biblioteca foi atualizada.`);
      await onLibraryChange(await apiRequest('/api/library'));
    } catch (error) { setMessage(`O envio foi pausado: ${error.message} Seu rascunho foi mantido. Revise e tente salvar novamente para retomar.`); }
    finally { setJob(''); }
  }
  async function discardDraft() {
    setJob('Descartando rascunho…');
    try { await apiRequest(`/api/import/batches/${draft.batchId}`, { method: 'DELETE' }); const next = newDraft(); await persistDraft(userId, next); await clearDraftAssets(userId, draft.batchId); dispatch({ type: 'restore', value: next }); setDiscard(false); setReview(false); setMessage('Rascunho descartado.'); }
    catch (error) { setMessage(error.message); }
    finally { setJob(''); }
  }

  function renderTrack(row, album) {
    const inherited = row.coverMode === 'album' && album;
    return <article className={`organizer-track ${selected.includes(row.key) ? 'is-selected' : ''}`} key={row.key} draggable={!job} onDragStart={event => { event.dataTransfer.setData('application/x-consona-tracks', JSON.stringify(selected.includes(row.key) ? selected : [row.key])); event.dataTransfer.effectAllowed = 'move'; }} onDragOver={event => { event.preventDefault(); event.stopPropagation(); }} onDrop={event => drop(event, album?.key || '', row.key)}>
      <div className="organizer-track-head"><input type="checkbox" aria-label={`Selecionar ${row.title}`} checked={selected.includes(row.key)} onChange={event => toggleSelection(row, event.nativeEvent)}/><GripVertical size={15}/><span onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey) toggleSelection(row, event); }} title={row.filename}>{row.filename}</span><button type="button" disabled={!!job} aria-label={`Remover ${row.title} do rascunho`} onClick={() => change(value => ({ ...value, tracks: value.tracks.filter(item => item.key !== row.key) }))}><X size={14}/></button></div>
      <div className="organizer-track-fields"><Cover fileKey={inherited ? album.coverFileKey : row.coverFileKey} url={inherited ? album.coverUrl : row.coverUrl}/><div><input aria-label={`Nome da música ${row.filename}`} value={row.title} disabled={!!job} placeholder="Nome da música" onChange={event => patchRow(row.key, { title: event.target.value }, 'title')}/><input aria-label={`Artista da música ${row.filename}`} value={row.artist} disabled={!!job} placeholder="Nome do artista" onChange={event => patchRow(row.key, { artist: event.target.value }, 'artist')}/></div></div>
      <div className="organizer-track-actions"><button type="button" disabled={!!job} onClick={() => identify([row.key])}><WandSparkles size={13}/>Identificar</button><select aria-label={`Mover ${row.title} para álbum`} disabled={!!job} value={row.albumKey || ''} onChange={event => move([row.key], event.target.value)}><option value="">Sem álbum</option>{draft.albums.map(item => <option key={item.key} value={item.key}>{item.title || 'Álbum sem nome'}</option>)}</select><button type="button" disabled={!!job} aria-label={`Subir ${row.title}`} onClick={() => { const rows = draft.tracks.filter(item => item.albumKey === row.albumKey); const index = rows.findIndex(item => item.key === row.key); if (index > 0) move([row.key], row.albumKey, rows[index - 1].key); }}><ArrowUp size={13}/></button><button type="button" disabled={!!job} aria-label={`Descer ${row.title}`} onClick={() => { const rows = draft.tracks.filter(item => item.albumKey === row.albumKey); const index = rows.findIndex(item => item.key === row.key); if (index < rows.length - 1) { const next = rows[index + 2]; if (next) move([row.key], row.albumKey, next.key); else move([row.key], row.albumKey); } }}><ArrowDown size={13}/></button></div>
      {album && <label className="organizer-inheritance">Capa<select disabled={!!job} value={row.coverMode || 'album'} onChange={event => patchRow(row.key, { coverMode: event.target.value })}><option value="album">Herdar do álbum</option><option value="individual">Usar capa individual</option></select></label>}
      <label className="organizer-individual-upload"><Upload size={11}/>Escolher capa individual<input type="file" accept="image/png,image/jpeg,image/webp,image/avif" disabled={!!job} onChange={event => setIndividualCover(row, event.target.files?.[0])}/></label>
      {row.albumHint && !album && <small className="organizer-hint">Álbum detectado: {row.albumHint}</small>}
      {rowStatus[row.key] && <small className="organizer-hint" role="status">{rowStatus[row.key]}</small>}
      {!!row.suggestions?.length && <details className="organizer-suggestions" open><summary>{row.suggestions.length} correspondências · revisar</summary>{row.suggestions.map((item, index) => <div key={index}><strong>{item.title}</strong><span>{item.artist} · {item.album || 'Álbum não identificado'}</span><small>{item.source} · {item.year || 'Ano não informado'}</small><button type="button" disabled={!!job} onClick={() => applySuggestion(row, item)}>Usar dados</button></div>)}<button type="button" disabled={!!job} onClick={() => patchRow(row.key, { suggestions: [], matchConflict: false })}>Manter dados manuais</button></details>}
    </article>;
  }
  if (!ready) return <div className="organizer-loading"><LoaderCircle size={18}/>{draftStatus}</div>;
  return <section className="import-organizer" aria-labelledby="organizer-title">
    <header className="organizer-intro"><div><h2 id="organizer-title"><FolderOpen size={23}/>Área de Organização</h2><p>Prepare músicas e álbuns, arraste para organizar e salve tudo quando estiver pronto.</p></div><span className="organizer-draft-status"><Save size={13}/>{draftStatus}</span></header>
    <input className="hidden-input" ref={fileInput} type="file" multiple accept="audio/*,.mp3,.flac,.m4a,.ogg,.wav" onChange={event => { addFiles(event.target.files); event.target.value = ''; }}/><input className="hidden-input" ref={folderInput} type="file" multiple webkitdirectory="true" onChange={event => { addFiles(event.target.files); event.target.value = ''; }}/>
    <div className="organizer-toolbar"><button disabled={!!job} onClick={() => fileInput.current.click()}><Upload size={15}/>Adicionar MP3s</button><button disabled={!!job} onClick={() => folderInput.current.click()}><FolderOpen size={15}/>Selecionar pasta</button><button disabled={!!job} onClick={addAlbum}><Plus size={15}/>Novo álbum</button><button disabled={!!job} onClick={() => setCatalogAlbums(value => !value)}><Disc3 size={15}/>Álbum existente</button><button disabled={!!job} onClick={() => setShowCatalog(value => !value)}><Library size={15}/>Músicas existentes</button><span className="organizer-toolbar-spacer"/><button disabled={!!job || !history.past.length} onClick={() => dispatch({ type: 'undo' })} aria-label="Desfazer organização"><Undo2 size={16}/></button><button disabled={!!job || !history.future.length} onClick={() => dispatch({ type: 'redo' })} aria-label="Refazer organização"><Redo2 size={16}/></button></div>
    {(catalogAlbums || showCatalog) && <div className="organizer-catalog"><header><strong>{catalogAlbums ? 'Adicionar um álbum à área de organização' : 'Adicionar músicas da biblioteca ao rascunho'}</strong><button onClick={() => { setCatalogAlbums(false); setShowCatalog(false); }} aria-label="Fechar catálogo"><X size={17}/></button></header><input placeholder="Filtrar por nome ou artista" value={catalogQuery} onChange={event => setCatalogQuery(event.target.value)}/><div>{catalogAlbums ? library.albums.filter(album => normalize(`${album.title} ${album.artist}`).includes(normalize(catalogQuery))).map(album => <button key={album.id} disabled={draft.albums.some(item => item.existingId === album.id)} onClick={() => addExistingAlbum(album)}><Cover url={album.cover}/><span>{album.title}<small>{album.artist}</small></span><Plus size={14}/></button>) : library.tracks.filter(track => normalize(`${track.title} ${track.artist}`).includes(normalize(catalogQuery))).map(track => <button key={track.id} disabled={draft.tracks.some(row => row.existingId === track.id)} onClick={() => change(value => ({ ...value, tracks: [...value.tracks, catalogRow(track)] }))}><Cover url={track.cover}/><span>{track.title}<small>{track.artist}</small></span><Plus size={14}/></button>)}</div></div>}
    <div className="organizer-batch-actions"><label><input type="checkbox" checked={!!draft.tracks.length && selected.length === draft.tracks.length} onChange={event => setSelected(event.target.checked ? draft.tracks.map(row => row.key) : [])}/>{selected.length ? `${selected.length} selecionadas` : 'Selecionar músicas'}</label><select aria-label="Mover seleção para álbum" disabled={!!job || !selected.length} value="" onChange={event => { move(selected, event.target.value); }}><option value="" disabled>Mover seleção para…</option><option value="__pool">Sem álbum</option>{draft.albums.map(album => <option value={album.key} key={album.key}>{album.title || 'Álbum sem nome'}</option>)}</select><button disabled={!!job || !draft.tracks.length} onClick={() => identify(selected.length ? selected : draft.tracks.map(row => row.key))}><WandSparkles size={14}/>Identificar {selected.length ? 'seleção' : 'todas'}</button><button disabled={!!job || !draft.tracks.some(row => row.albumHint && !row.albumKey)} onClick={() => change(value => groupDetected(value))}><Disc3 size={14}/>Agrupar detectados</button></div>
    {job && <div className="organizer-progress" role="status"><LoaderCircle className="organizer-spinner" size={17}/>{job}{job.startsWith('Identificando') && <button onClick={() => { cancelSearch.current = true; }}>Interromper busca</button>}</div>}
    {message && <div className="organizer-message" role="status">{message}</div>}
    <div className="organizer-board">
      <section className={`organizer-pool organizer-column ${dropTarget === '' ? 'is-drop-target' : ''}`} onDragOver={event => { event.preventDefault(); setDropTarget(''); }} onDrop={event => drop(event, '')}><header><Music2 size={19}/><div><h3>Músicas para organizar</h3><small>Solte arquivos aqui ou selecione MP3s</small></div><button disabled={!!job} onClick={() => fileInput.current.click()} aria-label="Adicionar arquivos ao rascunho"><Plus size={18}/></button></header><div className="organizer-column-tracks">{draft.tracks.filter(row => !row.albumKey).map(row => renderTrack(row))}{!draft.tracks.some(row => !row.albumKey) && <div className="organizer-empty"><Upload size={30}/><strong>Seu próximo álbum começa aqui</strong><p>Adicione os arquivos, preencha nome e artista ou use a identificação automática.</p><button disabled={!!job} onClick={() => fileInput.current.click()}>Selecionar MP3s</button></div>}</div></section>
      {draft.albums.map(album => <section key={album.key} className={`organizer-column organizer-album ${dropTarget === album.key ? 'is-drop-target' : ''}`} onDragOver={event => { event.preventDefault(); setDropTarget(album.key); }} onDrop={event => drop(event, album.key)}>
        <header><Cover fileKey={album.coverFileKey} url={album.coverUrl}/><div><span className="organizer-album-kind">{album.existingId ? 'DA BIBLIOTECA' : 'NOVO ÁLBUM'}</span><input aria-label={`Nome do álbum ${album.key}`} disabled={!!job} placeholder="Nome do álbum" value={album.title} onChange={event => patchAlbum(album.key, { title: event.target.value }, 'title')}/><input aria-label={`Artista do álbum ${album.key}`} disabled={!!job} placeholder="Nome do artista" value={album.artist} onChange={event => patchAlbum(album.key, { artist: event.target.value }, 'artist')}/></div><button disabled={!!job} aria-label={`Retirar álbum ${album.title || 'sem nome'} do rascunho`} onClick={() => change(value => ({ ...value, albums: value.albums.filter(item => item.key !== album.key), tracks: value.tracks.map(row => row.albumKey === album.key ? { ...row, albumKey: '' } : row) }))}><X size={15}/></button></header>
        <div className="organizer-album-tools"><button disabled={!!job || !!albumBusy} onClick={() => searchAlbum(album)}><Search size={13}/>{albumBusy === album.key ? 'Buscando…' : 'Encontrar álbum, ano e capa'}</button><label><Upload size={13}/>Escolher capa<input type="file" accept="image/png,image/jpeg,image/webp,image/avif" disabled={!!job} onChange={event => setCoverFile(album, event.target.files?.[0])}/></label></div>
        <div className="organizer-album-order"><button disabled={!!job || !!albumBusy || draft.tracks.filter(row => row.albumKey === album.key).length < 2} onClick={() => sortAlbum(album)}><ListOrdered size={14}/>Ordenar faixas pelo álbum</button></div>
        {(album.releaseYear || album.sourceUrl) && <small className="organizer-release-age">{album.releaseYear ? `Lançado em ${album.releaseYear} · ${Math.max(0, new Date().getFullYear() - Number(album.releaseYear))} anos` : 'Ano de lançamento indisponível'} {album.sourceUrl && <a href={album.sourceUrl} target="_blank" rel="noreferrer"><SpotifyMark/>Ver no Spotify</a>}</small>}
        {albumFeedback[album.key] && <small className="organizer-album-feedback" role="status">{albumFeedback[album.key]}</small>}
        {!!albumResults[album.key]?.length && <div className="organizer-album-results">{albumResults[album.key].map((item, index) => <div className="organizer-album-result" key={`${item.source}-${item.releaseGroupId || item.spotifyId || index}`}><button onClick={() => { patchAlbum(album.key, { title: item.title, artist: item.artist, coverUrl: item.coverUrl || album.coverUrl, coverFileKey: item.coverUrl ? '' : album.coverFileKey, uploadedCoverId: item.coverUrl ? '' : album.uploadedCoverId, releaseGroupId: item.releaseGroupId || '', spotifyId: item.spotifyId || '', releaseYear: item.year || '', releaseYearSource: item.source, sourceUrl: item.sourceUrl || '' }); setAlbumResults(value => ({ ...value, [album.key]: [] })); setAlbumFeedback(value => ({ ...value, [album.key]: 'Álbum identificado. Você já pode ordenar as faixas.' })); }}><Cover url={item.coverUrl}/><span>{item.title}<small>{item.artist} · {item.year || 'Sem ano'} · {item.source}</small><small>{item.matchScore < .88 ? 'Correspondência aproximada · revise antes de usar' : item.coverUrl ? 'Usar dados e capa' : 'Usar dados · sem capa'}</small></span></button>{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer"><SpotifyMark/>Spotify</a>}</div>)}</div>}
        <div className="organizer-column-tracks">{draft.tracks.filter(row => row.albumKey === album.key).map(row => renderTrack(row, album))}{!draft.tracks.some(row => row.albumKey === album.key) && <div className="organizer-album-drop"><Disc3 size={28}/><p>Arraste músicas para este álbum.</p><small>Elas passam a herdar a capa dele.</small></div>}</div>
      </section>)}
      {!draft.albums.length && <button className="organizer-add-album" disabled={!!job} onClick={addAlbum}><Plus size={35}/><strong>Crie um álbum para receber suas músicas</strong><span>Você também pode usar um álbum da biblioteca.</span></button>}
    </div>
    <footer className="organizer-footer"><span><GripVertical size={15}/>Arraste para mover e ordenar · Ctrl/Shift ou caixas para selecionar</span><button disabled={!!job || (!draft.tracks.length && !draft.albums.length)} onClick={() => setDiscard(true)}>Descartar rascunho</button><button className="organizer-primary" disabled={!!job || (!draft.tracks.length && !draft.albums.length)} onClick={() => { setReview(true); setAcknowledged(false); }}><Check size={16}/>Revisar e salvar</button></footer>
    {discard && <div className="organizer-confirm" role="alert"><strong>Descartar esta organização e os arquivos ainda não publicados?</strong><button disabled={!!job} onClick={() => setDiscard(false)}>Manter rascunho</button><button disabled={!!job} onClick={discardDraft}>Descartar</button></div>}
    {review && <section ref={reviewRef} className="organizer-review" aria-label="Revisão da importação"><header><h3><Check size={19}/>Revisão antes de salvar</h3><button disabled={!!job} onClick={() => setReview(false)} aria-label="Fechar revisão"><X size={18}/></button></header><p>{draft.tracks.length} músicas em {draft.albums.length} álbuns. As capas individuais permanecem guardadas quando você escolhe herdar a capa do álbum.</p>{issues.length ? <ul>{issues.map((item, index) => <li className={item.severity} key={index}><AlertCircle size={15}/>{item.message}</li>)}</ul> : <p className="organizer-valid"><Check size={16}/>Tudo pronto para salvar.</p>}{!!warnings.length && <label className="organizer-ack"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/>Revisei os avisos e quero continuar.</label>}<button className="organizer-primary" disabled={!!job || !!errors.length || (!!warnings.length && !acknowledged)} onClick={save}><Save size={16}/>{job || 'Salvar músicas e álbuns'}</button></section>}
  </section>;
}
