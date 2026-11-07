import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, LogOut, Upload, UserRound, X } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || 'https://playmusic-library-api.aleixomaycon.workers.dev';

export default function AccountControl({ user, onUserChange, page = false }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [avatarFile, setAvatarFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const avatarInput = useRef(null);

  useEffect(() => {
    if (!avatarFile) { setPreview(''); return; }
    const url = URL.createObjectURL(avatarFile); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    const desktop = document.querySelector('.desktop');
    const previousInert = desktop?.inert;
    document.body.style.overflow = 'hidden';
    if (desktop) desktop.inert = true;
    return () => { document.body.style.overflow = previous; if (desktop) desktop.inert = previousInert; };
  }, [open]);
  function authHeaders() {
    const headers = new Headers(); const token = sessionStorage.getItem('consona-session');
    if (token) headers.set('Authorization', `Bearer ${token}`); return headers;
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try {
      const form = new FormData();
      if (user) { form.set('displayName', displayName); if (avatarFile) form.set('avatar', avatarFile); }
      const path = user ? '/api/profile' : `/api/auth/${mode}`;
      const response = await fetch(`${API_BASE}${path}`, {
        method: user ? 'PUT' : 'POST', headers: user ? authHeaders() : { 'Content-Type': 'application/json' },
        body: user ? form : JSON.stringify({ username, password, displayName: username }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Não foi possível acessar a conta. Tente novamente.');
      if (!user) { sessionStorage.setItem('consona-session', result.token); setPassword(''); }
      await onUserChange(result.user);
      if (user) { setAvatarFile(null); if (avatarInput.current) avatarInput.current.value = ''; setSaved(true); }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try { await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', headers: authHeaders() }); } catch {}
    sessionStorage.removeItem('consona-session'); setOpen(false); await onUserChange(null); setBusy(false);
  }

  const credentials = <form className="account-form" onSubmit={submit}>
    <label>Nome de usuário<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={24} placeholder="Seu nome de usuário" required/></label>
    <label>Senha<input autoComplete={mode === 'register' ? 'new-password' : 'current-password'} type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={10} maxLength={128} placeholder={mode === 'register' ? 'Crie uma senha segura' : 'Digite sua senha'} required/></label>
    {mode === 'register' && <small>Use pelo menos 10 caracteres.</small>}
    {error && <p className="lookup-error" role="alert">{error}</p>}
    <button className="save-track" disabled={busy}>{busy ? 'Aguarde...' : mode === 'register' ? 'Criar minha conta' : 'Entrar na Consona'}<ArrowRight size={17}/></button>
    <p className="account-switch-copy">{mode === 'register' ? 'Já tem uma conta?' : 'Ainda não tem conta?'} <button type="button" disabled={busy} onClick={() => { setMode(value => value === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'register' ? 'Entrar' : 'Cadastre-se'}</button></p>
  </form>;
  if (page && !user) return <section className="account-page-card" aria-labelledby="account-title">
    <header><span className="account-eyebrow">{mode === 'register' ? 'COMECE SUA COLEÇÃO' : 'BOM TER VOCÊ AQUI'}</span><h1 id="account-title">{mode === 'register' ? 'Seu próximo play começa aqui.' : 'Entre no seu ritmo.'}</h1><p>Suas músicas, favoritos e descobertas em um só lugar.</p></header>{credentials}
  </section>;
  return <>
    <button className="account-button signed-in" onClick={() => { setDisplayName(user?.displayName || ''); setAvatarFile(null); setOpen(true); setError(''); setSaved(false); }} aria-label={`Conta de ${user?.displayName || 'usuário'}`}>
      {user?.avatar ? <img src={user.avatar} alt=""/> : <UserRound size={18}/>}<span>{user?.displayName || 'Perfil'}</span>
    </button>
    {open && createPortal(<div className="modal-scrim account-scrim" onKeyDown={event => { if (event.key === 'Escape' && !busy) setOpen(false); }}>
      <section className="settings-modal account-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <header><span id="profile-title"><UserRound size={18}/>Seu perfil</span><button disabled={busy} onClick={() => setOpen(false)} aria-label="Fechar perfil"><X size={20}/></button></header>
        <form className="account-form" onSubmit={submit}>
          <div className="profile-photo-section"><div className="account-avatar-preview">{preview || user?.avatar ? <img src={preview || user.avatar} alt="Foto do perfil"/> : <UserRound size={38}/>}</div><label className="profile-upload"><Upload size={15}/>{avatarFile ? 'Trocar foto selecionada' : 'Escolher foto'}<input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={event => { setAvatarFile(event.target.files?.[0] || null); setSaved(false); }}/></label><small>{avatarFile?.name || 'JPG, PNG ou WebP · até 5 MB'}</small></div>
          <label>Nome exibido<input autoFocus maxLength={40} value={displayName} onChange={event => { setDisplayName(event.target.value); setSaved(false); }} required/></label>
          {error && <p className="lookup-error" role="alert">{error}</p>}{saved && <p className="profile-saved" role="status"><Check size={16}/>Perfil atualizado.</p>}
          <button className="save-track" disabled={busy}>{busy ? 'Salvando...' : 'Salvar perfil'}</button>
          <button type="button" className="account-logout" disabled={busy} onClick={logout}><LogOut size={15}/> Sair de @{user?.username}</button>
        </form>
      </section>
    </div>, document.body)}
  </>;
}
