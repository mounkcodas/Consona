import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioLines, ChevronDown, ChevronLeft, ChevronRight, Clock3, Disc3, Expand, Heart, Home, Library, ListMusic, Music2, Pause, Play, Plus, Repeat2, Search, Settings, Shuffle, SkipBack, SkipForward, Square, Volume2, X, ExternalLink } from 'lucide-react';
import './styles.css';
import './brand-theme.css';
import LyricsStage from './LyricsStage.jsx';
import MusicVerification from './MusicVerification.jsx';
import AccountControl from './AccountControl.jsx';
import AudioVisualizer from './AudioVisualizer.jsx';
import AuthLanding from './AuthLanding.jsx';

const STORE = 'playmusic-library-v3';
const OLD_STORE = 'playmusic-library-v2';
const API_BASE = import.meta.env.VITE_API_BASE || 'https://playmusic-library-api.aleixomaycon.workers.dev';
const brandIcon = `${import.meta.env.BASE_URL}consona-mark.png`;
const blankState = { tracks: [], playlists: [], albums: [], history: [], favorites: [] };
const sections = [
  { label: 'Reproduzindo', icon: Play }, { label: 'Explorar', icon: Search },
  { label: 'Biblioteca', icon: Library }, { label: 'Playlists', icon: ListMusic },
  { label: 'Favoritos', icon: Heart }, { label: 'Histórico', icon: Clock3 }, { label: 'Álbuns', icon: Disc3 },
];
const readSaved = () => { try { return { ...blankState, ...JSON.parse(localStorage.getItem(STORE) || '{}'), history: [], favorites: [] }; } catch { return blankState; } };
function syncSafeSize(bytes, offset) { return (bytes[offset] & 0x7f) << 21 | (bytes[offset + 1] & 0x7f) << 14 | (bytes[offset + 2] & 0x7f) << 7 | bytes[offset + 3] & 0x7f; }
function decodeId3Text(bytes) {
  if (!bytes.length) return '';
  const encoding = bytes[0], content = bytes.subarray(1);
  try {
    const decoder = encoding === 1 ? new TextDecoder('utf-16') : encoding === 2 ? new TextDecoder('utf-16be') : encoding === 3 ? new TextDecoder('utf-8') : new TextDecoder('windows-1252');
    return decoder.decode(content).replace(/\0+$/g, '').trim();
  } catch { return new TextDecoder().decode(content).replace(/\0+$/g, '').trim(); }
}
async function readId3Tags(file) {
  const fields = {};
  let picture = null;
  const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (header.length >= 10 && String.fromCharCode(...header.subarray(0, 3)) === 'ID3') {
    const version = header[3], tagSize = syncSafeSize(header, 6);
    const body = new Uint8Array(await file.slice(10, 10 + Math.min(tagSize, 8 * 1024 * 1024)).arrayBuffer());
    const names = version === 2 ? { TT2: 'title', TP1: 'artist', TP2: 'albumartist', TAL: 'album', TRK: 'track', TPA: 'disc', TYE: 'year', TCO: 'genre', PIC: 'picture' } : { TIT2: 'title', TPE1: 'artist', TPE2: 'albumartist', TALB: 'album', TRCK: 'track', TPOS: 'disc', TDRC: 'year', TYER: 'year', TCON: 'genre', APIC: 'picture' };
    let offset = version === 2 ? 6 : 10;
    while (offset + (version === 2 ? 6 : 10) <= body.length) {
      const idLength = version === 2 ? 3 : 4, frameId = String.fromCharCode(...body.subarray(offset, offset + idLength));
      if (!frameId.trim() || !/^[A-Z0-9]+$/.test(frameId)) break;
      const size = version === 2 ? body[offset + 3] << 16 | body[offset + 4] << 8 | body[offset + 5] : version === 4 ? syncSafeSize(body, offset + 4) : new DataView(body.buffer, body.byteOffset + offset + 4, 4).getUint32(0);
      const start = offset + (version === 2 ? 6 : 10), end = Math.min(start + size, body.length), data = body.subarray(start, end), name = names[frameId];
      if (end <= start || !name) { offset = start + size; continue; }
      if (name === 'picture' && !picture) {
        if (frameId === 'PIC' && data.length > 5) { const format = String.fromCharCode(...data.subarray(1, 4)).toLowerCase(); let desc = 5; while (desc < data.length && data[desc] !== 0) desc++; picture = { data: data.slice(Math.min(desc + 1, data.length)), type: `image/${format === 'jpg' ? 'jpeg' : format}` }; }
        else if (data.length > 4) { let cursor = 1; while (cursor < data.length && data[cursor] !== 0) cursor++; const mime = new TextDecoder().decode(data.subarray(1, cursor)) || 'image/jpeg'; cursor += 2; const encoding = data[0]; if (encoding === 1 || encoding === 2) { while (cursor + 1 < data.length && (data[cursor] !== 0 || data[cursor + 1] !== 0)) cursor += 2; cursor += 2; } else { while (cursor < data.length && data[cursor] !== 0) cursor++; cursor++; } picture = { data: data.slice(Math.min(cursor, data.length)), type: mime }; }
      } else if (frameId[0] === 'T' && data.length) {
        const value = decodeId3Text(data);
        if (name === 'track' || name === 'disc') fields[name] = value;
        else if (name === 'genre') fields[name] = value.split(/\0|;|\//).map(item => item.trim()).filter(Boolean);
        else if (!fields[name]) fields[name] = value;
      }
      offset = start + size;
    }
  }
  if (!fields.title || !fields.artist || !fields.album) {
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 128)).arrayBuffer());
    if (tail.length === 128 && String.fromCharCode(...tail.subarray(0, 3)) === 'TAG') {
      const read = (start, length) => new TextDecoder('windows-1252').decode(tail.subarray(start, start + length)).replace(/\0+$/g, '').trim();
      fields.title ||= read(3, 30); fields.artist ||= read(33, 30); fields.album ||= read(63, 30); fields.year ||= read(93, 4);
      if (!fields.track && tail[125] === 0 && tail[126]) fields.track = String(tail[126]);
    }
  }
  const trackNo = Number(String(fields.track || '').split('/')[0]) || 0;
  return { title: fields.title || '', artist: fields.artist || fields.albumartist || '', album: fields.album || '', trackNo, year: fields.year || '', disc: fields.disc || '', genre: fields.genre || [], picture };
}
function readAudioDuration(file) { return new Promise(resolve => { const audio = new Audio(), url = URL.createObjectURL(file); const finish = value => { URL.revokeObjectURL(url); resolve(Number.isFinite(value) ? Math.floor(value) : 0); }; audio.onloadedmetadata = () => finish(audio.duration); audio.onerror = () => finish(0); audio.src = url; }); }
const database = () => new Promise((resolve, reject) => { const request = indexedDB.open('playmusic-files', 1); request.onupgradeneeded = () => request.result.createObjectStore('files'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const saveFile = async (key, file) => { const db = await database(); return new Promise((resolve, reject) => { const request = db.transaction('files', 'readwrite').objectStore('files').put(file, key); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); };
const getFile = async key => { const db = await database(); return new Promise((resolve, reject) => { const request = db.transaction('files').objectStore('files').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); };
async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const session = sessionStorage.getItem('consona-session');
  if (session) headers.set('Authorization', `Bearer ${session}`);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Falha ao acessar a biblioteca (${response.status}).`);
  return body;
}
async function lastfmRequest(method, values = {}, options = {}) {
  const params = new URLSearchParams({ method, ...values });
  return apiRequest(`/api/lastfm?${params}`, options);
}

function App() {
  const [data, setData] = useState(readSaved);
  const [currentUser, setCurrentUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const { tracks, playlists, albums = [], history, favorites } = data;
  const [currentId, setCurrentId] = useState(() => readSaved().tracks[0]?.id ?? null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [volume, setVolume] = useState(64);
  const [section, setSection] = useState('Reproduzindo');
  const [mobileMore, setMobileMore] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ title: '', artist: '', album: '' });
  const [musicBrainzMatch, setMusicBrainzMatch] = useState(null);
  const [lookup, setLookup] = useState(null);
  const [lookupState, setLookupState] = useState('idle');
  const [lookupError, setLookupError] = useState('');
  const [imageDialog, setImageDialog] = useState('');
  const [imageQuery, setImageQuery] = useState('');
  const [imageKind, setImageKind] = useState('image');
  const [imageResults, setImageResults] = useState([]);
  const [imageState, setImageState] = useState('idle');
  const [imageAttribution, setImageAttribution] = useState({ cover: null, main: null });
  const [audioFile, setAudioFile] = useState(null);
  const [mainImage, setMainImage] = useState(null);
  const [coverImage, setCoverImage] = useState(null);
  const [playlistName, setPlaylistName] = useState('');
  const [playlistDialog, setPlaylistDialog] = useState(false);
  const [playlistSelection, setPlaylistSelection] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationState, setRecommendationState] = useState('idle');
  const [selectedPlaylist, setSelectedPlaylist] = useState('');
  const [selectedAlbum, setSelectedAlbum] = useState('');
  const [albumTitle, setAlbumTitle] = useState('');
  const [albumArtist, setAlbumArtist] = useState('');
  const [albumSelection, setAlbumSelection] = useState([]);
  const [bulkRows, setBulkRows] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [albumCoverUrl, setAlbumCoverUrl] = useState('');
  const [albumCoverProof, setAlbumCoverProof] = useState('');
  const [albumSearchBusy, setAlbumSearchBusy] = useState(false);
  const [albumSearchResults, setAlbumSearchResults] = useState([]);
  const [albumCoverChecks, setAlbumCoverChecks] = useState({});
  const [bulkCoverBusy, setBulkCoverBusy] = useState(false);
  const bulkPicker = useRef(null);
  const bulkFolderPicker = useRef(null);
  const [settingsTab, setSettingsTab] = useState('music');
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [carousel, setCarousel] = useState(0);
  const [ready, setReady] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioRef = useRef(null);
  const lastElapsedPaint = useRef(0);
  const audioPicker = useRef(null);
  const selectedAudioFile = useRef(null);
  const coverPicker = useRef(null);
  const mainPicker = useRef(null);

  const current = tracks.find(track => track.id === currentId) || null;
  async function saveLyrics(lyrics) {
    if (!current) return;
    const trackId = current.id;
    await apiRequest(`/api/tracks/${encodeURIComponent(trackId)}/lyrics`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lyrics }) });
    setData(value => ({ ...value, tracks: value.tracks.map(track => track.id === trackId ? { ...track, metadata: { ...(track.metadata || {}), lyrics } } : track) }));
  }
  const seconds = current?.seconds || 1;
  const selected = playlists.find(playlist => playlist.id === selectedPlaylist) || null;
  const activeAlbum = albums.find(album => album.id === selectedAlbum) || null;
  const libraryAlbums = useMemo(() => {
    const existingIds = new Set(tracks.map(track => track.id));
    return albums.map(album => ({ ...album, trackIds: (album.trackIds || []).filter(id => existingIds.has(id)) }))
      .filter(album => album.trackIds.length > 0);
  }, [tracks, albums]);
  const trackIds = selected?.trackIds || [];
  const orderedTracks = selected ? trackIds.map(id => tracks.find(track => track.id === id)).filter(Boolean) : tracks;
  const visibleTracks = useMemo(() => {
    let list = orderedTracks;
    if (section === 'Favoritos') list = list.filter(track => favorites.includes(track.id));
    if (section === 'Histórico') list = history.map(id => tracks.find(track => track.id === id)).filter(Boolean);
    if (section === 'Explorar' || query) list = list.filter(track => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query.toLowerCase()));
    return list;
  }, [orderedTracks, section, favorites, history, tracks, query]);
  const carouselPlaylists = playlists.length ? [...playlists.slice(carousel), ...playlists.slice(0, carousel)].slice(0, 4) : [];

  useEffect(() => {
    if (!current || section !== 'Reproduzindo') { setRecommendations([]); setRecommendationState('idle'); return; }
    const controller = new AbortController(); setRecommendationState('loading');
    lastfmRequest('track.getSimilar', { artist: current.artist, track: current.title, limit: '30' }, { signal: controller.signal }).then(result => {
      if (result.error) throw new Error(result.message || 'Last.fm não encontrou recomendações.');
      const artists = [...new Map((result.similartracks?.track || []).map(item => [item.artist?.name?.toLowerCase(), { name: item.artist?.name, image: item.image?.find(image => image.size === 'medium')?.['#text'] || '' }]).filter(([name]) => name)).values()].slice(0, 5);
      setRecommendations(artists); setRecommendationState(artists.length ? 'ready' : 'empty');
    }).catch(error => { if (error.name !== 'AbortError') { setRecommendations([]); setRecommendationState('error'); } });
    return () => controller.abort();
  }, [current?.id, current?.artist, current?.title, section]);

  useEffect(() => { try { localStorage.removeItem('playmusic-tracks'); localStorage.removeItem('playmusic-library-v2'); localStorage.removeItem('playmusic-lastfm-key'); } catch {} }, []);
  useEffect(() => {
    if (!sessionStorage.getItem('consona-session')) { setData(blankState); setCurrentId(null); setReady(true); setAuthReady(true); return; }
    apiRequest('/api/auth/me').then(result => setCurrentUser(result.user)).catch(() => { sessionStorage.removeItem('consona-session'); setData(blankState); setCurrentId(null); }).finally(() => setAuthReady(true));
  }, []);
  useEffect(() => {
    if (!authReady) return;
    const route = currentUser ? '/app' : '/login';
    if (window.location.hash !== `#${route}`) window.history.replaceState({}, '', `/#${route}`);
  }, [authReady, currentUser]);
  async function handleUserChange(user) {
    setCurrentUser(user);
    setData(value => ({ ...value, favorites: [], history: [] }));
    window.history.replaceState({}, '', `/#${user ? '/app' : '/login'}`);
    if (!user) { setData(blankState); setCurrentId(null); setPlaying(false); return; }
    try { setData(await apiRequest('/api/library')); }
    catch (error) { setNotice(error.message); }
  }
  useEffect(() => {
    if (!currentUser) { setReady(true); return; }
    let cancelled = false;
    const refreshLibrary = async (initial = false) => {
      try {
        const library = await apiRequest('/api/library');
        if (cancelled) return;
        setData(library);
        if (initial) setCurrentId(library.tracks[0]?.id ?? null);
      } catch (error) {
        if (!cancelled && initial) setNotice(`Biblioteca compartilhada indisponível: ${error.message}`);
      } finally {
        if (!cancelled && initial) setReady(true);
      }
    };
    refreshLibrary(true);
    const timer = window.setInterval(() => refreshLibrary(), 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [currentUser?.id]);
  useEffect(() => { if (!ready) return; try { localStorage.setItem(STORE, JSON.stringify({ ...data, favorites: [], history: [], tracks: tracks.map(({src, ...track}) => ({...track, src})) })); } catch { setNotice('Não foi possível salvar o cache da biblioteca.'); } }, [data, ready]);
  useEffect(() => { const audio = audioRef.current; if (!ready || !audio || !current) return; audio.volume = volume / 100; if (!current.src) { setPlaying(false); return; } if (audio.src !== current.src) { audio.src = current.src; audio.load(); } if (playing) audio.play().catch(() => setPlaying(false)); else audio.pause(); }, [ready, currentId, playing, volume, current?.src]);
  useEffect(() => { if (!playing || current?.src) return; const timer = setInterval(() => setElapsed(value => Math.min(value + 1, seconds)), 1000); return () => clearInterval(timer); }, [playing, current?.src, seconds]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (currentId && !current) { setCurrentId(null); setPlaying(false); } }, [current, currentId]);
  useEffect(() => {
    if (ready && section === 'Biblioteca' && selectedAlbum && !libraryAlbums.some(album => album.id === selectedAlbum)) setSelectedAlbum('');
  }, [ready, section, selectedAlbum, libraryAlbums]);

  function formatTime(value) { const total = Math.max(0, Math.floor(Number(value) || 0)); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
  function displayDuration(value) { if (typeof value === 'string' && value.includes(':')) { const [minutes, secondsPart] = value.split(':'); const seconds = Math.floor(Number.parseFloat(secondsPart) || 0); return `${String(Math.max(0, Number.parseInt(minutes, 10) || 0)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; } return formatTime(value); }
  function pickTrack(track) { setCurrentId(track.id); setElapsed(0); lastElapsedPaint.current = 0; setPlaying(Boolean(track.src)); setSection('Reproduzindo'); if (currentUser) { setData(value => ({ ...value, history: [track.id, ...value.history.filter(id => id !== track.id)].slice(0, 100) })); apiRequest(`/api/tracks/${track.id}/history`, { method: 'POST' }).catch(error => setNotice(error.message)); } }
  function advance(direction = 1) {
    if (!tracks.length) return;
    const index = tracks.findIndex(track => track.id === currentId);
    const target = shuffle && direction > 0 ? Math.floor(Math.random() * tracks.length) : (index + direction + tracks.length) % tracks.length;
    pickTrack(tracks[target]);
  }
  function stop() { setPlaying(false); setElapsed(0); if (audioRef.current) audioRef.current.currentTime = 0; }
  function toggleFavorite(id) { if (!currentUser) { setNotice('Entre na sua conta para salvar favoritos.'); return; } const favorite = !favorites.includes(id); setData(value => ({ ...value, favorites: favorite ? [...value.favorites, id] : value.favorites.filter(item => item !== id) })); apiRequest(`/api/tracks/${id}/favorite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite }) }).catch(error => setNotice(error.message)); }
  function loadFile(file) {
    if (!file) return;
    selectedAudioFile.current = file;
    setAudioFile(file);
    setAudioDuration(0);
    if (!form.title) setForm(value => ({ ...value, title: file.name.replace(/\.[^.]+$/, '') }));
    readId3Tags(file).then(tags => {
      if (selectedAudioFile.current !== file) return;
      const fileTitle = file.name.replace(/\.[^.]+$/, '');
      setForm(value => ({ ...value, title: (!value.title || value.title === fileTitle) ? (tags.title || value.title) : value.title, artist: value.artist || tags.artist, album: value.album || tags.album }));
    }).catch(() => {});
    const probe = new Audio(); const source = URL.createObjectURL(file);
    probe.onloadedmetadata = () => { if (Number.isFinite(probe.duration)) setAudioDuration(Math.floor(probe.duration)); URL.revokeObjectURL(source); };
    probe.onerror = () => URL.revokeObjectURL(source);
    probe.src = source;
  }
  function imageData(file, setter) { if (!file) return; const reader = new FileReader(); reader.onload = () => setter(String(reader.result)); reader.readAsDataURL(file); }
  async function lookupLastfm(event) {
    event.preventDefault();
    if (!form.title.trim() || !form.artist.trim()) { setLookupError('Informe o título e o artista para buscar no Last.fm.'); return; }
    setLookupState('loading'); setLookupError(''); setLookup(null);
    try {
      const requestLastfm = (method, values) => lastfmRequest(method, values);
      const payload = await requestLastfm('track.getInfo', { artist:form.artist.trim(), track:form.title.trim() });
      if (!payload.track) throw new Error(payload.message || 'A faixa não foi encontrada no Last.fm.');
      const track = payload.track;
      const artistPayload = await requestLastfm('artist.getInfo', { artist:track.artist?.name || form.artist.trim() }).catch(() => ({}));
      const albumPayload = track.album?.title ? await requestLastfm('album.getInfo', { artist:track.artist?.name || form.artist.trim(), album:track.album.title }).catch(() => ({})) : {};
      const artistInfo = artistPayload.artist || {};
      const albumInfo = albumPayload.album || {};
      const tags = track.toptags?.tag || [];
      const artistTags = artistInfo.tags?.tag || [];
      setLookup({ title:track.name || form.title, artist:track.artist?.name || form.artist, album:track.album?.title || form.album, duration:Math.round((Number(track.duration)||0)/1000), url:track.url || '', mbid:track.mbid || '', listeners:track.listeners || '', playcount:track.playcount || '', tags:(Array.isArray(tags)?tags:[tags]).map(tag=>tag.name).filter(Boolean), summary:track.wiki?.summary?.replace(/<[^>]*>/g,'') || '', artistSummary:artistInfo.bio?.summary?.replace(/<[^>]*>/g,'') || '', artistTags:(Array.isArray(artistTags)?artistTags:[artistTags]).map(tag=>tag.name).filter(Boolean), albumRelease:albumInfo.wiki?.published || '', artistUrl:artistInfo.url || track.artist?.url || '', albumUrl:albumInfo.url || '', cover:albumInfo.image?.find(image=>image.size==='large')?.['#text'] || track.album?.image?.find(image=>image.size==='large')?.['#text'] || '' });
      setLookupState('ready');
    } catch(error) { setLookupError(error.message); setLookupState('error'); }
  }
  function applyLookup() { if (!lookup) return; setForm(value=>({...value,title:lookup.title||value.title,artist:lookup.artist||value.artist,album:lookup.album||value.album})); if (!audioFile && lookup.duration) setAudioDuration(lookup.duration); setNotice('Sugestão Last.fm aplicada. Revise os campos antes de adicionar.'); }
  async function searchImages(event) {
    event?.preventDefault(); const term = (imageQuery || `${form.title} ${form.artist}`).trim(); if (!term) return;
    setImageState('loading'); setImageResults([]);
    try {
      const params = new URLSearchParams({ action:'query', generator:'search', gsrsearch:`${term} ${imageKind==='gif'?'filemime:image/gif':''}`, gsrnamespace:'6', gsrlimit:'18', prop:'imageinfo', iiprop:'url|extmetadata', iiurlwidth:'360', format:'json', origin:'*' });
      const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`); const payload = await response.json();
      if (!response.ok) throw new Error('A pesquisa de imagens falhou.');
      const items = Object.values(payload.query?.pages || {}).map(page=>{const info=page.imageinfo?.[0];return info?{title:page.title.replace(/^File:/,''),url:info.thumburl||info.url,source:info.descriptionurl, mime:info.mime, artist:info.extmetadata?.Artist?.value?.replace(/<[^>]*>/g,'')||'', license:info.extmetadata?.LicenseShortName?.value||'', licenseUrl:info.extmetadata?.LicenseUrl?.value||''}:null}).filter(Boolean).filter(item=>imageKind!=='gif'||item.mime==='image/gif');
      setImageResults(items); setImageState(items.length?'ready':'empty');
    } catch(error) { setImageState('error'); setNotice(error.message); }
  }
  async function searchGoogleImages() {
    const term=(imageQuery||`${form.title} ${form.artist}`).trim();if(!term)return;
    setImageState('loading');setImageResults([]);
    try {const result=await apiRequest(`/api/covers/google?q=${encodeURIComponent(term)}`);const items=(result.items||[]).map(item=>({title:item.title,url:item.thumbnail||item.url,originalUrl:item.url,googleProof:item.proof,source:item.source,artist:'',license:`Google Images ? ${item.width||'?'} x ${item.height||'?'} ? ${item.source||''}`}));setImageResults(items);setImageState(items.length?'ready':'empty');}
    catch(error){setImageState('error');setNotice(error.message);}
  }
  function chooseRemoteImage(item) { const target=imageDialog;const chosenUrl=item.originalUrl||item.url;const provider=item.googleProof?'Google Images':'Wikimedia Commons';if(target==='album'){setAlbumCoverUrl(chosenUrl);setAlbumCoverProof(item.googleProof||'');}else if(target.startsWith('bulk:'))chooseBulkCover(target.slice(5),{url:chosenUrl,source:provider,label:item.title,googleProof:item.googleProof});else if(target.startsWith('track:')){const id=target.slice(6);const track=tracks.find(value=>value.id===id);if(track)applyAlbumTrackCover(track,{url:chosenUrl,source:provider,label:item.title,googleProof:item.googleProof});}else (target==='cover'?setCoverImage:setMainImage)(chosenUrl); setImageAttribution(value=>({...value,[target]:{title:item.title,source:item.source,artist:item.artist,license:item.license,licenseUrl:item.licenseUrl,googleProof:item.googleProof||''}})); setImageDialog(''); setNotice(`Imagem escolhida de ${provider}.`); }
  async function addTrack(event) {
    event.preventDefault();
    if (!audioFile || !form.title.trim() || !form.artist.trim() || !form.album.trim()) { setNotice('Preencha música, artista, álbum e arquivo de áudio.'); return; }
    try {
      const formData = new FormData();
      formData.set('title', form.title.trim()); formData.set('artist', form.artist.trim()); formData.set('album', form.album.trim());
      formData.set('duration', String(audioDuration)); formData.set('audio', audioFile, audioFile.name);
      const verified = musicBrainzMatch && musicBrainzMatch.title === form.title && musicBrainzMatch.artist === form.artist ? musicBrainzMatch : null;
      formData.set('metadata', JSON.stringify({ lastfm: lookup || null, musicbrainz: verified, imageAttribution, googleCoverProof:imageAttribution.cover?.googleProof||'' }));
      if (coverImage?.startsWith('http')) formData.set('coverUrl', coverImage);
      if (mainImage?.startsWith('http')) formData.set('mainImageUrl', mainImage);
      if (coverImage && !coverImage.startsWith('http')) formData.set('cover', await (await fetch(coverImage)).blob(), 'cover-image');
      if (mainImage && !mainImage.startsWith('http')) formData.set('mainImage', await (await fetch(mainImage)).blob(), 'player-image');
      const result = await apiRequest('/api/tracks', { method: 'POST', body: formData });
      let library = await apiRequest('/api/library');
      let albumError = false;
      try {
        const normalize = value => (value || '').trim().toLocaleLowerCase();
        const album = (library.albums || []).find(item => normalize(item.title) === normalize(form.album) && normalize(item.artist) === normalize(form.artist));
        if (album) await apiRequest(`/api/albums/${encodeURIComponent(album.id)}/tracks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackIds: [...album.trackIds, result.id] }) });
        else await apiRequest('/api/albums', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: form.album.trim(), artist: form.artist.trim(), trackIds: [result.id] }) });
        library = await apiRequest('/api/library');
      } catch { albumError = true; }
      setData(library); setCurrentId(result.id); setElapsed(0); setPlaying(false);
      selectedAudioFile.current = null; setForm({ title: '', artist: '', album: '' }); setMusicBrainzMatch(null); setLookup(null); setLookupState('idle'); setAudioFile(null); setAudioDuration(0); setCoverImage(null); setMainImage(null); setImageAttribution({cover:null,main:null}); setSection('Reproduzindo'); setNotice(albumError ? 'Música enviada, mas não foi possível adicioná-la ao álbum. Use a seção Álbuns para vinculá-la.' : 'Música adicionada à biblioteca compartilhada.');
    } catch (error) { setNotice(`Não foi possível enviar a música: ${error.message}`); }
  }
  async function createPlaylist(event) {
    event.preventDefault(); const name = playlistName.trim(); if (!name) return;
    try { const playlist = await apiRequest('/api/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, trackIds: [...new Set(playlistSelection)] }) }); const library = await apiRequest('/api/library'); setData(library); setPlaylistName(''); setPlaylistSelection([]); setPlaylistDialog(false); setSelectedPlaylist(playlist.id); setSection('Playlists'); setNotice('Playlist compartilhada criada.'); } catch (error) { setNotice(`Não foi possível criar a playlist: ${error.message}`); }
  }
  function openPlaylistDialog() { setPlaylistName(''); setPlaylistSelection(current ? [current.id] : []); setPlaylistDialog(true); }
  async function addSelectionToPlaylist(playlistId) { try { await apiRequest(`/api/playlists/${playlistId}/tracks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackIds: playlistSelection }) }); const library = await apiRequest('/api/library'); setData(library); setPlaylistDialog(false); setNotice('Músicas adicionadas à playlist compartilhada.'); } catch (error) { setNotice(`Não foi possível atualizar a playlist: ${error.message}`); } }
  async function addToPlaylist(id) {
    if (!selectedPlaylist || !id) return;
    try { await apiRequest(`/api/playlists/${selectedPlaylist}/tracks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: id }) }); const library = await apiRequest('/api/library'); setData(library); setNotice('Música adicionada à playlist compartilhada.'); } catch (error) { setNotice(`Não foi possível adicionar à playlist: ${error.message}`); }
  }
  async function createAlbum(event) {
    event.preventDefault(); const title=albumTitle.trim(); if(!title) return;
    try { const result=await apiRequest('/api/albums',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,artist:albumArtist,trackIds:albumSelection,coverUrl:albumCoverUrl,coverProof:albumCoverProof,metadata:{source:albumCoverUrl?'cover-art-archive-or-manual':'',googleCoverProof:albumCoverProof}})}); const library=await apiRequest('/api/library'); setData(library); setAlbumTitle('');setAlbumArtist('');setAlbumSelection([]);setAlbumCoverUrl('');setAlbumCoverProof('');setSelectedAlbum(result.id);setNotice('Álbum criado na biblioteca compartilhada.'); }
    catch(error){setNotice(`Não foi possível criar o álbum: ${error.message}`);}
  }
  async function saveAlbumOrder(albumId, trackIds) { try { await apiRequest(`/api/albums/${albumId}/tracks`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trackIds})}); const library=await apiRequest('/api/library');setData(library); } catch(error){setNotice(`Não foi possível salvar a ordem do álbum: ${error.message}`);} }
  async function applyAlbumCoverToTracks(){if(!activeAlbum?.cover)return;const trackIds=activeAlbum.trackIds||[];if(!trackIds.length){setNotice('Este álbum ainda não tem faixas para atualizar.');return;}setBulkCoverBusy(true);let applied=0;try{for(const id of trackIds){try{await apiRequest(`/api/tracks/${id}/cover`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({coverUrl:activeAlbum.cover,coverProof:activeAlbum.coverProof||''})});applied++;}catch(error){if(applied===0)throw error;}}setData(await apiRequest('/api/library'));setNotice(`${applied} de ${trackIds.length} faixas receberam a capa do álbum.`);}catch(error){setNotice(`Falha ao aplicar a capa às faixas: ${error.message}`);}finally{setBulkCoverBusy(false);}}
  async function deleteAlbum(id) { try { await apiRequest(`/api/albums/${id}`,{method:'DELETE'});setData(await apiRequest('/api/library'));setSelectedAlbum('');setNotice('Álbum removido. As músicas continuam na biblioteca.'); }catch(error){setNotice(`Não foi possível remover o álbum: ${error.message}`);} }
  async function stageBulkFiles(files) {
    const rows=Array.from(files||[]).filter(file=>/\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(file.name)).map((file,index)=>{const parts=(file.webkitRelativePath||'').split('/').filter(Boolean);const parsed=file.name.replace(/\.[^.]+$/,'').replace(/[_]+/g,' ').replace(/^\d+[\s._-]*/, '');const artistTitle=parsed.split(/\s+-\s+/);return {key:`${Date.now()}-${index}-${file.name}`,file,title:artistTitle.length>1?artistTitle.slice(1).join(' - '):parsed,artist:artistTitle.length>1?artistTitle[0]:(parts.length>2?parts.at(-3):''),album:parts.length>1?parts.at(-2):'',duration:0,metadata:null}});
    setBulkRows(rows);
    await Promise.all(rows.map(async row=>{const tags=await readId3Tags(row.file).catch(()=>null);const duration=await readAudioDuration(row.file);setBulkRows(current=>current.map(item=>item.key===row.key?{...item,title:tags?.title||item.title,artist:tags?.artist||item.artist,album:tags?.album||item.album,trackNo:tags?.trackNo||0,duration,cover:tags?.picture?new Blob([tags.picture.data],{type:tags.picture.type}):null,metadata:{id3:{genre:tags?.genre||[],year:tags?.year||null,track:tags?.trackNo||0,disc:tags?.disc||''}}}:item));}));
    setNotice(`${rows.length} arquivos carregados. Tags ID3, nomes de arquivos e pastas usados para sugerir metadados.`);
  }
  function reorderBulk(from,to) { setBulkRows(rows=>{const next=[...rows],item=next.splice(from,1)[0];next.splice(to,0,item);return next;}); }
  async function suggestBulkRow(key) {
    const row=bulkRows.find(item=>item.key===key);if(!row)return;
    try { const data=await lastfmRequest('track.getInfo',{artist:row.artist||row.title.split(' - ')[0],track:row.artist?row.title:row.title.split(' - ').slice(1).join(' - ')||row.title});if(!data.track)throw new Error(data.message||'Sugestão não encontrada.');const info=data.track;setBulkRows(rows=>rows.map(item=>item.key===key?{...item,title:info.name||item.title,artist:info.artist?.name||item.artist,album:info.album?.title||item.album,metadata:{lastfm:{url:info.url||'',mbid:info.mbid||'',listeners:info.listeners||'',playcount:info.playcount||'',tags:info.toptags?.tag||[],summary:info.wiki?.summary||''}}}:item));setNotice('Sugestão aplicada à fila. Revise os campos antes de enviar.'); }
    catch(error){setNotice(`Last.fm: ${error.message}`);}
  }
  async function suggestMusicBrainzTrack(key) {
    const row=bulkRows.find(item=>item.key===key); if(!row)return;
    try { const query=`recording:"${row.title}"${row.artist?` AND artist:"${row.artist}"`:''}`; const params=new URLSearchParams({query,fmt:'json',limit:'5'}); const response=await fetch(`https://musicbrainz.org/ws/2/recording/?${params}`,{headers:{Accept:'application/json'}}); if(!response.ok)throw new Error('MusicBrainz indisponível.'); const data=await response.json(); const recording=data.recordings?.[0]; if(!recording)throw new Error('Nenhuma gravação encontrada.'); const release=recording.releases?.[0]; setBulkRows(rows=>rows.map(item=>item.key===key?{...item,title:recording.title||item.title,artist:recording['artist-credit']?.map(a=>a.name).filter(Boolean).join(', ')||item.artist,album:release?.title||item.album,metadata:{...(item.metadata||{}),musicbrainz:{recordingId:recording.id,releaseId:release?.id||'',source:'MusicBrainz'}}}:item)); setNotice('Sugestão MusicBrainz aplicada à faixa.'); }
    catch(error){setNotice(`MusicBrainz: ${error.message}`);}
  }
  async function coverArtForRelease(release) {
    const groupId=release['release-group']?.id||release.releaseGroupId;
    const readFront=async url=>{const payload=await fetch(url).then(response=>response.ok?response.json():null).catch(()=>null);const image=payload?.images?.find(item=>item.front)||payload?.images?.[0];const source=image?image.thumbnails?.['1200']||image.image||image.thumbnails?.large||'':'';return source.replace(/^http:/,'https:');};
    if(groupId){const grouped=await readFront(`https://coverartarchive.org/release-group/${groupId}`);if(grouped)return {url:grouped,source:'Cover Art Archive ? grupo'};}
    if(release.id){const edition=await readFront(`https://coverartarchive.org/release/${release.id}`);if(edition)return {url:edition,source:'Cover Art Archive ? edi??o'};}
    return null;
  }
  async function findTrackCover(track) {
    const query=`recording:"${track.title}"${track.artist?` AND artist:"${track.artist}"`:''}`;
    const params=new URLSearchParams({query,fmt:'json',limit:'8'});
    const response=await fetch(`https://musicbrainz.org/ws/2/recording/?${params}`,{headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('MusicBrainz indispon?vel.');
    const recordings=(await response.json()).recordings||[];
    const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    const trackAlbum=norm(track.album);
    const groupItems=track.album?await fetch(`https://musicbrainz.org/ws/2/release-group/?${new URLSearchParams({query:`releasegroup:\"${track.album}\"${track.artist?` AND artist:\"${track.artist}\"`:''}`,fmt:'json',limit:'8'})}`,{headers:{Accept:'application/json'}}).then(r=>r.ok?r.json():null).catch(()=>null):null;
    const groups=(groupItems?.['release-groups']||[]).sort((a,b)=>Number(norm(b.title)===trackAlbum)-Number(norm(a.title)===trackAlbum));
    const groupCovers=(await Promise.all(groups.slice(0,5).map(async group=>{const art=await coverArtForRelease({releaseGroupId:group.id});return art?{...art,label:`${group.title}${group['first-release-date']?` ? ${group['first-release-date'].slice(0,4)}`:''}`,releaseId:group.id}:null;}))).filter(Boolean);
    if(groupCovers.length)return groupCovers;
    const releases=new Map();
    recordings.forEach(recording=>(recording.releases||[]).forEach(release=>{
      if(release.id)releases.set(release.id,{...release,recordingTitle:recording.title,artist:recording['artist-credit']?.map(item=>item.name).filter(Boolean).join(', ')});
    }));
    const ordered=[...releases.values()].sort((a,b)=>Number(norm(b.title)===trackAlbum)-Number(norm(a.title)===trackAlbum)).slice(0,8);
    const candidates=(await Promise.all(ordered.map(async release=>{
      const art=await coverArtForRelease(release);
      return art?.url?{...art,label:`${release.title||track.album}${release.date?` ? ${release.date.slice(0,4)}`:''}${release.country?` ? ${release.country}`:''}`,releaseId:release.id}:null;
    }))).filter(Boolean);
    if(candidates.length||groupCovers.length)return [...new Map([...groupCovers,...candidates].map(item=>[item.url,item])).values()];
    if(track.album&&track.artist){
      const result=await lastfmRequest('album.getInfo',{artist:track.artist,album:track.album});
      const url=result.album?.image?.find(image=>image.size==='large')?.['#text'];
      if(url)return [{url,source:'Last.fm',label:`${track.album} ? ${track.artist}`}];
    }
    throw new Error('Nenhuma capa encontrada no Cover Art Archive ou Last.fm. Verifique os resultados ou escolha uma imagem manualmente.');
  }
  function chooseBulkCover(key,candidate){setBulkRows(rows=>rows.map(item=>item.key===key?{...item,coverUrl:candidate.url,coverSource:candidate.source,metadata:{...(item.metadata||{}),coverUrl:candidate.url,coverSource:candidate.source,googleCoverProof:candidate.googleProof||''}}:item));}
  async function checkBulkCover(key){const row=bulkRows.find(item=>item.key===key);if(!row)return;setBulkRows(rows=>rows.map(item=>item.key===key?{...item,coverLookup:'loading',coverUrl:'',coverCandidates:[]}:item));try{const candidates=await findTrackCover(row);setBulkRows(rows=>rows.map(item=>item.key===key?{...item,coverCandidates:candidates,coverLookup:'ready',coverError:''}:item));}catch(error){setBulkRows(rows=>rows.map(item=>item.key===key?{...item,coverLookup:'error',coverError:error.message}:item));}}
  async function checkAlbumTrackCover(track){setAlbumCoverChecks(value=>({...value,[track.id]:{state:'loading'}}));try{const candidates=await findTrackCover(track);setAlbumCoverChecks(value=>({...value,[track.id]:{state:'ready',candidates}}));}catch(error){setAlbumCoverChecks(value=>({...value,[track.id]:{state:'error',error:error.message}}));}}
  async function applyAlbumTrackCover(track,candidate){if(!candidate?.url)return;try{await apiRequest(`/api/tracks/${track.id}/cover`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({coverUrl:candidate.url,coverProof:candidate.googleProof||''})});setData(await apiRequest('/api/library'));setNotice('Capa atualizada na m?sica.');}catch(error){setNotice(`N?o foi poss?vel salvar a capa: ${error.message}`);}}

  async function searchMusicBrainzAlbum() {
    const query=[albumTitle,albumArtist].filter(Boolean).join(' '); if(!query){setNotice('Informe o nome do ?lbum ou artista para pesquisar.');return;}
    setAlbumSearchBusy(true);setAlbumSearchResults([]);setAlbumCoverUrl('');
    try {
      const params=new URLSearchParams({query,fmt:'json',limit:'8'});
      const response=await fetch(`https://musicbrainz.org/ws/2/release/?${params}`,{headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error('MusicBrainz indispon?vel.');
      const releases=(await response.json()).releases||[];
      if(!releases.length)throw new Error('Nenhum lan?amento encontrado.');
      const groupParams=new URLSearchParams({query:`releasegroup:\"${albumTitle}\"${albumArtist?` AND artist:\"${albumArtist}\"`:''}`,fmt:'json',limit:'8'});
      const groupPayload=await fetch(`https://musicbrainz.org/ws/2/release-group/?${groupParams}`,{headers:{Accept:'application/json'}}).then(r=>r.ok?r.json():null).catch(()=>null);
      const releaseGroups=groupPayload?.['release-groups']||[];
      const results=await Promise.all(releases.map(async release=>{
        const artist=release['artist-credit']?.map(item=>item.name||item.artist?.name).filter(Boolean).join(', ')||'';
        const normalized=String(release.title||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
        const group=releaseGroups.find(item=>String(item.title||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()===normalized)||releaseGroups[0];
        const art=group?await coverArtForRelease({id:release.id,releaseGroupId:group.id})||await coverArtForRelease(release):await coverArtForRelease(release);
        return {...release,artist,coverUrl:art?.url||'',coverSource:art?.source||''};
      }));
      setAlbumSearchResults(results);
      setNotice(`${results.length} lan?amentos encontrados. Escolha a edi??o correta; algumas podem n?o ter capa cadastrada.`);
    } catch(error){setNotice(error.message);} finally{setAlbumSearchBusy(false);}
  }
  function chooseMusicBrainzAlbum(choice){setAlbumTitle(choice.title||albumTitle);setAlbumArtist(choice.artist||albumArtist);setAlbumCoverUrl(choice.coverUrl||'');setAlbumCoverProof('');setAlbumSearchResults([]);setNotice(choice.coverUrl?'Edi??o selecionada com capa. Revise antes de criar.':'Edi??o selecionada sem capa no Cover Art Archive. Informe uma URL de capa ou escolha outra edi??o.');}
  async function uploadBulkAlbum(event) {
    event.preventDefault();if(!bulkRows.length){setNotice('Selecione arquivos de áudio primeiro.');return;}if(bulkRows.some(row=>!row.title.trim()||!row.artist.trim()||!row.album.trim())){setNotice('Preencha título, artista e álbum em todas as faixas.');return;}
    setBulkBusy(true);
    try { const uploaded=[];for(const row of bulkRows){const fd=new FormData();fd.set('title',row.title.trim());fd.set('artist',row.artist.trim());fd.set('album',row.album.trim());fd.set('duration',String(row.duration));fd.set('audio',row.file,row.file.name);fd.set('metadata',JSON.stringify(row.metadata||{}));if(row.cover&&!row.coverUrl)fd.set('cover',row.cover,`${row.file.name.replace(/\.[^.]+$/,'')}-cover.jpg`);if(row.coverUrl)fd.set('metadata',JSON.stringify({...row.metadata,coverUrl:row.coverUrl,coverSource:row.coverSource}));const result=await apiRequest('/api/tracks',{method:'POST',body:fd});uploaded.push({id:result.id,album:row.album.trim(),artist:row.artist.trim()});}const groups=new Map();uploaded.forEach(track=>{const key=`${track.album.toLocaleLowerCase()}|${track.artist.toLocaleLowerCase()}`;const group=groups.get(key)||{title:track.album,artist:track.artist,trackIds:[]};group.trackIds.push(track.id);groups.set(key,group);});for(const album of groups.values())await apiRequest('/api/albums',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(album)});setData(await apiRequest('/api/library'));setBulkRows([]);setNotice(`${uploaded.length} faixas enviadas e agrupadas em ${groups.size} álbuns.`); }
    catch(error){setData(await apiRequest('/api/library').catch(()=>data));setNotice(`Envio em lote interrompido: ${error.message}. As faixas já enviadas permanecem na biblioteca.`);}
    finally{setBulkBusy(false);}
  }
  async function removeTrack(id) { try { await apiRequest(`/api/tracks/${id}`, { method: 'DELETE' }); const library = await apiRequest('/api/library'); setData(library); if (id === currentId) { setCurrentId(null); setPlaying(false); } setNotice('Música removida da biblioteca compartilhada.'); } catch (error) { setNotice(`Não foi possível remover a música: ${error.message}`); } }
  async function removePlaylist(id) { try { await apiRequest(`/api/playlists/${id}`, { method: 'DELETE' }); const library = await apiRequest('/api/library'); setData(library); if (selectedPlaylist === id) setSelectedPlaylist(''); setNotice('Playlist removida.'); } catch (error) { setNotice(`Não foi possível remover a playlist: ${error.message}`); } }
  function goSection(label) { setSection(label); if (label !== 'Playlists') setSelectedPlaylist(''); if (label === 'Explorar') setQuery(''); if (label === 'Favoritos') setQuery(''); if (label === 'Histórico') setQuery(''); }
  function statusTitle() { if (section === 'Histórico') return 'Histórico de reprodução'; if (section === 'Favoritos') return 'Suas músicas favoritas'; if (section === 'Explorar') return 'Explore sua biblioteca'; if (section === 'Biblioteca') return 'Sua biblioteca de playlists'; if (section === 'Playlists') return selected?.name || 'Suas playlists'; return current ? 'Reproduzindo agora' : 'Sua música começa aqui'; }
  function playButtonAction() { if (!current) { setSection('Configurações'); return; } setPlaying(value => !value); }

  if (!authReady || !ready) return <main className="auth-gate loading-gate"><span className="brand-mark"><img src={brandIcon} alt=""/></span><strong>Consona</strong><p>Preparando sua biblioteca…</p></main>;
  if (!currentUser) return <AuthLanding onUserChange={handleUserChange} brandIcon={brandIcon}/>;

  return <div className="desktop">
    <header className="topbar"><button className="brand" onClick={() => { setSection('Reproduzindo'); setSelectedPlaylist(''); }}><span className="brand-mark"><img src={brandIcon} alt=""/></span><span>Consona</span></button><nav className={`top-nav ${mobileMore ? "expanded" : ""}`}><button className={`top-link ${section === 'Reproduzindo' ? 'selected' : ''}`} onClick={() => goSection('Reproduzindo')}><Home/>Início</button><button className={`top-link ${section === 'Explorar' ? 'selected' : ''}`} onClick={() => goSection('Explorar')}><Search/>Explorar</button><button className={`top-link ${section === 'Biblioteca' ? 'selected' : ''}`} onClick={() => goSection('Biblioteca')}><Library/>Biblioteca</button><button className={`top-link ${section === 'Playlists' ? 'selected' : ''}`} onClick={() => goSection('Playlists')}><ListMusic/>Playlists</button><button className={`top-link ${section === 'Favoritos' ? 'selected' : ''}`} onClick={() => goSection('Favoritos')}><Heart/>Favoritos</button><button className={`top-link ${section === 'Histórico' ? 'selected' : ''}`} onClick={() => goSection('Histórico')}><Clock3/>Histórico</button><button className={`top-link ${section === 'Álbuns' ? 'selected' : ''}`} onClick={() => {goSection('Álbuns');setSelectedAlbum('');}}><Disc3/>Álbuns</button><button className={`top-link ${section === 'Configurações' ? 'selected' : ''}`} onClick={() => goSection('Configurações')}><Settings/>Configurações</button><button className="top-link mobile-more" aria-expanded={mobileMore} onClick={() => setMobileMore(value => !value)}><Settings/>Mais</button></nav><AccountControl user={currentUser} onUserChange={handleUserChange}/><div className="window-controls"><button aria-label="Minimizar">−</button><button aria-label="Maximizar">□</button><button className="close" aria-label="Fechar">×</button></div></header>
    {section === 'Configurações' ? <main className="settings-page"><div className="settings-title"><span><Settings size={23}/></span><div><h1>Configurações</h1><p>Gerencie sua biblioteca e personalize suas músicas.</p></div></div><div className="settings-tabs"><button className={settingsTab === 'music' ? 'active' : ''} onClick={() => setSettingsTab('music')}><Music2 size={16}/>Adicionar música</button><button className={settingsTab === 'playlists' ? 'active' : ''} onClick={() => setSettingsTab('playlists')}><ListMusic size={16}/>Criar playlist</button></div>{settingsTab === 'music' ? <form className="music-form" onSubmit={addTrack}><div className="form-section-title"><Disc3 size={20}/><div><strong>Informações da música</strong><small>Preencha os dados que serão exibidos no player.</small></div></div><div className="metadata-lookup"><button className="audio-select" type="button" onClick={lookupLastfm} disabled={lookupState==='loading'}><Search size={16}/>{lookupState==='loading'?'Buscando no Last.fm?':'Buscar dados no Last.fm'}</button><span>Os dados so entram nos campos quando voce aplicar a sugest?o.</span>{lookupError&&<p className="lookup-error">{lookupError}</p>}{lookup&&<div className="lookup-preview"><strong>Previa do Last.fm</strong><p><b>{lookup.title}</b> - {lookup.artist}{lookup.album?` - ${lookup.album}`:''}</p><div className="lookup-facts">{lookup.duration>0&&<span>Duracao: {formatTime(lookup.duration)}</span>}{lookup.listeners&&<span>{Number(lookup.listeners).toLocaleString('pt-BR')} ouvintes</span>}{lookup.playcount&&<span>{Number(lookup.playcount).toLocaleString('pt-BR')} reproducoes</span>}</div>{lookup.tags.length>0&&<p>Tags: {lookup.tags.join(', ')}</p>}{lookup.albumRelease&&<p>Lancamento do album: {lookup.albumRelease}</p>}{lookup.artistTags.length>0&&<p>Estilos do artista: {lookup.artistTags.join(', ')}</p>}{lookup.artistSummary&&<p className="lookup-summary">Sobre {lookup.artist}: {lookup.artistSummary}</p>}{lookup.summary&&<p className="lookup-summary">{lookup.summary}</p>}<div className="lookup-actions"><button className="audio-select" type="button" onClick={applyLookup}>Aplicar sugestao</button>{lookup.url&&<a href={lookup.url} target="_blank" rel="noreferrer">Ver no Last.fm <ExternalLink size={13}/></a>}</div></div>}</div><div className="form-grid"><label>Nome da música<input value={form.title} onChange={e => setForm({...form,title:e.target.value})} placeholder="Ex.: Minha música" required/></label><label>Artista<input value={form.artist} onChange={e => setForm({...form,artist:e.target.value})} placeholder="Nome do artista" required/></label><label>Álbum<input value={form.album} onChange={e => setForm({...form,album:e.target.value})} placeholder="Nome do álbum" required/></label></div><MusicVerification title={form.title} artist={form.artist} onApply={item => { setMusicBrainzMatch(item); setForm(value => ({...value, title:item.title, artist:item.artist || value.artist, album:item.album || value.album})); if (!audioFile && item.duration) setAudioDuration(item.duration); }}/><div className="form-section-title image-section-title"><span className="section-rule"/><strong>Imagens personalizadas</strong><small>As imagens são opcionais e podem ser adicionadas agora.</small></div><div className="image-pickers"><button type="button" className="image-picker" onClick={() => mainPicker.current?.click()}><span className="image-preview main-preview" style={{backgroundImage:mainImage?`url("${mainImage}")`:undefined}}>{!mainImage&&<Plus size={21}/>}</span><span><strong>Imagem principal do player</strong><small>Imagem de fundo exibida no painel de reprodução.</small><em>{mainImage?'Imagem selecionada':'Escolher imagem'}</em></span></button><button type="button" className="image-picker" onClick={() => coverPicker.current?.click()}><span className="image-preview cover-preview" style={{backgroundImage:coverImage?`url("${coverImage}")`:undefined}}>{!coverImage&&<Plus size={21}/>}</span><span><strong>Capa da música</strong><small>Capa exibida junto aos detalhes e na biblioteca.</small><em>{coverImage?'Capa selecionada':'Escolher capa'}</em></span></button></div><div className="image-search-buttons"><button type="button" onClick={()=>{setImageDialog('main');setImageKind('image');setImageQuery(`${form.title} ${form.artist}`.trim());setImageState('idle');setImageResults([]);}}>Pesquisar imagem principal</button><button type="button" onClick={()=>{setImageDialog('cover');setImageKind('image');setImageQuery(`${form.title} ${form.artist} album cover`.trim());setImageState('idle');setImageResults([]);}}>Pesquisar capa</button><button type="button" onClick={()=>{setImageDialog('cover');setImageKind('gif');setImageQuery(`${form.title} ${form.artist}`.trim());setImageState('idle');setImageResults([]);}}>Pesquisar GIF</button></div><div className="audio-picker"><input ref={audioPicker} type="file" accept="audio/*" onChange={e => loadFile(e.target.files?.[0])}/><button type="button" className="audio-select" onClick={() => audioPicker.current?.click()}><Plus size={18}/>{audioFile?'Trocar arquivo de música':'Selecionar arquivo de música'}</button><span>{audioFile ? audioFile.name : 'Áudio MP3, WAV, OGG ou outro formato compatível com seu navegador.'}</span></div><button className="save-track" type="submit"><Plus size={17}/>Adicionar à biblioteca</button></form>  : <div className="playlist-form-panel"><form onSubmit={createPlaylist}><label>Nome da playlist<input value={playlistName} onChange={e => setPlaylistName(e.target.value)} placeholder="Ex.: Viagem, favoritos..." required/></label><p>Selecione as músicas que deseja incluir nesta playlist.</p><div className="playlist-select-list">{tracks.map(track=><label key={track.id}><input type="checkbox" checked={playlistSelection.includes(track.id)} onChange={event => setPlaylistSelection(ids => event.target.checked ? [...ids,track.id] : ids.filter(id => id!==track.id))}/><span>{track.title}<small>{track.artist}</small></span></label>)}</div><button className="save-track" type="submit"><Plus size={17}/>Criar playlist</button></form><div className="settings-playlist-list"><h3>Playlists criadas ({playlists.length})</h3>{playlists.map(list=><div key={list.id}><span><ListMusic size={17}/>{list.name}<small>{list.trackIds.length} músicas</small></span><button type="button" onClick={() => removePlaylist(list.id)} aria-label={`Excluir ${list.name}`}><X size={15}/></button></div>)}</div></div>}<div className="storage-note">Biblioteca compartilhada: músicas, favoritos, histórico e playlists são visíveis para todos os visitantes.</div></main> : section === '\u00c1lbuns' ? <main className="albums-page"><div className="collection-heading"><div><span className="collection-icon"><Disc3/></span><div><h1>{activeAlbum?.title || '\u00c1lbuns'}</h1>{activeAlbum?.addedBy&&<small className="contributor-badge">{activeAlbum.addedBy.avatar&&<img src={activeAlbum.addedBy.avatar} alt=""/>}Adicionado por {activeAlbum.addedBy.displayName}</small>}<p>{activeAlbum ? `${activeAlbum.artist || '\u00c1lbum'} ? ${activeAlbum.trackIds.length} faixas` : `${albums.length} ?lbuns compartilhados`}</p></div></div>{activeAlbum&&<button className="create-playlist-top" onClick={()=>setSelectedAlbum('')}>Todos os &#225;lbuns</button>}</div>{activeAlbum?<><div className="album-detail-tools"><span>Arraste as faixas para alterar a ordem do &#225;lbum.</span><button onClick={async()=>{const title=window.prompt("Nome do álbum",activeAlbum.title);if(title===null)return;const artist=window.prompt("Artista do álbum",activeAlbum.artist||"");if(artist===null)return;const coverUrl=window.prompt("URL da capa (Cover Art Archive ou Wikimedia)",activeAlbum.cover||"");if(coverUrl===null)return;try{await apiRequest(`/api/albums/${activeAlbum.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,artist,coverUrl})});setData(await apiRequest("/api/library"));setNotice("Dados do álbum atualizados.");}catch(error){setNotice(error.message);}}}>Editar dados e capa</button><button disabled={!activeAlbum.cover||bulkCoverBusy} onClick={applyAlbumCoverToTracks}>{bulkCoverBusy?'Aplicando capa?':'Aplicar capa do ?lbum a todas as m?sicas'}</button><button onClick={()=>deleteAlbum(activeAlbum.id)}>Excluir &#225;lbum</button></div><div className="collection-track-list">{activeAlbum.trackIds.map((id,index)=>{const track=tracks.find(item=>item.id===id);return track?<div className="collection-track album-track-row" key={id} draggable onDragStart={event=>event.dataTransfer.setData('text/plain',String(index))} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const from=Number(event.dataTransfer.getData('text/plain'));const ids=[...activeAlbum.trackIds];const [moved]=ids.splice(from,1);ids.splice(index,0,moved);setData(value=>({...value,albums:value.albums.map(album=>album.id===activeAlbum.id?{...album,trackIds:ids}:album)}));saveAlbumOrder(activeAlbum.id,ids);}}><span className="album-order-handle">&#9776;</span><button className="collection-track-art" onClick={()=>pickTrack(track)} style={{backgroundImage:track.cover?`url("${track.cover}")`:undefined}}>{!track.cover&&<Disc3 size={18}/>}</button><button className="collection-track-title" onClick={()=>pickTrack(track)}><strong>{track.title}</strong><small>{track.artist} ? {track.album}</small>{track.addedBy&&<small className="contributor-badge">{track.addedBy.avatar&&<img src={track.addedBy.avatar} alt=""/>}Adicionado por {track.addedBy.displayName}</small>}</button><span className="track-duration">{track.duration}</span><button type="button" className="audio-select" onClick={()=>{setImageDialog(`track:${track.id}`);setImageKind('image');setImageQuery(`${track.title} ${track.artist} ${track.album} album cover`.trim());setImageState('idle');setImageResults([]);}}>Wikimedia</button><button type="button" className="audio-select" onClick={()=>checkAlbumTrackCover(track)} disabled={albumCoverChecks[track.id]?.state==='loading'}>{albumCoverChecks[track.id]?.state==='loading'?'Verificando?':'Verificar capa'}</button>{albumCoverChecks[track.id]?.candidates?.map((candidate,index)=><div className="cover-check-preview" key={`${candidate.releaseId||candidate.source}-${index}`}><img src={candidate.url} alt={`Capa candidata para ${track.title}`}/><span>{candidate.label} ? {candidate.source}</span><button type="button" className="audio-select" onClick={()=>applyAlbumTrackCover(track,candidate)}>Usar capa</button></div>)}{albumCoverChecks[track.id]?.error&&<small className="cover-check-error">{albumCoverChecks[track.id].error}</small>}</div>:null;})}{!activeAlbum.trackIds.length&&<div className="collection-empty">Este &#225;lbum ainda n&#227;o tem faixas.</div>}</div><div className="album-existing-picker"><strong>Adicionar faixas existentes</strong><div>{tracks.filter(track=>!activeAlbum.trackIds.includes(track.id)).map(track=><label key={track.id}><input type="checkbox" checked={albumSelection.includes(track.id)} onChange={event=>setAlbumSelection(ids=>event.target.checked?[...ids,track.id]:ids.filter(id=>id!==track.id))}/>{track.title} ? {track.artist}</label>)}</div><button className="audio-select" onClick={()=>{const ids=[...activeAlbum.trackIds,...albumSelection.filter(id=>!activeAlbum.trackIds.includes(id))];saveAlbumOrder(activeAlbum.id,ids);setAlbumSelection([]);}}>Adicionar selecionadas</button></div></>:<><div className="album-create-columns"><form className="album-create-card" onSubmit={createAlbum}><h2>Criar &#225;lbum</h2><label>Nome do &#225;lbum<input value={albumTitle} onChange={event=>setAlbumTitle(event.target.value)} placeholder="Nome do &#225;lbum" required/></label><label>Artista<input value={albumArtist} onChange={event=>setAlbumArtist(event.target.value)} placeholder="Artista (opcional)"/></label><button type="button" className="audio-select" disabled={albumSearchBusy} onClick={searchMusicBrainzAlbum}><Search size={15}/>{albumSearchBusy?'Pesquisando…':'Pesquisar MusicBrainz + capa'}</button><button type="button" className="audio-select" onClick={()=>{setImageDialog('album');setImageKind('image');setImageQuery(`${albumTitle} ${albumArtist} album cover`.trim());setImageState('idle');setImageResults([]);}}>Buscar outra capa (Wikimedia Commons)</button>{albumSearchResults.length>0&&<div className="album-search-results"><strong>Escolha o lancamento correto</strong>{albumSearchResults.map(choice=><div className="album-search-result" key={choice.id}>{choice.coverUrl?<img src={choice.coverUrl} alt=""/>:<span className="album-search-no-cover">Sem capa</span>}<span><b>{choice.title}</b><small>{choice.artist}{choice.date?` ? ${choice.date.slice(0,4)}`:''}{choice.country?` ? ${choice.country}`:''}{choice.status?` ? ${choice.status}`:''}</small></span><button type="button" className="audio-select" onClick={()=>chooseMusicBrainzAlbum(choice)}>Usar esta edicao</button></div>)}</div>}<label>Capa do álbum (URL)<input value={albumCoverUrl} onChange={event=>{setAlbumCoverUrl(event.target.value);setAlbumCoverProof('');}} placeholder="URL da capa ou use a busca acima"/></label>{albumCoverUrl?<img src={albumCoverUrl} alt="Previa da capa" style={{width:100,aspectRatio:'1',objectFit:'cover',borderRadius:8}}/>:albumTitle&&<small className="cover-check-error">Sem capa selecionada. Escolha uma edicao com capa ou informe outra URL.</small>}<strong>Selecionar m&#250;sicas existentes</strong><div className="album-existing-checks">{tracks.map(track=><label key={track.id}><input type="checkbox" checked={albumSelection.includes(track.id)} onChange={event=>setAlbumSelection(ids=>event.target.checked?[...ids,track.id]:ids.filter(id=>id!==track.id))}/><span>{track.title}<small>{track.artist} ? {track.album}</small></span></label>)}{!tracks.length&&<small>Adicione faixas primeiro ou use o envio em lote abaixo.</small>}</div><button className="save-track"><Plus size={16}/>Criar &#225;lbum</button></form><form className="album-create-card bulk-album-card" onSubmit={uploadBulkAlbum}><h2>Adicionar MP3s e agrupar em &#225;lbuns</h2><p>Selecione uma pasta inteira ou v&#225;rios arquivos. Tags ID3, nomes e pastas sugerem os dados; confira, pesquise e ordene antes do envio.</p><input ref={bulkPicker} type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac" multiple onChange={event=>stageBulkFiles(event.target.files)}/><input ref={bulkFolderPicker} type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac" multiple webkitdirectory="true" onChange={event=>stageBulkFiles(event.target.files)}/><button type="button" className="audio-select" onClick={()=>bulkPicker.current?.click()}><Plus size={16}/>Selecionar arquivos</button><button type="button" className="audio-select" onClick={()=>bulkFolderPicker.current?.click()}>Selecionar pasta</button><div className="bulk-track-list">{bulkRows.map((row,index)=><div className="bulk-track-row" key={row.key} draggable onDragStart={event=>event.dataTransfer.setData('text/plain',String(index))} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();reorderBulk(Number(event.dataTransfer.getData('text/plain')),index);}}><span className="album-order-handle">&#9776;</span><div><input aria-label="Nome da m&#250;sica" value={row.title} onChange={event=>setBulkRows(rows=>rows.map(item=>item.key===row.key?{...item,title:event.target.value}:item))}/><input aria-label="Artista" placeholder="Artista" value={row.artist} onChange={event=>setBulkRows(rows=>rows.map(item=>item.key===row.key?{...item,artist:event.target.value}:item))}/><input aria-label="&#193;lbum" placeholder="&#193;lbum / grupo" value={row.album} onChange={event=>setBulkRows(rows=>rows.map(item=>item.key===row.key?{...item,album:event.target.value}:item))}/></div><button type="button" onClick={()=>suggestBulkRow(row.key)}>Last.fm</button><button type="button" onClick={()=>suggestMusicBrainzTrack(row.key)}>MB</button><button type="button" onClick={()=>{setImageDialog(`bulk:${row.key}`);setImageKind('image');setImageQuery(`${row.title} ${row.artist} ${row.album} album cover`.trim());setImageState('idle');setImageResults([]);}}>Wikimedia</button><button type="button" onClick={()=>checkBulkCover(row.key)} disabled={row.coverLookup==='loading'}>{row.coverLookup==='loading'?'Buscando?':'Verificar capa'}</button><button type="button" onClick={()=>setBulkRows(rows=>rows.filter(item=>item.key!==row.key))} aria-label="Remover faixa">?</button>{row.coverCandidates?.map((candidate,index)=><div className={`cover-check-preview ${row.coverUrl===candidate.url?'selected':''}`} key={`${candidate.releaseId||candidate.source}-${index}`}><img src={candidate.url} alt={`Capa candidata para ${row.title}`}/><span>{candidate.label} ? {candidate.source}{row.coverUrl===candidate.url?' ? selecionada':''}</span><button type="button" className="audio-select" onClick={()=>chooseBulkCover(row.key,candidate)}>Usar</button></div>)}{row.coverError&&<small className="cover-check-error">{row.coverError}</small>}</div>)}</div>{bulkRows.length>0&&<button className="save-track" disabled={bulkBusy}>{bulkBusy?'Enviando arquivos?':`Enviar ${bulkRows.length} faixas e criar ?lbuns`}</button>}</form></div><div className="album-grid">{albums.map(album=><button className="playlist-tile" key={album.id} onClick={()=>{setSelectedAlbum(album.id);setAlbumSelection([]);}}><span className="playlist-tile-art" style={album.cover?{backgroundImage:`url("${album.cover}")`}:undefined}><Disc3 size={30}/></span><strong>{album.title}</strong><small>{album.artist||'V&#225;rios artistas'} ? {album.trackIds.length} faixas</small>{album.addedBy&&<small className="contributor-badge">{album.addedBy.avatar&&<img src={album.addedBy.avatar} alt=""/>}Adicionado por {album.addedBy.displayName}</small>}</button>)}{!albums.length&&<div className="collection-empty">Seus &#225;lbuns aparecer&#227;o aqui.</div>}</div></>}</main> : section !== 'Reproduzindo' ? <main className="collection-page"><div className="collection-heading"><div><span className="collection-icon">{section==='Histórico'?<Clock3/>:section==='Favoritos'?<Heart/>:section==='Explorar'?<Search/>:<Library/>}</span><div><h1>{selected?.name || (section==='Histórico'?'Histórico':section==='Favoritos'?'Favoritos':section==='Explorar'?'Explorar músicas':section==='Biblioteca'?'Biblioteca':'Playlists')}</h1><p>{selected ? `${selected.trackIds.length} músicas` : section==='Histórico'?'Suas reproduções recentes':section==='Favoritos'?'Músicas que você curtiu':section==='Explorar'?'Encontre uma música na sua biblioteca':section==='Biblioteca'?'Todos os ?lbuns com m?sicas na biblioteca':'Suas playlists em coleções'}</p></div></div>{section==='Explorar'&&<div className="collection-search"><Search size={17}/><input placeholder="Buscar música, artista ou álbum" value={query} onChange={event => setQuery(event.target.value)}/></div>}{section==='Playlists'&&<button className="create-playlist-top" onClick={openPlaylistDialog}><Plus size={17}/>Criar playlist</button>}</div>{section==='Biblioteca'&&!selectedAlbum?<div className="playlist-grid">{libraryAlbums.map(album=><button className="playlist-tile" key={album.id} onClick={()=>setSelectedAlbum(album.id)}><span className="playlist-tile-art" style={{backgroundImage:album.cover?`url("${album.cover}")`:undefined}}><Disc3 size={30}/></span><strong>{album.title}</strong><small>{album.artist} ? {album.trackIds.length} faixas</small>{album.addedBy&&<small className="contributor-badge">{album.addedBy.avatar&&<img src={album.addedBy.avatar} alt=""/>}Adicionado por {album.addedBy.displayName}</small>}</button>)}{!libraryAlbums.length&&<div className="collection-empty">Ainda n?o h? ?lbuns com m?sicas na biblioteca.</div>}</div>:section==='Playlists'&&!selected?<div className="playlist-grid">{playlists.map(list=><button className="playlist-tile" key={list.id} onClick={() => setSelectedPlaylist(list.id)}><span className="playlist-tile-art" style={{backgroundImage:list.cover?`url("${list.cover}")`:undefined}}><ListMusic size={30}/></span><strong>{list.name}</strong><small>{list.trackIds.length} m?sicas</small></button>)}{!playlists.length&&<div className="collection-empty">Ainda n?o h? playlists. Use o bot?o + para criar uma.</div>}</div>:<div className="collection-track-list">{(section==='Biblioteca'&&selectedAlbum ? (libraryAlbums.find(item=>item.id===selectedAlbum)?.trackIds||[]) .map(id=>tracks.find(track=>track.id===id)).filter(Boolean) : visibleTracks).map((track,index)=><div className="collection-track" key={`${track.id}-${index}`}><button className="collection-track-art" onClick={() => pickTrack(track)} style={{backgroundImage:track.cover?`url("${track.cover}")`:undefined}}>{!track.cover&&<Disc3 size={19}/>}</button><button className="collection-track-title" onClick={() => pickTrack(track)}><strong>{track.title}</strong><small>{track.artist} · {track.album}</small>{section==='Biblioteca'&&track.addedBy&&<small className="contributor-badge">{track.addedBy.avatar&&<img src={track.addedBy.avatar} alt=""/>}Adicionado por {track.addedBy.displayName}</small>}</button><button className={`collection-heart ${favorites.includes(track.id)?'liked':''}`} onClick={() => toggleFavorite(track.id)} aria-label="Curtir música"><Heart size={17} fill={favorites.includes(track.id)?'currentColor':'none'}/></button><button className="collection-add" onClick={() => {setCurrentId(track.id);setPlaylistSelection([track.id]);setPlaylistDialog(true);}} aria-label="Adicionar à playlist"><Plus size={18}/></button></div>)}{!visibleTracks.length&&<div className="collection-empty">{section==='Histórico'?'As músicas tocadas aparecerão aqui.':section==='Favoritos'?'As músicas curtidas aparecerão aqui.':selected?'Esta playlist ainda não tem músicas.':'Nenhuma música encontrada.'}</div>}</div>}{(selected||selectedAlbum)&&<button className="back-playlists" onClick={() => {setSelectedPlaylist('');setSelectedAlbum('');}}>← Todas as playlists</button>}{section==='Recomendações'&&null}</main> : <>
    <main className="player-window"><div className="window-gloss"><span/><span/><span/></div><div className="workspace"><aside className="sidebar"><div className="side-label">Minha música</div>{sections.map(({label,icon:Icon})=><button key={label} className={`side-link ${section===label?'active':''}`} onClick={() => goSection(label)}><Icon size={18}/>{label}</button>)}<div className="sidebar-bottom"><Disc3 size={20}/><span>Coleção pessoal</span><b>{tracks.length}</b></div></aside>
      <section className="center-panel"><div className="now-heading"><div className="now-title"><Music2 size={21}/><strong>{current?.title || statusTitle()}</strong>{current&&<span className="quality">HQ</span>}</div><div className="now-sub">{current ? `${current.artist} — ${current.album}` : 'Adicione suas músicas em Configurações'}</div></div><div className="art-stage" style={{'--hero-art':current?.mainArt?`url("${current.mainArt}")`:'none'}}><div className="stage-gradient"/><LyricsStage track={current} elapsed={elapsed} playing={playing} onSave={saveLyrics} audioRef={audioRef}/>{!current&&<div className="empty-main"><span className="empty-disc"><Disc3 size={48}/></span><h1>{statusTitle()}</h1><p>Suas músicas e imagens aparecem aqui depois que você as adicionar.</p><button onClick={() => goSection('Configurações')}><Plus size={17}/>Adicionar primeira música</button></div>}<div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/></div><div className="status-line"><span className="mini-disc"><Disc3 size={15}/></span>{current&&<><span className="live-dot"/><span className="status-text">{playing?'Reproduzindo':'Pausado'}: {current.title}</span></>}<span className="time-readout">{current?`${formatTime(elapsed)} / ${displayDuration(current.duration || current.seconds)}`:'00:00 / 00:00'}</span></div><div className="transport"><div className="transport-buttons"><button className="round-control" aria-label="Anterior" disabled={!tracks.length} onClick={() => advance(-1)}><SkipBack size={16} fill="currentColor"/></button><button className="round-control primary" aria-label={playing?'Pausar':'Reproduzir'} disabled={!current} onClick={playButtonAction}>{playing?<Pause size={19} fill="currentColor"/>:<Play size={19} fill="currentColor"/>}</button><button className="round-control" aria-label="Próxima" disabled={!tracks.length} onClick={() => advance(1)}><SkipForward size={16} fill="currentColor"/></button><button className="round-control" aria-label="Parar" disabled={!current} onClick={stop}><Square size={13} fill="currentColor"/></button><button className={`round-control soft ${shuffle?'toggled':''}`} aria-label="Aleatório" disabled={!tracks.length} onClick={() => setShuffle(!shuffle)}><Shuffle size={16}/></button></div><div className="volume-control"><Volume2 size={21}/><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={e => setVolume(+e.target.value)} style={{'--range-fill':`${volume}%`}}/><span>{volume}%</span></div><div className="timeline"><input aria-label="Posição da música" type="range" min="0" max={seconds} step="0.1" value={Math.min(elapsed,seconds)} disabled={!current} onInput={e => {const value=Number(e.currentTarget.value);setElapsed(value);if(audioRef.current)audioRef.current.currentTime=value;}} onChange={e => {const value=Number(e.currentTarget.value);setElapsed(value);if(audioRef.current)audioRef.current.currentTime=value;}} style={{'--range-fill':`${current?Math.min(100,elapsed/seconds*100):0}%`}}/><button aria-label="Repetir" className={`repeat-button ${repeat?'toggled':''}`} onClick={() => setRepeat(!repeat)}><Repeat2 size={16}/></button></div><button className="round-control fullscreen" aria-label="Tela cheia" onClick={() => document.querySelector('.player-window')?.requestFullscreen?.()}><Expand size={17}/></button></div></section>
      <aside className="info-panel"><div className="info-head">Informações da Música <ChevronDown size={15}/></div>{current?<div className="info-content"><div className="album-cover" style={{backgroundImage:current.cover?`url("${current.cover}")`:undefined}}>{!current.cover&&<Disc3 size={35}/>}</div><h2>{current.title}</h2><dl><dt>Artista:</dt><dd>{current.artist}</dd><dt>Álbum:</dt><dd>{current.album}</dd></dl><div className="info-actions"><button className={favorites.includes(current.id)?'liked':''} aria-label="Favoritar" onClick={() => toggleFavorite(current.id)}><Heart size={17} fill={favorites.includes(current.id)?'currentColor':'none'}/></button><button aria-label="Criar playlist" onClick={openPlaylistDialog}><Plus size={20}/></button><button aria-label="Remover música" onClick={() => removeTrack(current.id)}><X size={19}/></button></div><div className="library-hint"><span>♪</span> Parte da sua coleção pessoal</div></div>:<div className="empty-info"><Disc3 size={29}/><span>Nenhuma música<br/>selecionada</span></div>}</aside></div></main>
    <section className="lower-grid"><article className="widget queue-widget"><div className="widget-head"><span className="widget-icon list-icon"><ListMusic size={20}/></span><h3>{section==='Histórico'?'Histórico':section==='Favoritos'?'Favoritos':selected?selected.name:section==='Playlists'?'Playlists':section==='Biblioteca'?'Playlists da Biblioteca':section==='Explorar'?'Resultados da busca':'Fila de Reprodução'}</h3><span className="widget-count">{visibleTracks.length} faixas</span></div><div className="queue-tools"><div className="search-field"><Search size={14}/><input placeholder="Buscar músicas..." value={query} onChange={e => setQuery(e.target.value)}/></div><button aria-label="Adicionar música" onClick={() => goSection('Configurações')}><Plus size={17}/></button></div><div className="track-list">{visibleTracks.slice(0,5).map(track=><button className={`track-row ${track.id===currentId?'current':''}`} key={track.id} onClick={() => pickTrack(track)}><span className="track-art" style={{backgroundImage:track.cover?`url("${track.cover}")`:undefined}}>{!track.cover&&<Disc3 size={16}/>}</span><span className="track-copy"><strong>{track.title}</strong><small>{track.artist}</small></span><span className="track-duration">{track.duration}</span></button>)}</div>{!visibleTracks.length&&<div className="empty-list">{section==='Histórico'?'As músicas que você reproduzir aparecerão aqui.':section==='Favoritos'?'Marque o coração de uma música para encontrá-la aqui.':section==='Playlists'&&selected?'Esta playlist ainda não tem músicas.':'Adicione músicas em Configurações para preencher sua biblioteca.'}</div>}</article>
      <article className="widget playlist-widget"><div className="widget-head"><span className="widget-icon star-icon">✦</span><h3>Suas Playlists</h3><div className="carousel-controls"><button aria-label="Playlists anteriores" disabled={!playlists.length} onClick={() => setCarousel(i => (i-1+playlists.length)%playlists.length)}><ChevronLeft size={16}/></button><button aria-label="Próximas playlists" disabled={!playlists.length} onClick={() => setCarousel(i => (i+1)%playlists.length)}><ChevronRight size={16}/></button></div></div>{playlists.length?<div className="playlist-list">{carouselPlaylists.map(list=><button className="playlist-card" key={list.id} onClick={() => {setSelectedPlaylist(list.id);setSection('Playlists');}}><span className="playlist-art" style={{backgroundImage:list.cover?`url("${list.cover}")`:undefined}}><span className="playlist-play"><Play size={13} fill="currentColor"/></span></span><strong>{list.name}</strong><small>{list.trackIds.length} músicas</small></button>)}</div>:<div className="empty-playlists"><ListMusic size={25}/><span>Suas playlists criadas aparecerão aqui.</span><button onClick={() => {goSection('Configurações');setSettingsTab('playlists');}}><Plus size={14}/>Criar playlist</button></div>}<div className="carousel-dots">{playlists.map((list,i)=><button key={list.id} className={i===carousel?'active':''} onClick={() => setCarousel(i)}/>)}</div></article>
      <article className="widget recommendations"><div className="widget-head"><span className="widget-icon bars-icon"><AudioLines size={21}/></span><h3>Artistas recomendados</h3></div>{recommendationState==='loading'?<div className="lastfm-recommend-state">Buscando artistas similares?</div>:recommendationState==='error'?<div className="lastfm-recommend-state">N?o foi poss?vel consultar recomenda??es.</div>:recommendations.length?<div className="recommend-list">{recommendations.slice(0,5).map(artist=><div className="recommend-row" key={artist.name}><span className="recommend-art" style={{backgroundImage:artist.image?`url("${artist.image}")`:undefined}}><AudioLines size={13}/></span><span className="recommend-copy"><strong>{artist.name}</strong><small>Artista similar</small></span><a className="recommend-play" href={`https://www.last.fm/music/${encodeURIComponent(artist.name)}`} target="_blank" rel="noreferrer" aria-label={`Ver ${artist.name}`}><ExternalLink size={13}/></a></div>)}</div>:<div className="lastfm-recommend-state">Reproduza uma m?sica para ver sugest?es.</div>}</article></section>
    </>}
    <AudioVisualizer audioRef={audioRef} playing={playing}/>
    <audio ref={audioRef} crossOrigin="anonymous" onLoadedMetadata={e=>{const duration=e.currentTarget.duration;if(Number.isFinite(duration)){const secs=Math.floor(duration);setData(value=>({...value,tracks:value.tracks.map(track=>track.id===currentId?{...track,seconds:secs,duration:formatTime(secs)}:track)}));}}} onTimeUpdate={e=>{const time=e.currentTarget.currentTime;if(Math.abs(time-lastElapsedPaint.current)>=0.5){lastElapsedPaint.current=time;setElapsed(time);}}} onDurationChange={e=>{const duration=e.currentTarget.duration;if(Number.isFinite(duration)&&duration>0){const secs=Math.floor(duration);setData(value=>({...value,tracks:value.tracks.map(track=>track.id===currentId?{...track,seconds:secs,duration:formatTime(secs)}:track)}));}}} onEnded={()=>repeat?(audioRef.current.currentTime=0,audioRef.current.play()):advance(1)}/>
    <footer className="taskbar"><span className="taskbrand"><span className="taskbrand-mark"><img src={brandIcon} alt=""/></span>Consona</span><div className="mini-controls"><button aria-label="Faixa anterior" disabled={!tracks.length} onClick={()=>advance(-1)}><SkipBack size={14} fill="currentColor"/></button><button aria-label={playing?'Pausar':'Reproduzir'} disabled={!current} onClick={()=>setPlaying(value=>!value)}>{playing?<Pause size={16} fill="currentColor"/>:<Play size={16} fill="currentColor"/>}</button><button aria-label="Pr?xima faixa" disabled={!tracks.length} onClick={()=>advance(1)}><SkipForward size={14} fill="currentColor"/></button></div><div className="task-playing"><span className="equalizer">{current&&[0,1,2,3,4,5,6,7].map(i=><i key={i}/>)}</span><span>{current?`${current.title} — ${current.artist}`:'Nenhuma música adicionada'}</span></div><input className="mini-timeline" aria-label="Posi??o da m?sica" type="range" min="0" max={seconds} step="0.1" value={Math.min(elapsed,seconds)} disabled={!current} onChange={event=>{const value=Number(event.target.value);setElapsed(value);if(audioRef.current)audioRef.current.currentTime=value;}}/><span className="mini-time">{current?formatTime(elapsed):'00:00'} / {current?displayDuration(current.duration || current.seconds):'00:00'}</span><span className="task-clock">{new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date())}</span></footer>
    <input ref={mainPicker} className="hidden-input" type="file" accept="image/*" onChange={e => imageData(e.target.files?.[0],setMainImage)}/><input ref={coverPicker} className="hidden-input" type="file" accept="image/*" onChange={e => imageData(e.target.files?.[0],setCoverImage)}/>
    {imageDialog&&<div className="modal-scrim" onClick={()=>setImageDialog('')}><section className="settings-modal image-search-dialog" onClick={event=>event.stopPropagation()}><header><span><Search size={18}/> Pesquisar {imageKind==='gif'?'GIFs':'imagens'}</span><button type="button" onClick={()=>setImageDialog('')} aria-label="Fechar"><X size={19}/></button></header><form className="image-search-tools" onSubmit={searchImages}><input value={imageQuery} onChange={e=>setImageQuery(e.target.value)} placeholder="Artista, m?sica, ?lbum ou tema"/><select value={imageKind} onChange={e=>setImageKind(e.target.value)}><option value="image">Imagens</option><option value="gif">GIFs</option></select><button className="audio-select">Pesquisar Wikimedia</button><button type="button" className="audio-select" onClick={searchGoogleImages}>Pesquisar Google</button></form><div className="image-search-results">{imageResults.map((item,index)=><button type="button" key={`${item.source}-${index}`} onClick={()=>chooseRemoteImage(item)} title={item.title}><img src={item.url} loading="lazy" alt=""/><span>{item.title}</span><small>{item.license||'Licen?a n?o informada'}{item.artist?` ? ${item.artist}`:''}{item.source?` ? ${item.source}`:''}</small></button>)}{imageState==='loading'&&<p>Pesquisando imagens?</p>}{imageState==='empty'&&<p>Nenhum resultado encontrado.</p>}{imageState==='error'&&<p>Falha ao pesquisar. Tente novamente.</p>}{imageState==='idle'&&!imageResults.length&&<p>Pesquise por artista, m?sica, ?lbum ou tema visual.</p>}</div><p className="image-search-credit">Resultados do Wikimedia Commons ou Google Images. Confira a origem e os termos de uso antes de selecionar.</p></section></div>}
    {playlistDialog&&<div className="modal-scrim" onClick={() => setPlaylistDialog(false)}><section className="settings-modal playlist-dialog" onClick={event => event.stopPropagation()}><header><span><ListMusic size={19}/> Criar playlist</span><button onClick={() => setPlaylistDialog(false)} aria-label="Fechar"><X size={19}/></button></header><form className="modal-body" onSubmit={createPlaylist}><label className="dialog-name">Nome da playlist<input autoFocus value={playlistName} onChange={event => setPlaylistName(event.target.value)} placeholder="Ex.: Para ouvir depois" required/></label><strong className="dialog-select-title">Selecione as músicas</strong><div className="playlist-select-list dialog-track-select">{tracks.map(track=><label key={track.id}><input type="checkbox" checked={playlistSelection.includes(track.id)} onChange={event => setPlaylistSelection(ids => event.target.checked ? [...ids,track.id] : ids.filter(id => id!==track.id))}/><span>{track.title}<small>{track.artist}</small></span></label>)}</div>{!tracks.length&&<p className="empty-list">Adicione músicas à biblioteca para incluí-las aqui.</p>}{playlists.length>0&&<div className="existing-playlists"><strong>Ou adicione a seleção a uma playlist</strong>{playlists.map(list=><button type="button" key={list.id} onClick={() => addSelectionToPlaylist(list.id)}>{list.name}<Plus size={15}/></button>)}</div>}<button className="save-track" type="submit"><Plus size={17}/>Criar playlist</button></form></section></div>}
    {notice&&<div className="toast"><span className="toast-check">✓</span>{notice}</div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);



