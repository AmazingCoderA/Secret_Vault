import { useRef, useState, type FormEvent } from 'react';
import { Archive, ArrowDownToLine, ArrowUpRight, Check, Eye, ExternalLink, File, FileText, FolderClosed, Grid2X2, HardDrive, Image, LayoutList, LockKeyhole, Plus, Search, Settings2, ShieldAlert, ShieldCheck, Trash2, Upload, X, Pencil, Zap } from 'lucide-react';
import { api, browserFiles, errorText, exportFile, maxFileSize, native, pickNativeFiles, type PickedFile } from '../api';
import { category, formatSize, modes, type Category, type Login, type Settings, type Snapshot, type VaultFile } from '../types';
import { Modal } from './Modal';
import { SettingsPanel } from './SettingsPanel';

const categories: { id: Category; label: string; icon: typeof File }[] = [
  { id: 'all', label: 'Все файлы', icon: FolderClosed }, { id: 'image', label: 'Изображения', icon: Image },
  { id: 'document', label: 'Документы', icon: FileText }, { id: 'archive', label: 'Архивы', icon: Archive },
  { id: 'other', label: 'Другое', icon: File },
];
function FileIcon({ name, size = 24 }: { name: string; size?: number }) {
  const Icon = categories.find(c => c.id === category(name))?.icon ?? File;
  return <Icon size={size} strokeWidth={1.6} />;
}

