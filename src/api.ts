import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, stat, writeFile } from '@tauri-apps/plugin-fs';
import { defaultSettings, type ContainerSummary, type Login, type Settings, type Snapshot, type VaultFile, type VaultStatus } from './types';

export const native = isTauri();
export const maxFileSize = 32 * 1024 * 1024;
export async function pickContainerLocation(): Promise<string | undefined> {
  if (!native) return undefined;
  const selected = await open({ directory: true, multiple: false, title: 'Папка для контейнера' });
  return typeof selected === 'string' ? `${selected}\\vault-container.sqlite3` : undefined;
}

// Browser-only UI sandbox. No persistence and no security claims; native uses Rust/Argon2id.
interface DemoContainer { summary: ContainerSummary; hidden: boolean; password: string; settings: Settings; files: Map<string, { meta: VaultFile; bytes: Uint8Array }> }
const demoContainers = new Map<string, DemoContainer>();
let demoActive: DemoContainer | null = null;
let demoToken: string | null = null;
let demoSettings = { ...defaultSettings };
let demoRecoveryAnswer: string | null = null;
const demoFiles = new Map<string, { meta: VaultFile; bytes: Uint8Array }>();
let demoLastActivity = 0;
function authorize(token: string) {
  if (!demoToken || token !== demoToken || Date.now() - demoLastActivity >= demoSettings.autoLockSecs * 1000) {
    demoToken = null;
    throw new Error('Хранилище заблокировано. Войдите снова.');
  }
  demoLastActivity = Date.now();
}
function snapshot(): Snapshot {
  const files = demoActive?.files ?? demoFiles;
  return { files: [...files.values()].map(f => ({ ...f.meta })).sort((a, b) => b.addedAt - a.addedAt), settings: { ...(demoActive?.settings ?? demoSettings) } };
}
function validName(name: string) {
  name = name.trim();
  if (!name || [...name].length > 200 || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name) || name.endsWith('.')) {
    throw new Error('Имя: 1–200 символов, без служебных символов и точки в конце.');
  }
  return name;
}
function validPassword(password: string) {
  if ([...password].length < 8 || new TextEncoder().encode(password).length > 1024) throw new Error('Пароль: минимум 8 символов, максимум 1024 байта.');
}

