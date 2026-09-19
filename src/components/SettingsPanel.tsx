import { useState, type FormEvent } from 'react';
import { Check, Cpu, KeyRound, Timer, ShieldAlert, CircleHelp, Palette } from 'lucide-react';
import { modes, type Settings } from '../types';

export function SettingsPanel({ settings, busy, onSave }: { settings: Settings; busy: boolean; onSave: (settings: Settings, password: string, next?: string, recoveryAnswer?: string) => Promise<string | null> }) {
  const [draft, setDraft] = useState({ ...settings });
  const [password, setPassword] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [recoveryAnswer, setRecoveryAnswer] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (next !== confirmation) { setError('Новые пароли не совпадают.'); return; }
    setError('');
    const saveError = await onSave(draft, password, next || undefined, recoveryAnswer || undefined);
    setPassword(''); setNext(''); setConfirmation(''); setRecoveryAnswer('');
    setError(saveError ?? '');
  }
  return <form className="settings-form" onSubmit={submit}>
    <section className="settings-section"><div className="section-heading"><Palette size={22} /><div><h2>Тема</h2><p>Оформление калькулятора и хранилища</p></div></div>
      <div className="theme-grid">{([['forest', 'Лес'], ['midnight', 'Полночь'], ['graphite', 'Графит'], ['ocean', 'Океан'], ['violet', 'Фиолет'], ['rose', 'Роза']] as const).map(([id, label]) => <button type="button" disabled={busy} key={id} aria-pressed={draft.theme === id} className={`theme-choice ${draft.theme === id ? 'active' : ''}`} data-preview={id} onClick={() => { setDraft({ ...draft, theme: id }); document.documentElement.dataset.theme = id; }}><span />{label}</button>)}</div>
      <label className="settings-row"><span>Свой акцентный цвет</span><input className="color-input" type="color" value={draft.accentColor} disabled={busy} onChange={e => { setDraft({ ...draft, accentColor: e.target.value }); document.documentElement.style.setProperty('--green', e.target.value); }} /></label>
      <label className="settings-row"><span>Маскировать имена файлов<small>Вместо названий показывать «Файл 1», «Файл 2»</small></span><input disabled={busy} className="switch" type="checkbox" checked={draft.maskFileNames} onChange={e => setDraft({ ...draft, maskFileNames: e.target.checked })} /></label>
      <label className="settings-row"><span>Безопасное удаление записей<small>SQLite затирает освобождённые страницы</small></span><input disabled={busy} className="switch" type="checkbox" checked={draft.secureDelete} onChange={e => setDraft({ ...draft, secureDelete: e.target.checked })} /></label>
    </section>
    <section className="settings-section"><div className="section-heading"><Cpu size={22} /><div><h2>Режим защиты</h2><p>Стоимость проверки пароля через Argon2id</p></div></div>
      <div className="mode-grid">{modes.map(mode => <button disabled={busy} type="button" className={`mode-card ${draft.mode === mode.id ? 'selected' : ''}`} key={mode.id} onClick={() => setDraft({ ...draft, mode: mode.id })} aria-pressed={draft.mode === mode.id}>
        <div><strong>{mode.name}</strong><span className="selection-dot">{draft.mode === mode.id && <Check size={12} />}</span></div><p>{mode.description}</p><small>{mode.memory} · {mode.iterations} прохода</small>
      </button>)}</div>
      <p className="setting-help">Более тяжёлый режим увеличивает время получения ключа. Файлы и имена защищены XChaCha20-Poly1305.</p>
    </section>
    <section className="settings-section"><div className="section-heading"><Timer size={22} /><div><h2>Автоблокировка</h2><p>Возврат к калькулятору после бездействия</p></div></div>
      <label className="settings-row"><span>Блокировать через</span><select disabled={busy} value={draft.autoLockSecs} onChange={e => setDraft({ ...draft, autoLockSecs: Number(e.target.value) })}><option value={60}>1 минуту</option><option value={300}>5 минут</option><option value={900}>15 минут</option></select></label>
      <label className="settings-row"><span>При скрытии приложения<small>Системный выбор файла — исключение</small></span><input disabled={busy} className="switch" type="checkbox" checked={draft.lockOnHide} onChange={e => setDraft({ ...draft, lockOnHide: e.target.checked })} /></label>
      <label className="settings-row"><span>Удержание кнопки =<small>Открывать вход долгим нажатием; Alt+V остаётся доступен</small></span><input disabled={busy} className="switch" type="checkbox" checked={draft.equalHoldEnabled} onChange={e => setDraft({ ...draft, equalHoldEnabled: e.target.checked })} /></label>
    </section>
    <section className="settings-section"><div className="section-heading"><CircleHelp size={22} /><div><h2>Восстановление пароля</h2><p>Контрольный вопрос хранится открыто, ответ — только как Argon2id-хеш</p></div></div>
      <label className="settings-row"><span>Разрешить сброс пароля</span><input disabled={busy} className="switch" type="checkbox" checked={draft.recoveryQuestion !== null} onChange={e => setDraft({ ...draft, recoveryQuestion: e.target.checked ? '' : null })} /></label>
      {draft.recoveryQuestion !== null && <div className="two-fields"><label className="field-label">Контрольный вопрос<input value={draft.recoveryQuestion} minLength={3} maxLength={200} required disabled={busy} onChange={e => setDraft({ ...draft, recoveryQuestion: e.target.value })} /></label><label className="field-label">Ответ <span className="muted">({settings.recoveryQuestion === draft.recoveryQuestion ? 'оставьте пустым без изменений' : 'обязательно'})</span><input type="password" value={recoveryAnswer} minLength={recoveryAnswer ? 3 : undefined} maxLength={1024} required={settings.recoveryQuestion !== draft.recoveryQuestion} disabled={busy} onChange={e => setRecoveryAnswer(e.target.value)} /></label></div>}
      <p className="setting-help">Используйте длинный уникальный ответ. Он оборачивает тот же случайный ключ контейнера и позволяет заменить забытый пароль.</p>
    </section>
    <section className="settings-section"><div className="section-heading"><KeyRound size={22} /><div><h2>Подтверждение изменений</h2><p>Текущий пароль нужен для применения режима</p></div></div>
      <label className="field-label" htmlFor="current-password">Текущий пароль</label><input id="current-password" type="password" autoComplete="current-password" value={password} required disabled={busy} onChange={e => setPassword(e.target.value)} />
      <div className="two-fields"><label className="field-label">Новый пароль <span className="muted">(необязательно)</span><input type="password" autoComplete="new-password" minLength={8} maxLength={1024} value={next} disabled={busy} onChange={e => setNext(e.target.value)} /></label><label className="field-label">Повтор нового пароля<input type="password" autoComplete="new-password" required={!!next} value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></label></div>
      {error && <p role="alert" className="error-message">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? 'Применяем…' : 'Сохранить настройки'}<Check size={18} /></button>
    </section>
    <div className="notice"><ShieldAlert size={22} /><p><strong>Что делает Emergency Lock</strong><span>Скрывает интерфейс, отзывает сессию и удаляет ключ из активной памяти. Уже экспортированные файлы остаются снаружи.</span></p></div>
  </form>;
}
