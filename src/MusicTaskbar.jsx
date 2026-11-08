import React from 'react';
import { Expand, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, Music2 } from 'lucide-react';
import './music-taskbar.css';

export default function MusicTaskbar({ brandIcon, track, playing, elapsed, duration, volume, onPlay, onPrevious, onNext, onSeek, onVolume, onOpen, hasTracks, formatTime }) {
  const progress = track && duration > 0 ? Math.min(100, elapsed / duration * 100) : 0;
  return <footer className="music-taskbar" aria-label="Controles de música">
    <button className="music-start" onClick={onOpen} aria-label="Abrir player Consona" title="Abrir player"><img src={brandIcon} alt=""/><span>Consona</span></button>
    <div className="music-dock">
      <div className="music-transport">
        <button disabled={!hasTracks} onClick={onPrevious} aria-label="Faixa anterior"><SkipBack size={17} fill="currentColor"/></button>
        <button className="music-play" disabled={!track} onClick={onPlay} aria-label={playing ? 'Pausar' : 'Reproduzir'}>{playing ? <Pause size={21} fill="currentColor"/> : <Play size={21} fill="currentColor"/>}</button>
        <button disabled={!hasTracks} onClick={onNext} aria-label="Próxima faixa"><SkipForward size={17} fill="currentColor"/></button>
      </div>
      <button className="music-now" onClick={onOpen} title={track ? `${track.title} — ${track.artist}` : 'Abrir player'}>
        <span className={`music-meter ${playing ? 'is-playing' : ''}`} aria-hidden="true">{[0,1,2,3,4].map(i => <i key={i}/>)}</span>
        <span className="music-track-copy"><strong>{track?.title || 'Sua música começa aqui'}</strong><small>{track?.artist || 'Escolha uma faixa na biblioteca'}</small></span>
      </button>
      <div className="music-progress">
        <input type="range" aria-label="Posição da música" min="0" max={duration || 1} step="0.1" value={track ? Math.min(elapsed, duration || 1) : 0} disabled={!track} style={{ '--music-fill': `${progress}%` }} onChange={event => onSeek(Number(event.target.value))}/>
        <span className="music-duration">{formatTime(track ? elapsed : 0)} <span>/ {formatTime(track ? duration : 0)}</span></span>
      </div>
      <div className="music-volume"><button aria-label={volume ? 'Silenciar' : 'Ativar som'} onClick={() => onVolume(volume ? 0 : 64)}>{volume ? <Volume2 size={21}/> : <VolumeX size={21}/>}</button><input type="range" aria-label="Volume" min="0" max="100" value={volume} style={{ '--music-fill': `${volume}%` }} onChange={event => onVolume(Number(event.target.value))}/></div>
    </div>
    <button className="music-open" onClick={onOpen} aria-label="Abrir player completo" title="Abrir player completo"><Expand size={19}/></button>
  </footer>;
}
