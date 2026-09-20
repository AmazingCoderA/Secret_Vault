import { useRef, useState, type FormEvent } from 'react';
import { Archive, ArrowDownToLine, ArrowUpRight, Check, Eye, ExternalLink, File, FileText, FolderClosed, Grid2X2, HardDrive, Image, LayoutList, LockKeyhole, Plus, Search, Settings2, ShieldAlert, ShieldCheck, Trash2, Upload, X, Pencil, Zap } from 'lucide-react';
import { api, browserFiles, errorText, exportFile, maxFileSize, native, pickNativeFiles, type PickedFile } from '../api';
import { category, formatSize, modes, type Category, type Login, type Settings, type Snapshot, type VaultFile } from '../types';
import { Modal } from './Modal';
import { SettingsPanel } from './SettingsPanel';
import { LanguageSwitch, useI18n } from '../i18n';

const categories: { id: Category; label: string; icon: typeof File }[] = [
  { id: 'all', label: 'All files', icon: FolderClosed }, { id: 'image', label: 'Images', icon: Image },
  { id: 'document', label: 'Documents', icon: FileText }, { id: 'archive', label: 'Archives', icon: Archive },
  { id: 'other', label: 'Other', icon: File },
];
function FileIcon({ name, size = 24 }: { name: string; size?: number }) {
  const Icon = categories.find(c => c.id === category(name))?.icon ?? File;
  return <Icon size={size} strokeWidth={1.6} />;
}
function brandGlyph(icon: string) {
  return ({ shield: 'SV', lock: 'LK', calc: '01', folder: 'FD', star: '**', diamond: '<>', ghost: 'GH', bolt: '!!' } as Record<string, string>)[icon] ?? icon.slice(0, 4).toUpperCase();
}

