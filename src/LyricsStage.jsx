import React, { useEffect, useMemo, useState } from 'react';
import { Disc3, ListMusic, Music2, Pencil, X } from 'lucide-react';

// LRC may contain more than one timestamp on a line and fractional seconds.
export function parseLyrics(text) {
  const lines = [];
  for (const line of (text || '').split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2}(?:[.:]\d{1,3})?)\]/g)];
    const words = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!words) continue;
    for (const stamp of stamps) lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2].replace(':', '.')), text: words });
  }
  return lines.sort((a, b) => a.time - b.time);
}

export default function LyricsStage({ track, elapsed, playing, onSave, audioRef }) {
  const [view, setView] = useState('lyrics');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [foundLyrics, setFoundLyrics] = useState('');
  const [searchState, setSearchState] = useState('idle');
  const [retry, setRetry] = useState(0);
  const savedLyrics = track?.metadata?.lyrics || '';
  const lyrics = savedLyrics || foundLyrics;
  const lines = useMemo(() => parseLyrics(lyrics), [lyrics]);
  const active = lines.findLastIndex(line => line.time <= elapsed);
  const plainLyrics = !lines.length && lyrics.trim();
  useEffect(() => { setEditing(false); setError(''); }, [track?.id]);
  useEffect(() => {
    setFoundLyrics('');
    if (savedLyrics || !track?.title?.trim() || !track?.artist?.trim()) { setSearchState('idle'); return; }
    const controller = new AbortController();
    const normalize = value => (value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const params = new URLSearchParams({ track_name: track.title.trim(), artist_name: track.artist.trim() });
    setSearchState('loading');
    fetch(`https://lrclib.net/api/search?${params}`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Busca indisponível'); return response.json(); })
      .then(results => {
        if (!Array.isArray(results)) throw new Error('Resposta inválida');
        const matches = results.filter(item => normalize(item.trackName) === normalize(track.title) && normalize(item.artistName) === normalize(track.artist) && (item.syncedLyrics || item.plainLyrics));
        const duration = Number(track.seconds) || 0;
        matches.sort((a, b) => {
          const deltaA = duration && a.duration ? Math.abs(a.duration - duration) : Infinity;
          const deltaB = duration && b.duration ? Math.abs(b.duration - duration) : Infinity;
          const closeA = deltaA <= 5, closeB = deltaB <= 5;
          return Number(closeB) - Number(closeA) || Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics)) || deltaA - deltaB;
        });
        const match = matches[0];
        if (match && duration && Number(match.duration) && Math.abs(Number(match.duration) - duration) > 15) { setSearchState('empty'); return; }
        setFoundLyrics(match?.syncedLyrics || match?.plainLyrics || '');
        setSearchState(match ? 'found' : 'empty');
      })
      .catch(err => { if (err.name !== 'AbortError') setSearchState('error'); });
    return () => controller.abort();
  }, [track?.id, track?.title, track?.artist, track?.seconds, savedLyrics, retry]);

  async function save(event) {
    event.preventDefault();
    setSaving(true); setError('');
    try { await onSave(draft); setEditing(false); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  if (!track) return null;
  return <>
    <div className="stage-content">
      <div className="stage-track">
        <div className="stage-cover" style={track.cover ? { backgroundImage: `url("${track.cover}")` } : undefined}>{!track.cover && <Disc3 size={52}/>}</div>
        <div className="stage-track-copy"><strong>{track.title}</strong><span>{track.artist}</span><em>{track.album}</em></div>
      </div>
      <div className="stage-display">
        <div className="stage-tabs"><button className={view === 'lyrics' ? 'active' : ''} onClick={() => setView('lyrics')}><ListMusic size={15}/> Letras</button><button className={view === 'art' ? 'active' : ''} onClick={() => setView('art')}><Music2 size={15}/> Álbum</button><button onClick={() => { setDraft(lyrics); setEditing(true); }} aria-label="Editar letra"><Pencil size={15}/></button></div>
        {view === 'lyrics' ? <div className="lyrics-display" aria-live="off">
          {lines.length ? <div className="lyrics-lines">{lines.slice(Math.max(0, active - 1), Math.max(0, active - 1) + 4).map((line, index) => { const actual = Math.max(0, active - 1) + index; return <div key={`${line.time}-${actual}`} className={actual === active ? 'active' : ''}>{line.text}</div>; })}</div>
            : plainLyrics ? <div className="lyrics-plain">{plainLyrics}</div> : <div className="lyrics-empty"><Music2 size={23}/><span>{searchState === 'loading' ? 'Procurando a letra...' : searchState === 'error' ? 'Não foi possível buscar a letra.' : 'Nenhuma letra encontrada para esta música.'}</span>{searchState === 'error' && <button type="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button>}<button onClick={() => { setDraft(lyrics); setEditing(true); }}>Adicionar letra</button></div>}
        </div> : <div className="album-display"><Disc3 size={38}/><span>{track.album || 'Sua música, do seu jeito'}</span></div>}
        {view === 'lyrics' && foundLyrics && !savedLyrics && <span className="lyrics-source">Letra sincronizada</span>}
      </div>
    </div>
    {editing && <div className="modal-scrim" onClick={() => !saving && setEditing(false)}><section className="settings-modal lyrics-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="lyrics-title"><header><span id="lyrics-title"><Music2 size={19}/> Letra de {track.title}</span><button type="button" onClick={() => setEditing(false)} aria-label="Fechar"><X size={19}/></button></header><form className="modal-body" onSubmit={save}><p>Cole a letra ou use LRC para sincronizar cada linha com a música.</p><p className="lyrics-example">Exemplo: [00:12.50] Primeira linha</p><textarea value={draft} onChange={event => setDraft(event.target.value)} maxLength={20000} placeholder={'[00:12.50] Primeira linha\n[00:18.00] Próxima linha'} aria-label="Letra da música"/><label className="lyrics-file">Importar arquivo .lrc ou .txt<input type="file" accept=".lrc,.txt,text/plain" onChange={event => { const file = event.target.files?.[0]; if (file) file.text().then(setDraft).catch(() => setError('Não foi possível ler o arquivo.')); }}/></label>{error && <p className="lookup-error" role="alert">{error}</p>}<button className="save-track" disabled={saving}>{saving ? 'Salvando...' : 'Salvar letra'}</button></form></section></div>}
  </>;
}
