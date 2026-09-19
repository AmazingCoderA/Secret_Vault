import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from './api';
import type { ContainerSummary, Login } from './types';
import type { Theme } from './types';
import { Calculator } from './components/Calculator';
import { Auth } from './components/Auth';
import { Workspace } from './components/Workspace';
import { useI18n } from './i18n';

export function App() {
  const { t } = useI18n();
  const [screen, setScreen] = useState<'calculator' | 'auth' | 'vault'>('calculator');
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [equalHoldEnabled] = useState(true);
  const [theme] = useState<Theme>('forest');
  const [login, setLogin] = useState<Login | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const session = useRef<Login | null>(null);
  const generation = useRef(0);
  const lockPending = useRef<Promise<void>>(Promise.resolve());
  const inDialog = useRef(false);
  const lastActivity = useRef(Date.now());
  const lastTouch = useRef(Date.now());

  const lock = useCallback(() => {
    generation.current++;
    session.current = null;
    setLogin(null); setScreen('calculator'); setBusy(false); setError('');
    lockPending.current = api.lock();
    void lockPending.current.catch(() => setError('Could not confirm locking. Close the application.'));
  }, []);

  useEffect(() => {
    lock();
    void api.status().then(status => {
      setContainers(status.containers);
    }).catch(() => {});
  }, [lock]);

  const open = useCallback(async () => {
    const current = ++generation.current;
    try {
      await lockPending.current;
      const status = await api.status();
      if (generation.current !== current) return;
       setContainers(status.containers); setError(''); setScreen('auth');
    } catch (error) { if (generation.current === current) setError(errorText(error)); }
  }, []);

  useEffect(() => {
    const selected = login?.snapshot.settings.theme ?? theme;
    document.documentElement.dataset.theme = selected;
    document.documentElement.style.setProperty('--green', login?.snapshot.settings.accentColor ?? '#9be8c4');
  }, [login, theme]);

  useEffect(() => {
    const activity = () => {
      const active = session.current;
      if (!active) return;
      const now = Date.now();
      // A late activity event must not revive an already expired UI session.
      if (now - lastActivity.current >= active.snapshot.settings.autoLockSecs * 1000) { lock(); return; }
      lastActivity.current = now;
      if (now - lastTouch.current > 10_000) {
        lastTouch.current = now;
        void api.touch(active.token).catch(() => { if (session.current?.token === active.token) lock(); });
      }
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && session.current) { event.preventDefault(); lock(); }
      else activity();
    };
    const hidden = () => {
      if (document.hidden && !inDialog.current && (session.current?.snapshot.settings.lockOnHide || screen === 'auth')) lock();
    };
    const timer = setInterval(() => {
      const active = session.current;
      if (active && Date.now() - lastActivity.current >= active.snapshot.settings.autoLockSecs * 1000) lock();
    }, 1000);
    window.addEventListener('pointerdown', activity);
    window.addEventListener('pointermove', activity);
    window.addEventListener('keydown', keys);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('pointermove', activity);
      window.removeEventListener('keydown', keys);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [lock, screen]);

  async function submit(id: string | null, name: string | null, password: string) {
    if (busy) return;
    const current = generation.current;
    setBusy(true); setError('');
    try {
      const result = await api.login(id, name, password);
      if (generation.current !== current) { await api.revoke(result.token); return; }
      lastActivity.current = Date.now(); lastTouch.current = Date.now();
      session.current = result; setLogin(result); setScreen('vault');
    } catch (error) {
      if (generation.current === current) {
        setError(errorText(error));
        // Creation may have committed just before a concurrent cancellation.
         void api.status().then(status => { if (generation.current === current) setContainers(status.containers); }).catch(() => {});
      }
    } finally { if (generation.current === current) setBusy(false); }
  }

  async function create(name: string, hidden: boolean, password: string, location?: string) {
    if (busy) return; const current=generation.current; setBusy(true); setError('');
    try { const result=await api.createContainer(name,hidden,password,location); if(generation.current!==current){await api.revoke(result.token);return;} lastActivity.current=Date.now(); lastTouch.current=Date.now(); session.current=result; setLogin(result); setScreen('vault'); }
    catch(error){if(generation.current===current)setError(errorText(error));}
    finally{if(generation.current===current)setBusy(false);}
  }

  async function deleteContainer(id: string, passes: 0 | 3) { await api.deleteContainer(id, passes); setContainers(items => items.filter(item => item.id !== id)); }
  async function undoDelete(id: string) { await api.undoDeleteContainer(id); const status = await api.status(); setContainers(status.containers); }
  async function recoveryQuestion(id: string | null, name: string | null) { return api.recoveryQuestion(id, name); }
  async function recover(id: string | null, name: string | null, answer: string, newPassword: string) { const result = await api.recoverContainer(id, name, answer, newPassword); session.current = result; setLogin(result); setScreen('vault'); }

  if (screen === 'auth') return <Auth containers={containers} busy={busy} error={error} onLogin={submit} onCreate={create} onDelete={deleteContainer} onUndoDelete={undoDelete} onRecoveryQuestion={recoveryQuestion} onRecover={recover} onBack={lock} />;
  if (screen === 'vault' && login) return <Workspace
    login={login} onLock={lock}
    isActive={() => session.current?.token === login.token}
    onSnapshot={snapshot => { const updated = { ...login, snapshot }; session.current = updated; setLogin(updated); }}
    onDialog={value => { inDialog.current = value; if (!value && document.hidden && session.current?.snapshot.settings.lockOnHide) lock(); }}
  />;
  return <><Calculator onOpen={open} equalHoldEnabled={equalHoldEnabled} />{error && <div className="global-error" role="alert">{t(error)}</div>}</>;
}