export function Workspace({ login, onLock, onSnapshot, isActive, onDialog }: {
  login: Login; onLock: () => void; onSnapshot: (snapshot: Snapshot) => void; isActive: () => boolean; onDialog: (open: boolean) => void;
}) {
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
  const displayName = (file: VaultFile) => settings.maskFileNames ? `Файл ${files.findIndex(item => item.id === file.id) + 1}` : file.name;
  const filtered = files.filter(file => (filter === 'all' || category(file.name) === filter) && file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'ru') : sort === 'size' ? b.size - a.size : b.addedAt - a.addedAt);

  function report(error: unknown) {
    if (!isActive()) return;
    const text = errorText(error);
    if (text.includes('заблокировано')) { onLock(); return; }
    setNotice({ text, error: true });
  }
  async function refresh() { const next = await api.snapshot(token); if (isActive()) onSnapshot(next); }
  async function importFiles(picked: PickedFile[]) {
    if (!isActive() || !picked.length) return;
    setBusy(true); setNotice(null);
    let count = 0;
    const errors: string[] = [];
    try {
      const occupied = new Set(files.map(file => file.name.toLocaleLowerCase()));
      const cleanupChoice = native && picked.some(file => file.sourcePath) ? window.prompt('Что сделать с исходниками после успешного импорта: оставить, удалить или 3 прохода?', 'оставить')?.trim().toLocaleLowerCase() : 'оставить';
      const cleanupPasses: 0 | 3 | null = cleanupChoice === '3' || cleanupChoice === '3 прохода' ? 3 : cleanupChoice === 'удалить' ? 0 : null;
      for (const file of picked) {
        if (!isActive()) break;
        setProgress(`Добавляем ${count + 1} из ${picked.length}…`);
        try {
          if (file.size > maxFileSize) throw new Error('превышен лимит 32 МиБ');
          let importName = file.name;
          if (occupied.has(importName.toLocaleLowerCase())) {
            const choice = window.prompt(`Файл «${importName}» уже существует. Введите: заменить, копия или пропустить`, 'копия')?.trim().toLocaleLowerCase();
            if (!choice || choice === 'пропустить' || choice === 'skip') continue;
            if (choice !== 'заменить' && choice !== 'replace') {
              const dot = importName.lastIndexOf('.'); const base = dot > 0 ? importName.slice(0, dot) : importName; const ext = dot > 0 ? importName.slice(dot) : '';
              let index = 2; while (occupied.has(`${base} (${index})${ext}`.toLocaleLowerCase())) index++; importName = `${base} (${index})${ext}`;
            }
          }
          const bytes = await file.read();
          try { if (!isActive()) break; await api.import(token, importName, bytes); occupied.add(importName.toLocaleLowerCase()); count++; if (file.sourcePath && cleanupPasses !== null) await api.eraseExternal(file.sourcePath, cleanupPasses); }
          finally { bytes.fill(0); }
        } catch (error) { errors.push(`${file.name}: ${errorText(error)}`); }
      }
      if (isActive()) {
        await refresh();
        setNotice({ text: `Добавлено файлов: ${count}.${errors.length ? ` Не удалось: ${errors.join('; ')}` : ' Оригиналы остались на месте.'}`, error: errors.length > 0 });
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
      if (done && isActive()) setNotice({ text: 'Файл экспортирован.', error: false });
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
  async function openExternal(file: VaultFile) { try { await api.openExternal(token, file.id); setNotice({ text: 'Открыто во внешнем приложении. Временная копия будет удалена автоматически.', error: false }); } catch (error) { report(error); } }
  async function changeFile(event: FormEvent) {
    event.preventDefault();
    if (!modal) return;
    setBusy(true);
    try {
      if (modal.kind === 'rename') await api.rename(token, modal.file.id, name);
      else await api.delete(token, modal.file.id);
      if (!isActive()) return;
      setModal(null); await refresh();
      setNotice({ text: modal.kind === 'rename' ? 'Имя файла изменено.' : 'Файл удалён из хранилища.', error: false });
    } catch (error) { report(error); }
    finally { if (isActive()) setBusy(false); }
  }
  async function saveSettings(next: Settings, password: string, newPassword?: string, recoveryAnswer?: string) {
    setBusy(true); setNotice(null);
    try {
      await api.settings(token, next, password, newPassword, recoveryAnswer);
      if (!isActive()) return 'Сессия завершена.';
      await refresh(); setNotice({ text: 'Настройки сохранены.', error: false }); return null;
    } catch (error) { const text = errorText(error); report(error); return text; }
    finally { if (isActive()) setBusy(false); }
  }

  return <div className="vault-layout">
    <aside className="sidebar">
      <div className="vault-brand"><div className="brand-mark"><LockKeyhole size={23} /></div><strong>vault<span>.</span></strong><span className="version">0.1</span></div>
      <div className="sidebar-label">ЛИЧНОЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Основная навигация">
        <button className={`nav-item ${page === 'files' ? 'selected' : ''}`} onClick={() => setPage('files')}><FolderClosed size={20} />Мои файлы<span className="nav-count">{files.length}</span></button>
        <button className={`nav-item ${page === 'settings' ? 'selected' : ''}`} onClick={() => setPage('settings')}><Settings2 size={20} />Настройки</button>
      </nav>
      <div className="sidebar-note"><div className="offline-dot" />Только на этом устройстве<p>Ваше пространство.<br />Без аккаунтов и облака.</p></div>
      <div className="sidebar-bottom"><div className="prototype-label"><ShieldCheck size={17} />{native ? 'XChaCha20 · локально' : 'Браузерное демо · в памяти'}</div><button className="emergency-button" onClick={onLock}><Zap size={18} />Emergency Lock<span>Esc</span></button></div>
    </aside>
    <main className="vault-main">
      <header className="vault-topbar"><div className="breadcrumb">Личное <span>/</span><strong>{page === 'files' ? 'Мои файлы' : 'Настройки'}</strong></div><button className="text-button lock-top" onClick={onLock}><LockKeyhole size={17} /><span>Заблокировать</span></button></header>
      <div className="vault-content">
        <div className="page-heading"><div><span className="eyebrow">{page === 'files' ? 'ВСЁ В ОДНОМ МЕСТЕ' : 'ПОД ВАШИМ КОНТРОЛЕМ'}</span><h1>{page === 'files' ? 'Мои файлы' : 'Настройки'}</h1><p>{page === 'files' ? 'То, что важно, — всегда под рукой.' : 'Ваше устройство. Ваши правила.'}</p></div>{page === 'files' && <button className="primary-button import-button" disabled={busy} onClick={pick}><Plus size={20} /><span>Добавить файлы</span></button>}</div>
        <div className="prototype-banner"><ShieldCheck size={18} /><span><strong>{native ? 'Зашифрованный контейнер активен.' : 'Демо: данные исчезнут при обновлении.'}</strong> {native ? 'Имена и содержимое защищены с проверкой целостности.' : 'Для постоянного хранения запустите приложение через Tauri.'}</span></div>
        {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <ShieldAlert size={18} /> : <Check size={18} />}<span>{notice.text}</span><button className="icon-button" aria-label="Скрыть сообщение" onClick={() => setNotice(null)}><X size={17} /></button></div>}
        {page === 'settings' ? <SettingsPanel settings={settings} busy={busy} onSave={saveSettings} /> : <>
          <section className="stats-grid" aria-label="Статистика хранилища">
            <div className="stat-card"><span className="stat-icon mint"><FolderClosed size={21} /></span><div><span>Всего файлов</span><strong>{files.length}<small>в хранилище</small></strong></div></div>
            <div className="stat-card"><span className="stat-icon blue"><HardDrive size={21} /></span><div><span>Занято файлами</span><strong>{formatSize(total)}</strong></div></div>
            <button className="stat-card protection-stat" onClick={() => setPage('settings')}><span className="stat-icon lavender"><ShieldCheck size={21} /></span><div><span>Проверка пароля</span><strong>{modes.find(m => m.id === settings.mode)?.name}<small>{native ? 'Argon2id' : 'демо'}</small></strong></div><ArrowUpRight size={17} /></button>
          </section>
          <div className="files-toolbar"><div className="search-field"><Search size={18} /><input aria-label="Поиск файлов" placeholder="Найти что-нибудь…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="icon-button" aria-label="Очистить поиск" onClick={() => setQuery('')}><X size={15} /></button>}</div><select className="sort-select" aria-label="Сортировка" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Сначала новые</option><option value="name">По имени</option><option value="size">По размеру</option></select><div className="view-switch"><button className={`icon-button ${view === 'grid' ? 'active' : ''}`} aria-label="Сетка" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={18} /></button><button className={`icon-button ${view === 'list' ? 'active' : ''}`} aria-label="Список" aria-pressed={view === 'list'} onClick={() => setView('list')}><LayoutList size={19} /></button></div></div>
          <div className="category-tabs" role="group" aria-label="Тип файлов">{categories.map(c => <button key={c.id} className={filter === c.id ? 'active' : ''} aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}><c.icon size={16} />{c.label}{c.id === 'all' && <span>{files.length}</span>}</button>)}</div>
          <section className={`file-area ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) void importFiles(browserFiles(event.dataTransfer.files)); }}>
            {busy && <div className="progress-line" role="status"><span className="spinner" />{progress || 'Выполняем операцию…'}</div>}
            {!filtered.length ? <div className="empty-state"><div className="empty-art"><div /><FolderClosed size={51} strokeWidth={1.15} /><span><Plus size={19} /></span></div><h2>{files.length ? 'Ничего не нашлось' : 'Место для ваших файлов'}</h2><p>{files.length ? 'Попробуйте другое имя или выберите другую категорию.' : <>Документы, фотографии, архивы —<br />добавьте первый файл, чтобы начать.</>}</p>{!files.length && <button className="secondary-button" disabled={busy} onClick={pick}><Upload size={17} />Выбрать файлы</button>}<small>{files.length ? `Показано 0 из ${files.length}` : 'или перетащите их сюда · до 32 МиБ на файл'}</small></div> : <div className={`file-grid ${view === 'list' ? 'list-view' : ''}`}>{filtered.map(file => <article className="file-card" key={file.id}>
              <div className={`file-art ${category(file.name)}`}><FileIcon name={file.name} size={32} /><span>{settings.maskFileNames ? 'LOCK' : file.name.includes('.') ? file.name.split('.').pop()?.slice(0, 7).toUpperCase() : 'FILE'}</span></div>
              <div className="file-info"><h3 title={displayName(file)}>{displayName(file)}</h3><p>{formatSize(file.size)}<span>·</span>{new Date(file.addedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</p></div>
              <div className="file-actions"><button className="icon-button" disabled={busy} aria-label={`Просмотреть ${file.name}`} title="Просмотреть" onClick={() => void showPreview(file)}><Eye size={17} /></button><button className="icon-button" disabled={busy || !native} aria-label={`Открыть ${file.name} во внешнем приложении`} title="Открыть в…" onClick={() => void openExternal(file)}><ExternalLink size={17} /></button><button className="icon-button" disabled={busy} aria-label={`Экспортировать ${file.name}`} title="Экспортировать" onClick={() => download(file)}><ArrowDownToLine size={17} /></button><button className="icon-button" disabled={busy} aria-label={`Переименовать ${file.name}`} title="Переименовать" onClick={() => { setName(file.name); setModal({ kind: 'rename', file }); }}><Pencil size={16} /></button><button className="icon-button danger" disabled={busy} aria-label={`Удалить ${file.name}`} title="Удалить" onClick={() => setModal({ kind: 'delete', file })}><Trash2 size={16} /></button></div>
            </article>)}</div>}
          </section>
          <footer className="files-footer"><span><div className="offline-dot" />Локальное хранение</span><span>{filtered.length} из {files.length} файлов</span></footer>
        </>}
      </div>
    </main>
    <input ref={picker} type="file" multiple hidden aria-label="Файлы для импорта" onChange={event => { if (event.target.files) void importFiles(browserFiles(event.target.files)); event.target.value = ''; }} />
    {modal && <Modal title={modal.kind === 'rename' ? 'Переименовать файл' : 'Удалить файл?'} onClose={() => { if (!busy) setModal(null); }}><form onSubmit={changeFile}>
      {modal.kind === 'rename' ? <><label className="field-label" htmlFor="file-name">Имя файла</label><input id="file-name" value={name} maxLength={200} required autoFocus onChange={e => setName(e.target.value)} /></> : <p className="modal-copy">«{modal.file.name}» будет удалён из хранилища. Исходный файл за его пределами останется на месте.</p>}
      {notice?.error && <p className="error-message" role="alert">{notice.text}</p>}
      <div className="modal-buttons"><button type="button" className="secondary-button" disabled={busy} onClick={() => setModal(null)}>Отмена</button><button type="submit" disabled={busy} className={modal.kind === 'delete' ? 'danger-button' : 'primary-button'}>{busy ? 'Подождите…' : modal.kind === 'rename' ? 'Сохранить' : 'Удалить'}</button></div>
    </form></Modal>}
    {preview && <Modal title={displayName(preview.file)} onClose={closePreview}><div className="preview-area">{preview.kind === 'image' && <img src={preview.url} alt={displayName(preview.file)} />}{preview.kind === 'text' && <pre>{preview.text}</pre>}{preview.kind === 'pdf' && <iframe src={preview.url} title={displayName(preview.file)} />}{preview.kind === 'audio' && <audio src={preview.url} controls autoPlay />}{preview.kind === 'video' && <video src={preview.url} controls autoPlay />}{preview.kind === 'unknown' && <p>Для этого формата нет встроенного просмотра.</p>}</div><div className="modal-buttons"><button className="secondary-button" onClick={() => void openExternal(preview.file)}><ExternalLink size={16}/>Открыть в…</button><button className="primary-button" onClick={closePreview}>Закрыть</button></div></Modal>}
  </div>;
}
