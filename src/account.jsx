import LearningRhythm from './learning-rhythm.jsx';
import React, { useEffect, useState } from 'react';
import { initializeAccount, accountSnapshot, subscribe, flush, canImport, importLegacy } from './account-progress.js';
import './account.css';

export function AccountGate({ children }) {
  const [phase, setPhase] = useState('loading');
  const [error, setError] = useState('');
  const [migration, setMigration] = useState(false);
  const [providers, setProviders] = useState({ google: false, apple: false });
  async function start() {
    setPhase('loading');setError('');
    try {
      if (await initializeAccount()) {
        if (canImport()) setMigration(true);
        setPhase('ready');
      } else {
        const response = await fetch('/auth/providers', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw Error('Could not load sign-in options. Please retry.');
        setProviders(await response.json());setPhase('signed-out');
        if (new URLSearchParams(location.search).has('auth_error')) setError('Sign-in did not finish. Please try again.');
      }
    } catch (e) { setError(e.message);setPhase('error'); }
  }
  useEffect(() => { start(); }, []);
  if (phase !== 'ready') return <main className="account-gate">
    <span className="account-logo">{'</>'}</span><p className="account-eyebrow">FULLSTACK / LEARN</p>
    <h1>{phase === 'loading' ? 'Getting your learning path…' : 'Your progress, wherever you learn.'}</h1>
    <p>{phase === 'loading' ? 'Opening your account securely.' : 'Sign in with Google or Apple to save your lessons, code, XP and practice sessions. No extra password to remember.'}</p>
    {error && <p role="alert">{error}</p>}
    {phase === 'signed-out' ? <div className="account-providers">
      {['google', 'apple'].map(provider => providers[provider] ? <a key={provider} className={'account-primary ' + provider} href={'/auth/' + provider} target="_top">Continue with {provider === 'google' ? 'Google' : 'Apple'} <span>→</span></a> : <button key={provider} disabled>Continue with {provider === 'google' ? 'Google' : 'Apple'} <small>Not configured</small></button>)}
      {(!providers.google || !providers.apple) && <small>The administrator must configure each sign-in provider before it can be used.</small>}
    </div> : phase === 'error' ? <button className="account-primary" onClick={start}>Try again</button> : <span className="account-loading" />}
    <small>Your progress stays on this server. Tutor requests run on its local model.</small>
  </main>;
  if (migration) return <main className="account-gate"><span className="account-logo">✓</span><h1>Bring your earlier progress?</h1><p>This browser has progress from before account saving was added. Import it only if it belongs to you. Existing account progress will be kept.</p>{error && <p role="alert">{error}</p>}<button className="account-primary" onClick={async () => { await importLegacy();if (accountSnapshot().status === 'error') setError(accountSnapshot().failure);else setMigration(false); }}>Import my browser progress</button><button onClick={() => setMigration(false)}>Continue without importing</button><small>Browser progress stays available if you skip.</small></main>;
  return <><AccountBar /><LearningRhythm />{children}</>;
}
function AccountBar() {
  const [, render] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => subscribe(() => render(x => x + 1)), []);
  const { user, status, failure, conflict } = accountSnapshot();
  const pending = status === 'saving' || status === 'error';
  async function logout() {
    try { const reg=await navigator.serviceWorker?.getRegistration('/');const sub=await reg?.pushManager?.getSubscription();if(sub){const removed=await fetch('/api/reminders/subscribe',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint})});if(!removed.ok)throw Error();await sub.unsubscribe();}
      const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });if (!response.ok) throw Error();location.assign('/'); }
    catch { setError('Sign-out failed. Please retry.'); }
  }
  return <div className={'account-bar ' + (status === 'error' ? 'account-error' : '')}>
    <div><strong>{user?.name}</strong><span role="status" aria-live="polite">{error || (status === 'saving' ? 'Saving progress…' : status === 'error' ? failure : '✓ All progress saved to your account')}</span></div>
    <div>{status === 'error' && (conflict ? <button onClick={() => { if (window.confirm('Load the latest saved progress? Unsaved edits in this tab will be discarded.')) location.reload(); }}>Load latest progress</button> : <button onClick={flush}>Retry save</button>)}{pending ? <span>Save before signing out</span> : <button onClick={logout}>Sign out</button>}</div>
  </div>;
}