export function Workspace({ login, onLock, onSnapshot, isActive, onDialog }: {
  login: Login; onLock: () => void; onSnapshot: (snapshot: Snapshot) => void; isActive: () => boolean; onDialog: (open: boolean) => void;
}) {
  const { language, t } = useI18n();
  const [page, setPage] = useState<'files' | 'settings'>('files');
  const [filter, setFilter] = useState<Category>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState('newest');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [modal, setModal] = useState<{ kind: 'rename' | 'delete'; file: VaultFile } | null>(null);
  const [preview, setPreview] = useState<{ file: VaultFile; kind: 'image' | 'text' | 'pdf' | 'audio' | 'video' | 'unknown'; url?: string; text?: string } | null>(null);
  const [name, setName] = useState('');
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const token = login.token;
  const { files, settings } = login.snapshot;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const displayName = (file: VaultFile) => settings.maskFileNames ? t('File {{number}}', { number: files.findIndex(item => item.id === file.id) + 1 }) : file.name;
  const filtered = files.filter(file => (filter === 'all' || category(file.name) === filter) && file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, language) : sort === 'size' ? b.size - a.size : b.addedAt - a.addedAt);

  function report(error: unknown) {
    if (!isActive()) return;
    const text = errorText(error);
    if (text.includes('locked') || text.includes('заблокировано')) { onLock(); return; }
    setNotice({ text: t(text), error: true });
  }
  async function refresh() { const next = await api.snapshot(token); if (isActive()) onSnapshot(next); }
  async function importFiles(picked: PickedFile[]) {
    if (!isActive() || !picked.length) return;
    setBusy(true); setNotice(null);
    let count = 0;
    const errors: string[] = [];
    try {
      const occupied = new Set(files.map(file => file.name.toLocaleLowerCase()));
      for (const file of picked) {
        if (!isActive()) break;
        setProgress(t('Adding {{current}} of {{total}}…', { current: count + 1, total: picked.length }));
        try {
          if (file.size && file.size > maxFileSize) throw new Error(t('exceeds the 32 MiB limit'));
          let importName = file.name;
          if (occupied.has(importName.toLocaleLowerCase())) {
            const dot = importName.lastIndexOf('.'); const base = dot > 0 ? importName.slice(0, dot) : importName; const ext = dot > 0 ? importName.slice(dot) : '';
            let index = 2; while (occupied.has(`${base} (${index})${ext}`.toLocaleLowerCase())) index++; importName = `${base} (${index})${ext}`;
          }
          const bytes = await file.read();
          try { if (!isActive()) break; if (bytes.byteLength > maxFileSize) throw new Error(t('exceeds the 32 MiB limit')); await api.import(token, importName, bytes); occupied.add(importName.toLocaleLowerCase()); count++; }
          finally { bytes.fill(0); }
        } catch (error) { errors.push(`${file.name}: ${t(errorText(error))}`); }
      }
      if (isActive()) {
        await refresh();
        setNotice({ text: t('Files added: {{count}}.', { count }) + (errors.length ? t(' Failed: {{errors}}', { errors: errors.join('; ') }) : ''), error: errors.length > 0 });
      }
    } catch (error) { report(error); }
    finally { if (isActive()) { setBusy(false); setProgress(''); } }
  }
  async function pick() {
    if (!native) { picker.current?.click(); return; }
    setBusy(true); onDialog(true);
    try {
      const picked = await pickNativeFiles();
      onDialog(false);
      await importFiles(picked);
    } catch (error) { report(error); }
    finally { onDialog(false); if (isActive()) setBusy(false); }
  }
  async function download(file: VaultFile) {
    setBusy(true); onDialog(true);
    try {
      const done = await exportFile(token, file, isActive);
      if (done && isActive()) setNotice({ text: t('File exported.'), error: false });
    } catch (error) { report(error); }
    finally { onDialog(false); if (isActive()) setBusy(false); }
  }
  async function showPreview(file: VaultFile) {
    setBusy(true); setNotice(null);
    try {
      const bytes = await api.read(token, file.id);
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      const image = ['png','jpg','jpeg','gif','webp','bmp','avif','svg'];
      const text = ['txt','md','json','csv','log','xml','html','css','js','ts','rs','toml','yaml','yml'];
      const audio = ['mp3','wav','ogg','m4a','flac','aac'];
      const video = ['mp4','webm','ogv','mov','mkv'];
      const kind = image.includes(extension) ? 'image' : text.includes(extension) ? 'text' : extension === 'pdf' ? 'pdf' : audio.includes(extension) ? 'audio' : video.includes(extension) ? 'video' : 'unknown';
      if (kind === 'text') { setPreview({ file, kind, text: new TextDecoder().decode(bytes) }); bytes.fill(0); }
      else if (kind === 'unknown') { bytes.fill(0); setPreview({ file, kind }); }
      else { const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)])); bytes.fill(0); setPreview({ file, kind, url }); }
    } catch (error) { report(error); }
    finally { if (isActive()) setBusy(false); }
  }
  function closePreview() { if (preview?.url) URL.revokeObjectURL(preview.url); setPreview(null); }
  async function openExternal(file: VaultFile) { try { await api.openExternal(token, file.id); setNotice({ text: t('Opened externally. The temporary copy will be deleted automatically.'), error: false }); } catch (error) { report(error); } }
  async function changeFile(event: FormEvent) {
    event.preventDefault();
    if (!modal) return;
    setBusy(true);
    try {
      if (modal.kind === 'rename') await api.rename(token, modal.file.id, name);
      else await api.delete(token, modal.file.id);
      if (!isActive()) return;
      setModal(null); await refresh();
      setNotice({ text: t(modal.kind === 'rename' ? 'File name changed.' : 'File removed from vault.'), error: false });
    } catch (error) { report(error); }
    finally { if (isActive()) setBusy(false); }
  }
  async function saveSettings(next: Settings, newPassword?: string, recoveryAnswer?: string) {
    setBusy(true); setNotice(null);
    try {
      await api.settings(token, next, newPassword, recoveryAnswer);
      if (!isActive()) return t('Session ended.');
      await refresh(); setNotice({ text: t('Settings saved.'), error: false }); return null;
    } catch (error) { const text = errorText(error); report(error); return t(text); }
    finally { if (isActive()) setBusy(false); }
  }

  return <div className="vault-layout">
    <aside className="sidebar">
      <div className="vault-brand"><div className="brand-mark"><span className="brand-icon-text">{brandGlyph(settings.brandIcon)}</span></div><strong title={settings.brandName}>{settings.brandName}<span>.</span></strong><span className="version">0.1</span></div>
      <div className="sidebar-label">{t('PERSONAL SPACE')}</div>
      <nav aria-label={t('Main navigation')}>
        <button className={`nav-item ${page === 'files' ? 'selected' : ''}`} onClick={() => setPage('files')}><FolderClosed size={20} />{t('My files')}<span className="nav-count">{files.length}</span></button>
        <button className={`nav-item ${page === 'settings' ? 'selected' : ''}`} onClick={() => setPage('settings')}><Settings2 size={20} />{t('Settings')}</button>
      </nav>
      <div className="sidebar-note"><div className="offline-dot" />{t('Only on this device')}<p>{t('Your space.\nNo accounts or cloud.').split('\n').map((line, index) => <span key={line}>{index > 0 && <br />}{line}</span>)}</p></div>
      <div className="sidebar-bottom"><div className="status-label"><ShieldCheck size={17} />{t(native ? 'XChaCha20 · local' : 'Browser session · memory only')}</div><button className="emergency-button" onClick={onLock}><Zap size={18} />Emergency Lock<span>Esc</span></button></div>
    </aside>
    <main className="vault-main">
      <header className="vault-topbar"><div className="breadcrumb">{t('Personal')} <span>/</span><strong>{t(page === 'files' ? 'My files' : 'Settings')}</strong></div><LanguageSwitch /><button className="text-button lock-top" onClick={onLock}><LockKeyhole size={17} /><span>{t('Lock')}</span></button></header>
      <div className="vault-content">
        <div className="page-heading"><div><span className="eyebrow">{t(page === 'files' ? 'EVERYTHING IN ONE PLACE' : 'UNDER YOUR CONTROL')}</span><h1>{t(page === 'files' ? 'My files' : 'Settings')}</h1><p>{t(page === 'files' ? 'What matters is always close at hand.' : 'Your device. Your rules.')}</p></div>{page === 'files' && <button className="primary-button import-button" disabled={busy} onClick={pick}><Plus size={20} /><span>{t('Add files')}</span></button>}</div>
        <div className="security-banner"><ShieldCheck size={18} /><span><strong>{t(native ? 'Encrypted container is active.' : 'Browser session is active.')}</strong> {t(native ? 'Names and contents are protected with integrity checks.' : 'Data remains in memory until this tab is closed or reloaded.')}</span></div>
        {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <ShieldAlert size={18} /> : <Check size={18} />}<span>{notice.text}</span><button className="icon-button" aria-label={t('Dismiss message')} onClick={() => setNotice(null)}><X size={17} /></button></div>}
        {page === 'settings' ? <SettingsPanel settings={settings} busy={busy} onSave={saveSettings} /> : <>
          <section className="stats-grid" aria-label={t('Vault statistics')}>
            <div className="stat-card"><span className="stat-icon mint"><FolderClosed size={21} /></span><div><span>{t('Total files')}</span><strong>{files.length}<small>{t('in vault')}</small></strong></div></div>
            <div className="stat-card"><span className="stat-icon blue"><HardDrive size={21} /></span><div><span>{t('File storage')}</span><strong>{formatSize(total, language)}</strong></div></div>
            <button className="stat-card protection-stat" onClick={() => setPage('settings')}><span className="stat-icon lavender"><ShieldCheck size={21} /></span><div><span>{t('Password check')}</span><strong>{t(modes.find(m => m.id === settings.mode)?.name ?? '')}<small>{native ? 'Argon2id' : t('Browser')}</small></strong></div><ArrowUpRight size={17} /></button>
          </section>
          <div className="files-toolbar"><div className="search-field"><Search size={18} /><input aria-label={t('Search files')} placeholder={t('Find something…')} value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="icon-button" aria-label={t('Clear search')} onClick={() => setQuery('')}><X size={15} /></button>}</div><select className="sort-select" aria-label={t('Sort')} value={sort} onChange={e => setSort(e.target.value)}><option value="newest">{t('Newest first')}</option><option value="name">{t('By name')}</option><option value="size">{t('By size')}</option></select><div className="view-switch"><button className={`icon-button ${view === 'grid' ? 'active' : ''}`} aria-label={t('Grid')} aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={18} /></button><button className={`icon-button ${view === 'list' ? 'active' : ''}`} aria-label={t('List')} aria-pressed={view === 'list'} onClick={() => setView('list')}><LayoutList size={19} /></button></div></div>
          <div className="category-tabs" role="group" aria-label={t('File type')}>{categories.map(c => <button key={c.id} className={filter === c.id ? 'active' : ''} aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}><c.icon size={16} />{t(c.label)}{c.id === 'all' && <span>{files.length}</span>}</button>)}</div>
          <section className={`file-area ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) void importFiles(browserFiles(event.dataTransfer.files)); }}>
            {busy && <div className="progress-line" role="status"><span className="spinner" />{progress || t('Working…')}</div>}
            {!filtered.length ? <div className="empty-state"><div className="empty-art"><div /><FolderClosed size={51} strokeWidth={1.15} /><span><Plus size={19} /></span></div><h2>{t(files.length ? 'Nothing found' : 'Space for your files')}</h2><p>{files.length ? t('Try another name or choose another category.') : t('Documents, photos, archives —\nadd your first file to get started.').split('\n').map((line, index) => <span key={line}>{index > 0 && <br />}{line}</span>)}</p>{!files.length && <button className="secondary-button" disabled={busy} onClick={pick}><Upload size={17} />{t('Choose files')}</button>}<small>{files.length ? t('Showing 0 of {{count}}', { count: files.length }) : t('or drag them here · up to 32 MiB per file')}</small></div> : <div className={`file-grid ${view === 'list' ? 'list-view' : ''}`}>{filtered.map(file => <article className="file-card" key={file.id}>
              <div className={`file-art ${category(file.name)}`}><FileIcon name={file.name} size={32} /><span>{settings.maskFileNames ? 'LOCK' : file.name.includes('.') ? file.name.split('.').pop()?.slice(0, 7).toUpperCase() : 'FILE'}</span></div>
              <div className="file-info"><h3 title={displayName(file)}>{displayName(file)}</h3><p>{formatSize(file.size, language)}<span>·</span>{new Date(file.addedAt).toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' })}</p></div>
              <div className="file-actions"><button className="icon-button" disabled={busy} aria-label={t('Preview {{name}}', { name: file.name })} title={t('Preview')} onClick={() => void showPreview(file)}><Eye size={17} /></button><button className="icon-button" disabled={busy || !native} aria-label={t('Open {{name}} externally', { name: file.name })} title={t('Open externally')} onClick={() => void openExternal(file)}><ExternalLink size={17} /></button><button className="icon-button" disabled={busy} aria-label={t('Export {{name}}', { name: file.name })} title={t('Export')} onClick={() => download(file)}><ArrowDownToLine size={17} /></button><button className="icon-button" disabled={busy} aria-label={t('Rename {{name}}', { name: file.name })} title={t('Rename')} onClick={() => { setName(file.name); setModal({ kind: 'rename', file }); }}><Pencil size={16} /></button><button className="icon-button danger" disabled={busy} aria-label={t('Delete {{name}}', { name: file.name })} title={t('Delete')} onClick={() => setModal({ kind: 'delete', file })}><Trash2 size={16} /></button></div>
            </article>)}</div>}
          </section>
          <footer className="files-footer"><span><div className="offline-dot" />{t('Local storage')}</span><span>{t('{{shown}} of {{total}} files', { shown: filtered.length, total: files.length })}</span></footer>
        </>}
      </div>
    </main>
    <input ref={picker} type="file" multiple hidden aria-label={t('Files to import')} onChange={event => { if (event.target.files) void importFiles(browserFiles(event.target.files)); event.target.value = ''; }} />
    {modal && <Modal title={t(modal.kind === 'rename' ? 'Rename file' : 'Delete file?')} onClose={() => { if (!busy) setModal(null); }}><form onSubmit={changeFile}>
      {modal.kind === 'rename' ? <><label className="field-label" htmlFor="file-name">{t('File name')}</label><input id="file-name" value={name} maxLength={200} required autoFocus onChange={e => setName(e.target.value)} /></> : <p className="modal-copy">{t('“{{name}}” will be removed from the vault. The source file outside it will remain in place.', { name: modal.file.name })}</p>}
      {notice?.error && <p className="error-message" role="alert">{notice.text}</p>}
      <div className="modal-buttons"><button type="button" className="secondary-button" disabled={busy} onClick={() => setModal(null)}>{t('Cancel')}</button><button type="submit" disabled={busy} className={modal.kind === 'delete' ? 'danger-button' : 'primary-button'}>{t(busy ? 'Please wait…' : modal.kind === 'rename' ? 'Save' : 'Delete')}</button></div>
    </form></Modal>}
    {preview && <Modal title={displayName(preview.file)} onClose={closePreview}><div className="preview-area">{preview.kind === 'image' && <img src={preview.url} alt={displayName(preview.file)} />}{preview.kind === 'text' && <pre>{preview.text}</pre>}{preview.kind === 'pdf' && <iframe src={preview.url} title={displayName(preview.file)} />}{preview.kind === 'audio' && <audio src={preview.url} controls autoPlay />}{preview.kind === 'video' && <video src={preview.url} controls autoPlay />}{preview.kind === 'unknown' && <p>{t('No built-in preview is available for this format.')}</p>}</div><div className="modal-buttons"><button className="secondary-button" onClick={() => void openExternal(preview.file)}><ExternalLink size={16}/>{t('Open externally')}</button><button className="primary-button" onClick={closePreview}>{t('Close')}</button></div></Modal>}
  </div>;
}
