import React, { useEffect, useState } from 'react';
import AccountControl from './AccountControl.jsx';

const API_BASE = import.meta.env.VITE_API_BASE || 'https://playmusic-library-api.aleixomaycon.workers.dev';
export default function AuthLanding({ onUserChange, brandIcon }) {
  const [albums, setAlbums] = useState([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/discover/album-covers`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Capas indisponíveis'); return response.json(); })
      .then(result => setAlbums(Array.isArray(result.albums) ? result.albums : []))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return <main className="auth-gate auth-landing">
    <div className="album-film-wall" aria-hidden="true">{[0, 1, 2].map(row => {
      const ordered = [...albums.slice(row * 3), ...albums.slice(0, row * 3)];
      return <div className={`album-film film-row-${row}`} key={row}><div className="album-film-track">{[0, 1].map(copy => <div className="album-film-set" key={copy}>{ordered.map(album => <figure className="film-album" key={album.id}><img src={album.cover} alt="" width="220" height="220" decoding="async" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/><figcaption><strong>{album.title}</strong><span>{album.artist}</span></figcaption></figure>)}</div>)}</div></div>;
    })}</div>
    <div className="auth-landing-shade"/>
    <div className="auth-layout"><div className="auth-intro"><div className="auth-page-brand"><img src={brandIcon} alt=""/><strong>Consona<span>.</span></strong></div><span className="auth-kicker">SUA BIBLIOTECA. SEU RITMO.</span><h2>Uma vida inteira<br/>de próximos plays.</h2><p>As músicas que ficam com você.<br/>A coleção que tem a sua cara.</p><span className="auth-brand-rule"/></div><AccountControl user={null} onUserChange={onUserChange} page/></div>
    <span className="auth-footnote">Consona · Feito para ouvir, descobrir e guardar.</span>
  </main>;
}
