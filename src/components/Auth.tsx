import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Copy, Eye, EyeOff, LockKeyhole, Plus, RefreshCw, ShieldAlert } from 'lucide-react';
import { native, pickContainerLocation } from '../api';
import type { ContainerSummary } from '../types';

const randomValue = (length: number) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map(value => alphabet[value & 63]).join('');
};

export function Auth({ containers, busy, error, onLogin, onCreate, onDelete, onUndoDelete, onRecoveryQuestion, onRecover, onBack }: {
  containers: ContainerSummary[];
  busy: boolean;
  error: string;
  onLogin: (id: string | null, name: string | null, password: string) => void;
  onCreate: (name: string, hidden: boolean, password: string, location?: string) => void;
  onDelete: (id: string, passes: 0 | 3) => Promise<void>;
  onUndoDelete: (id: string) => Promise<void>;
  onRecoveryQuestion: (id: string | null, name: string | null) => Promise<string | null>;
  onRecover: (id: string | null, name: string | null, answer: string, password: string) => Promise<void>;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<ContainerSummary | null>(containers[0] ?? null);
  const [creating, setCreating] = useState(containers.length === 0);
  const [hiddenEntry, setHiddenEntry] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [hidden, setHidden] = useState(false);
  const [visible, setVisible] = useState(false);
  const [localError, setLocalError] = useState('');
  const [location, setLocation] = useState('');
  const [undo, setUndo] = useState<{ id: string; left: number } | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');

  function generate() {
    const generatedPassword = randomValue(24);
    setName(`vault-${randomValue(16)}`);
    setPassword(generatedPassword);
    setConfirmation(generatedPassword);
    setVisible(true);
  }

  async function copy(value: string) {
    if (value) await navigator.clipboard.writeText(value);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    if (creating) {
      if (password !== confirmation) return setLocalError('Пароли не совпадают.');
      onCreate(name, hidden, password, location || undefined);
    } else {
      onLogin(hiddenEntry ? null : selected?.id ?? null, hiddenEntry ? name : null, password);
    }
  }

  async function startRecovery() { const id = hiddenEntry ? null : selected?.id ?? null; const containerName = hiddenEntry ? name : null; const found = await onRecoveryQuestion(id, containerName); if (!found) return setLocalError('Для этого контейнера контрольный вопрос не настроен.'); setQuestion(found); setRecovering(true); setLocalError(''); }
  async function submitRecovery(event: FormEvent) { event.preventDefault(); if (password !== confirmation) return setLocalError('Пароли не совпадают.'); try { await onRecover(hiddenEntry ? null : selected?.id ?? null, hiddenEntry ? name : null, answer, password); } catch (error) { setLocalError(String(error)); } }

  async function remove(item: ContainerSummary) { const secure = window.confirm('Использовать трёхпроходное затирание после 30 секунд?'); await onDelete(item.id, secure ? 3 : 0); setUndo({ id: item.id, left: 30 }); const timer = window.setInterval(() => setUndo(current => { if (!current || current.left <= 1) { window.clearInterval(timer); return null; } return { ...current, left: current.left - 1 }; }), 1000); }
  return <main className="auth-page">
    <button className="text-button auth-back" onClick={onBack}><ArrowLeft size={18}/>К калькулятору</button>
    <section className="auth-card container-auth">
      <div className="auth-emblem"><LockKeyhole size={30}/></div>
      <span className="eyebrow">НЕЗАВИСИМЫЕ КОНТЕЙНЕРЫ</span>
      <h1>{recovering ? 'Сброс пароля.' : creating ? 'Новый контейнер.' : hiddenEntry ? 'Скрытый контейнер.' : 'Выберите пространство.'}</h1>
      <p className="muted">{creating ? 'Имя, пароль и ключ относятся только к этому контейнеру.' : hiddenEntry ? 'Введите точное имя и пароль.' : 'Видимые контейнеры доступны до входа.'}</p>
      {!creating && !hiddenEntry && <div className="container-list">
        {containers.map(item => <div key={item.id} className={`container-item ${selected?.id === item.id ? 'selected' : ''}`}><button type="button" className="container-select" onClick={() => setSelected(item)}><LockKeyhole size={18}/><span><strong>{item.name}</strong><small>Пароль</small></span></button><button type="button" className="icon-button danger" aria-label={`Удалить ${item.name}`} onClick={() => void remove(item)}>×</button></div>)}
      </div>}
      {recovering ? <form onSubmit={submitRecovery}><label className="field-label">{question}<input autoFocus value={answer} required onChange={event => setAnswer(event.target.value)}/></label><label className="field-label">Новый пароль<input type="password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)}/></label><label className="field-label">Повторите пароль<input type="password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label><button className="primary-button full-width">Сбросить пароль<ArrowRight size={18}/></button></form> : <form onSubmit={submit}>
        {(creating || hiddenEntry) && <label className="field-label" htmlFor="container-name">Имя контейнера<input id="container-name" autoFocus value={name} maxLength={100} required onChange={event => setName(event.target.value)}/></label>}
         {creating && <label className="settings-row"><span>Скрыть из списка<small>Для входа потребуется точное имя</small></span><input className="switch" type="checkbox" checked={hidden} onChange={event => setHidden(event.target.checked)}/></label>}
         {creating && <button type="button" className="text-button" onClick={async () => setLocation(await pickContainerLocation() || '')}>Папка хранения: {location || 'по умолчанию'}</button>}
        <label className="field-label" htmlFor="password">{creating ? 'Придумайте пароль' : 'Пароль'}</label>
        <div className="password-field">
          <input id="password" type={visible ? 'text' : 'password'} value={password} minLength={creating ? 8 : 1} maxLength={1024} required onChange={event => setPassword(event.target.value)}/>
          <button type="button" className="icon-button" aria-label="Показать пароль" onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
          {creating && <button type="button" className="icon-button" aria-label="Копировать пароль" onClick={() => copy(password)}><Copy size={17}/></button>}
        </div>
        {creating && <label className="field-label">Повторите пароль<input type={visible ? 'text' : 'password'} value={confirmation} required minLength={8} onChange={event => setConfirmation(event.target.value)}/></label>}
        {creating && <button type="button" className="text-button generate-button" onClick={generate}><RefreshCw size={16}/>Сгенерировать имя и пароль</button>}
        {(error || localError) && <p className="error-message" role="alert">{error || localError}</p>}
        <button className="primary-button full-width" disabled={busy || (!creating && !hiddenEntry && !selected)}>{busy ? 'Проверяем…' : creating ? 'Создать контейнер' : 'Открыть контейнер'}<ArrowRight size={18}/></button>
      </form>}
      <div className="auth-actions">
        {!creating && !recovering && <><button className="text-button" onClick={() => setHiddenEntry(!hiddenEntry)}>{hiddenEntry ? 'К видимым' : 'Открыть скрытый'}</button><button className="text-button" onClick={() => void startRecovery()}>Забыли пароль?</button></>}
        <button className="text-button" onClick={() => { setCreating(!creating); setHiddenEntry(false); }}><Plus size={16}/>{creating && containers.length ? 'Отмена' : 'Новый контейнер'}</button>
      </div>
      {undo && <div className="toast"><span>Контейнер удалён. Осталось {undo.left} сек.</span><button className="secondary-button" onClick={async () => { await onUndoDelete(undo.id); setUndo(null); }}>Отменить</button></div>}
      <div className="notice"><ShieldAlert size={21}/><p><strong>{native ? 'Локальные зашифрованные файлы' : 'Браузерное демо'}</strong><span>{native ? 'Каждый контейнер имеет отдельную базу и ключ. Видимые имена не шифруются.' : 'Данные хранятся только в памяти вкладки.'}</span></p></div>
    </section>
  </main>;
}