export const api = {
  async status(): Promise<VaultStatus> {
    if (native) return invoke('vault_status');
    return { containers: [...demoContainers.values()].filter(v => !v.hidden).map(v => v.summary) };
  },
  async createContainer(name: string, hidden: boolean, password: string, location?: string): Promise<Login> {
    if (native) return invoke('create_container', { name, hidden, password, location: location || null });
    if (!name.trim()) throw new Error('Введите имя контейнера.');
    validPassword(password);
    if ([...demoContainers.values()].some(v => !v.hidden && !hidden && v.summary.name === name.trim())) throw new Error('Контейнер с таким видимым именем уже существует.');
    const summary = { id: crypto.randomUUID(), name: name.trim() };
    demoActive = { summary, hidden, password, settings: { ...defaultSettings }, files: new Map() };
    demoContainers.set(summary.id, demoActive);
    demoToken = crypto.randomUUID();
    demoLastActivity = Date.now();
    return { token: demoToken, snapshot: snapshot() };
  },
  async deleteContainer(id: string, passes: 0 | 3): Promise<void> { if (native) return invoke('delete_container', { id, passes }); demoContainers.delete(id); },
  async undoDeleteContainer(id: string): Promise<void> { if (native) return invoke('undo_delete_container', { id }); },
  async login(id: string | null, name: string | null, password: string): Promise<Login> {
    if (native) return invoke('unlock_container', { id, name, password });
    const candidate = id ? demoContainers.get(id) : [...demoContainers.values()].find(v => v.hidden && v.summary.name === name?.trim());
    if (!candidate || candidate.password !== password) throw new Error('Контейнер не найден или неверные данные доступа.');
    demoActive = candidate; demoSettings = candidate.settings; demoFiles.clear(); candidate.files.forEach((v,k) => demoFiles.set(k,v));
    demoToken = crypto.randomUUID(); demoLastActivity = Date.now(); return { token: demoToken, snapshot: snapshot() };
  },
  async recoveryQuestion(id: string | null, name: string | null): Promise<string | null> {
    if (native) return invoke('recovery_question', { id, name });
    return demoActive?.settings.recoveryQuestion ?? null;
  },
  async recoverContainer(id: string | null, name: string | null, answer: string, newPassword: string): Promise<Login> {
    if (native) return invoke('recover_vault', { id, name, answer, newPassword });
    validPassword(newPassword);
    const candidate = id ? demoContainers.get(id) : [...demoContainers.values()].find(v => v.hidden && v.summary.name === name?.trim());
    if (!candidate || candidate.settings.recoveryQuestion === null || answer.trim().toLocaleLowerCase() !== demoRecoveryAnswer) throw new Error('Неверный ответ.');
    candidate.password = newPassword; demoActive = candidate; demoToken = crypto.randomUUID(); demoLastActivity = Date.now();
    return { token: demoToken, snapshot: snapshot() };
  },
  async lock(): Promise<void> {
    if (native) return invoke('lock_vault');
    demoToken = null; demoActive = null;
  },
  async recover(answer: string, newPassword: string): Promise<Login> {
    if (native) return invoke('recover_vault', { answer, newPassword });
    if (!demoSettings.recoveryQuestion || answer.trim().toLocaleLowerCase() !== demoRecoveryAnswer) throw new Error('Неверный ответ.');
    validPassword(newPassword);
    if (!demoActive) throw new Error('Контейнер не выбран.');
    demoActive.password = newPassword;
    demoToken = crypto.randomUUID();
    demoLastActivity = Date.now();
    return { token: demoToken, snapshot: snapshot() };
  },
  async revoke(token: string): Promise<void> {
    if (native) return invoke('revoke_session', { token });
    if (demoToken === token) demoToken = null;
  },
  async touch(token: string): Promise<void> {
    if (native) return invoke('touch_session', { token });
    authorize(token);
  },
  async snapshot(token: string): Promise<Snapshot> {
    if (native) return invoke('vault_snapshot', { token });
    authorize(token);
    return snapshot();
  },
  async import(token: string, name: string, bytes: Uint8Array): Promise<VaultFile> {
    if (bytes.byteLength > maxFileSize) throw new Error('Один файл может занимать до 32 МиБ.');
    if (native) return invoke('import_file', bytes, { headers: { 'x-vault-token': token, 'x-vault-name': encodeURIComponent(name) } });
    authorize(token);
    const meta: VaultFile = { id: crypto.randomUUID(), name: validName(name), size: bytes.byteLength, addedAt: Date.now() };
    const target = demoActive?.files ?? demoFiles;
    const existing = [...target.values()].find(file => file.meta.name === meta.name);
    if (existing) meta.id = existing.meta.id;
    target.set(meta.id, { meta, bytes: bytes.slice() });
    return meta;
  },
  async read(token: string, id: string): Promise<Uint8Array> {
    if (native) return new Uint8Array(await invoke<ArrayBuffer>('export_file', { token, id }));
    authorize(token);
    const file = (demoActive?.files ?? demoFiles).get(id);
    if (!file) throw new Error('Файл не найден.');
    return file.bytes.slice();
  },
  async openExternal(token: string, id: string): Promise<void> {
    if (native) return invoke('open_external', { token, id });
    throw new Error('Открытие во внешнем приложении доступно только в нативной версии.');
  },
  async eraseExternal(path: string, passes: 0 | 3): Promise<void> {
    if (native) return invoke('erase_external_file', { path, passes });
  },
  async rename(token: string, id: string, name: string): Promise<void> {
    if (native) return invoke('rename_file', { token, id, name });
    authorize(token);
    const file = (demoActive?.files ?? demoFiles).get(id);
    if (!file) throw new Error('Файл не найден.');
    file.meta.name = validName(name);
  },
  async delete(token: string, id: string): Promise<void> {
    if (native) return invoke('delete_file', { token, id });
    authorize(token);
    if (!(demoActive?.files ?? demoFiles).delete(id)) throw new Error('Файл не найден.');
  },
  async settings(token: string, settings: Settings, password: string, newPassword?: string, recoveryAnswer?: string): Promise<void> {
    if (native) return invoke('save_settings', { token, settings, password, newPassword: newPassword || null, recoveryAnswer: recoveryAnswer || null });
    authorize(token);
    if (!demoActive || password !== demoActive.password) throw new Error('Неверный пароль.');
    if (newPassword) { validPassword(newPassword); demoActive.password = newPassword; }
    if (!settings.recoveryQuestion) demoRecoveryAnswer = null;
    else if (recoveryAnswer) demoRecoveryAnswer = recoveryAnswer.trim().toLocaleLowerCase();
    else if (settings.recoveryQuestion !== demoSettings.recoveryQuestion) throw new Error('Введите ответ для контрольного вопроса.');
    demoSettings = { ...settings }; demoActive.settings = demoSettings;
  },
};

export interface PickedFile { name: string; size: number; sourcePath?: string; read: () => Promise<Uint8Array> }
export async function pickNativeFiles(): Promise<PickedFile[]> {
  const paths = await open({ multiple: true, directory: false, title: 'Добавить файлы' });
  if (!paths) return [];
  return Promise.all(paths.map(async (path, index) => {
    const info = await stat(path);
    // Android document providers may expose an opaque URI, rather than the original name.
    const basename = path.split(/[\\/]/).pop() || 'Файл';
    const name = path.startsWith('content:') ? `Импорт-${Date.now()}-${index + 1}` : path.startsWith('file:') ? decodeURIComponent(basename) : basename;
    return { name, size: info.size, sourcePath: path, read: () => readFile(path) };
  }));
}
export function browserFiles(files: FileList | File[]): PickedFile[] {
  return Array.from(files).map(file => ({ name: file.name, size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()) }));
}
export async function exportFile(token: string, file: VaultFile, stillActive: () => boolean): Promise<boolean> {
  if (native) {
    const destination = await save({ defaultPath: file.name, title: 'Экспортировать файл' });
    if (!destination || !stillActive()) return false;
    const bytes = await api.read(token, file.id);
    try {
      if (!stillActive()) return false;
      await writeFile(destination, bytes);
      return true;
    } finally { bytes.fill(0); }
  }
  const bytes = await api.read(token, file.id);
  if (!stillActive()) { bytes.fill(0); return false; }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  bytes.fill(0);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
