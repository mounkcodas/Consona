import React, { useEffect, useState } from 'react';
import { Search, ExternalLink } from 'lucide-react';

export default function MusicVerification({ title, artist, onApply }) {
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setResults([]);
    if (title.trim().length < 2 || artist.trim().length < 2) { setStatus('idle'); return; }
    const controller = new AbortController();
    setStatus('waiting');
    const timer = setTimeout(async () => {
      setStatus('loading');
      const quote = value => value.trim().replace(/([\\"])/g, '\\$1');
      const params = new URLSearchParams({ query: `recording:"${quote(title)}" AND artist:"${quote(artist)}"`, fmt: 'json', limit: '5' });
      try {
        const response = await fetch(`https://musicbrainz.org/ws/2/recording/?${params}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Busca indisponível');
        const data = await response.json();
        const matches = (data.recordings || []).map(recording => ({
          id: recording.id, title: recording.title, artist: (recording['artist-credit'] || []).map(part => `${part.name || part.artist?.name || ''}${part.joinphrase || ''}`).join(''),
          album: recording.releases?.[0]?.title || '', releaseId: recording.releases?.[0]?.id || '',
          date: recording.releases?.[0]?.date || recording['first-release-date'] || '', duration: Math.round((recording.length || 0) / 1000),
        })).filter(item => item.id && item.title);
        setResults(matches); setStatus(matches.length ? 'ready' : 'empty');
      } catch (error) { if (error.name !== 'AbortError') setStatus('error'); }
    }, 1800);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [title, artist, retry]);

  return <div className="music-verification" aria-live="polite">
    <strong><Search size={16}/> Identificação automática · MusicBrainz</strong>
    {status === 'idle' && <p>Informe o nome da música e do artista para procurar gravações.</p>}
    {(status === 'waiting' || status === 'loading') && <p>Procurando gravações...</p>}
    {status === 'empty' && <p>Nenhuma gravação encontrada. Confira o nome e o artista.</p>}
    {status === 'error' && <p>Não foi possível consultar o MusicBrainz. <button type="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></p>}
    {status === 'ready' && <><p>Confira os resultados e escolha a gravação correspondente.</p><div className="verification-results">{results.map(item => <div className="verification-result" key={item.id}><span><b>{item.title}</b><small>{item.artist}{item.album ? ` · ${item.album}` : ''}{item.date ? ` · ${item.date.slice(0, 4)}` : ''}</small></span><a href={`https://musicbrainz.org/recording/${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer" aria-label={`Ver ${item.title} no MusicBrainz`}><ExternalLink size={15}/></a><button type="button" onClick={() => onApply(item)}>Usar</button></div>)}</div></>}
  </div>;
}
