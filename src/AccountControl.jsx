import React, { useRef, useState } from 'react';
import { LogIn, LogOut, UserRound, X } from 'lucide-react';

export default function AccountControl({ user, onUserChange, page = false }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const avatarInput = useRef(null);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE || 'https://playmusic-library-api.aleixomaycon.workers.dev'}/api/auth/${user ? 'profile' : mode === 'register' ? 'register' : 'login'}`, {
        method: user ? 'PUT' : 'POST', headers: user ? authHeaders() : { 'Content-Type': 'application/json' },
        body: user ? profileBody() : JSON.stringify({ username, password, displayName: username }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível acessar a conta.');
      if (user) onUserChange(result.user);
      else { sessionStorage.setItem('consona-session', result.token); onUserChange(result.user); setPassword(''); }
      if (!user) setOpen(false);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function authHeaders() { const headers = new Headers(); const token = sessionStorage.getItem('consona-session'); if (token) headers.set('Authorization', `Bearer ${token}`); return headers; }
  function profileBody() { const form = new FormData(); form.set('displayName', displayName); const image = avatarInput.current?.files?.[0]; if (image) form.set('avatar', image); return form; }
  async function logout() {
    try { await fetch(`${import.meta.env.VITE_API_BASE || 'https://playmusic-library-api.aleixomaycon.workers.dev'}/api/auth/logout`, { method: 'POST', headers: authHeaders() }); } catch {}
    sessionStorage.removeItem('consona-session'); setOpen(false); onUserChange(null);
  }

  if (page && !user) return <section className="settings-modal account-modal account-page-card" role="region" aria-labelledby="account-title">
    <header><span id="account-title"><UserRound size={18}/>{mode === 'register' ? 'Criar conta' : 'Entrar'}</span></header>
    <form className="modal-body account-form" onSubmit={submit}><label>Nome de usuário<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={24} required/></label><label>Senha<input autoComplete={mode === 'register' ? 'new-password' : 'current-password'} type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={10} maxLength={128} required/></label>{mode === 'register' && <small>A senha deve ter pelo menos 10 caracteres.</small>}{error && <p className="lookup-error" role="alert">{error}</p>}<button className="save-track" disabled={busy}><LogIn size={16}/>{busy ? 'Aguarde...' : mode === 'register' ? 'Criar conta' : 'Entrar'}</button><button type="button" className="account-switch" onClick={() => { setMode(value => value === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'register' ? 'Já tem uma conta? Entrar' : 'Criar uma conta'}</button></form>
  </section>;

  return <>
    <button className={`account-button ${user ? 'signed-in' : ''}`} onClick={() => { setDisplayName(user?.displayName || ''); setOpen(true); setError(''); }} aria-label={user ? `Conta de ${user.displayName}` : 'Entrar ou criar conta'}>
      {user?.avatar ? <img src={user.avatar} alt=""/> : <UserRound size={18}/>}<span>{user?.displayName || 'Entrar'}</span>
    </button>
    {open && <div className="modal-scrim account-scrim" onClick={() => !busy && setOpen(false)}><section className="settings-modal account-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="account-title">
      <header><span id="account-title"><UserRound size={18}/>{user ? 'Seu perfil' : mode === 'register' ? 'Criar conta' : 'Entrar'}</span><button onClick={() => setOpen(false)} aria-label="Fechar"><X size={18}/></button></header>
      {user ? <form className="modal-body account-form" onSubmit={submit}><div className="account-avatar-preview">{user.avatar ? <img src={user.avatar} alt="Foto do perfil"/> : <UserRound size={28}/>}</div><label>Nome exibido<input maxLength={40} value={displayName} onChange={event => setDisplayName(event.target.value)} required/></label><label>Foto do perfil<input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp,image/avif"/></label>{error && <p className="lookup-error" role="alert">{error}</p>}<button className="save-track" disabled={busy}>{busy ? 'Salvando...' : 'Salvar perfil'}</button><button type="button" className="account-logout" onClick={logout}><LogOut size={15}/> Sair de @{user.username}</button></form> : <form className="modal-body account-form" onSubmit={submit}><label>Nome de usuário<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={24} required/></label><label>Senha<input autoComplete={mode === 'register' ? 'new-password' : 'current-password'} type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={10} maxLength={128} required/></label>{mode === 'register' && <small>A senha deve ter pelo menos 10 caracteres.</small>}{error && <p className="lookup-error" role="alert">{error}</p>}<button className="save-track" disabled={busy}><LogIn size={16}/>{busy ? 'Aguarde...' : mode === 'register' ? 'Criar conta' : 'Entrar'}</button><button type="button" className="account-switch" onClick={() => { setMode(value => value === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'register' ? 'Já tem uma conta? Entrar' : 'Criar uma conta nova'}</button></form>}
    </section></div>}
  </>;
}
