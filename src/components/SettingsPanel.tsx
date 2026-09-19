import { useState, type FormEvent } from 'react';
import { Check, Cpu, KeyRound, Timer, ShieldAlert, CircleHelp, Palette } from 'lucide-react';
import { modes, type Settings } from '../types';
import { useI18n } from '../i18n';

export function SettingsPanel({ settings, busy, onSave }: { settings: Settings; busy: boolean; onSave: (settings: Settings, password: string, next?: string, recoveryAnswer?: string) => Promise<string | null> }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState({ ...settings });
  const [password, setPassword] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [recoveryAnswer, setRecoveryAnswer] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (next !== confirmation) { setError(t('New passwords do not match.')); return; }
    setError('');
    const saveError = await onSave(draft, password, next || undefined, recoveryAnswer || undefined);
    setPassword(''); setNext(''); setConfirmation(''); setRecoveryAnswer('');
    setError(saveError ?? '');
  }
  return <form className="settings-form" onSubmit={submit}>
    <section className="settings-section"><div className="section-heading"><Palette size={22} /><div><h2>{t('Theme')}</h2><p>{t('Calculator and vault appearance')}</p></div></div>
      <div className="theme-grid">{([['forest', 'Forest'], ['midnight', 'Midnight'], ['graphite', 'Graphite'], ['ocean', 'Ocean'], ['violet', 'Violet'], ['rose', 'Rose'], ['aurora', 'Aurora'], ['ember', 'Ember']] as const).map(([id, label]) => <button type="button" disabled={busy} key={id} aria-pressed={draft.theme === id} className={`theme-choice ${draft.theme === id ? 'active' : ''}`} data-preview={id} onClick={() => { setDraft({ ...draft, theme: id }); document.documentElement.dataset.theme = id; }}><span />{t(label)}</button>)}</div>
      <label className="settings-row"><span>{t('Custom accent color')}</span><input className="color-input" type="color" value={draft.accentColor} disabled={busy} onChange={e => { setDraft({ ...draft, accentColor: e.target.value }); document.documentElement.style.setProperty('--green', e.target.value); }} /></label>
      <label className="settings-row"><span>{t('Mask file names')}<small>{t('Show “File 1”, “File 2” instead of names')}</small></span><input disabled={busy} className="switch" type="checkbox" checked={draft.maskFileNames} onChange={e => setDraft({ ...draft, maskFileNames: e.target.checked })} /></label>
      <label className="settings-row"><span>{t('Secure record deletion')}<small>{t('SQLite wipes freed pages')}</small></span><input disabled={busy} className="switch" type="checkbox" checked={draft.secureDelete} onChange={e => setDraft({ ...draft, secureDelete: e.target.checked })} /></label>
    </section>
    <section className="settings-section"><div className="section-heading"><Cpu size={22} /><div><h2>{t('Protection mode')}</h2><p>{t('Argon2id password-checking cost')}</p></div></div>
      <div className="mode-grid">{modes.map(mode => <button disabled={busy} type="button" className={`mode-card ${draft.mode === mode.id ? 'selected' : ''}`} key={mode.id} onClick={() => setDraft({ ...draft, mode: mode.id })} aria-pressed={draft.mode === mode.id}>
        <div><strong>{t(mode.name)}</strong><span className="selection-dot">{draft.mode === mode.id && <Check size={12} />}</span></div><p>{t(mode.description)}</p><small>{mode.memory} {t('MiB')} · {t('{{count}} passes', { count: mode.iterations })}</small>
      </button>)}</div>
      <p className="setting-help">{t('A heavier mode increases key derivation time. Files and names are protected by XChaCha20-Poly1305.')}</p>
    </section>
    <section className="settings-section"><div className="section-heading"><Timer size={22} /><div><h2>{t('Auto-lock')}</h2><p>{t('Return to calculator after inactivity')}</p></div></div>
      <label className="settings-row"><span>{t('Lock after')}</span><select disabled={busy} value={draft.autoLockSecs} onChange={e => setDraft({ ...draft, autoLockSecs: Number(e.target.value) })}><option value={60}>{t('1 minute')}</option><option value={300}>{t('5 minutes')}</option><option value={900}>{t('15 minutes')}</option></select></label>
      <label className="settings-row"><span>{t('When the application is hidden')}<small>{t('System file selection is excluded')}</small></span><input disabled={busy} className="switch" type="checkbox" checked={draft.lockOnHide} onChange={e => setDraft({ ...draft, lockOnHide: e.target.checked })} /></label>
      <label className="settings-row"><span>{t('Hold the = button')}<small>{t('Open sign-in with a long press; Alt+V remains available')}</small></span><input disabled={busy} className="switch" type="checkbox" checked={draft.equalHoldEnabled} onChange={e => setDraft({ ...draft, equalHoldEnabled: e.target.checked })} /></label>
    </section>
    <section className="settings-section"><div className="section-heading"><CircleHelp size={22} /><div><h2>{t('Password recovery')}</h2><p>{t('The question is stored as text; the answer only as an Argon2id hash')}</p></div></div>
      <label className="settings-row"><span>{t('Allow password reset')}</span><input disabled={busy} className="switch" type="checkbox" checked={draft.recoveryQuestion !== null} onChange={e => setDraft({ ...draft, recoveryQuestion: e.target.checked ? '' : null })} /></label>
      {draft.recoveryQuestion !== null && <div className="two-fields"><label className="field-label">{t('Recovery question')}<input value={draft.recoveryQuestion} minLength={3} maxLength={200} required disabled={busy} onChange={e => setDraft({ ...draft, recoveryQuestion: e.target.value })} /></label><label className="field-label">{t('Answer')} <span className="muted">({t(settings.recoveryQuestion === draft.recoveryQuestion ? 'leave blank to keep unchanged' : 'required')})</span><input type="password" value={recoveryAnswer} minLength={recoveryAnswer ? 3 : undefined} maxLength={1024} required={settings.recoveryQuestion !== draft.recoveryQuestion} disabled={busy} onChange={e => setRecoveryAnswer(e.target.value)} /></label></div>}
      <p className="setting-help">{t('Use a long unique answer. It wraps the same random container key and allows a forgotten password to be replaced.')}</p>
    </section>
    <section className="settings-section"><div className="section-heading"><KeyRound size={22} /><div><h2>{t('Confirm changes')}</h2><p>{t('Your current password is required to apply changes')}</p></div></div>
      <label className="field-label" htmlFor="current-password">{t('Current password')}</label><input id="current-password" type="password" autoComplete="current-password" value={password} required disabled={busy} onChange={e => setPassword(e.target.value)} />
      <div className="two-fields"><label className="field-label">{t('New password')} <span className="muted">({t('optional')})</span><input type="password" autoComplete="new-password" minLength={8} maxLength={1024} value={next} disabled={busy} onChange={e => setNext(e.target.value)} /></label><label className="field-label">{t('Repeat new password')}<input type="password" autoComplete="new-password" required={!!next} value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></label></div>
      {error && <p role="alert" className="error-message">{error}</p>}
      <button className="primary-button" disabled={busy}>{t(busy ? 'Applying…' : 'Save settings')}<Check size={18} /></button>
    </section>
    <div className="notice"><ShieldAlert size={22} /><p><strong>{t('What Emergency Lock does')}</strong><span>{t('Hides the interface, revokes the session, and removes the key from active memory. Already exported files remain outside.')}</span></p></div>
  </form>;
}
