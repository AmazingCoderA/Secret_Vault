import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, stat, writeFile } from '@tauri-apps/plugin-fs';
import { defaultSettings, type ContainerSummary, type Login, type Settings, type Snapshot, type VaultFile, type VaultStatus } from './types';
import { translate } from './i18n';

export const native = isTauri();
export const maxFileSize = 32 * 1024 * 1024;
export async function pickContainerLocation(): Promise<string | undefined> {
  if (!native) return undefined;
  const selected = await open({ directory: true, multiple: false, title: translate('Container folder') });
  return typeof selected === 'string' ? `${selected}\\vault-container.sqlite3` : undefined;
}

// Web fallback for development and browser preview; native builds use Rust/Argon2id.
interface WebContainer { summary: ContainerSummary; hidden: boolean; password: string; settings: Settings; files: Map<string, { meta: VaultFile; bytes: Uint8Array }> }
const webContainers = new Map<string, WebContainer>();
let webActive: WebContainer | null = null;
let webToken: string | null = null;
let webSettings = { ...defaultSettings };
let webRecoveryAnswer: string | null = null;
const webFiles = new Map<string, { meta: VaultFile; bytes: Uint8Array }>();
let webLastActivity = 0;
function authorize(token: string) {
  if (!webToken || token !== webToken || Date.now() - webLastActivity >= webSettings.autoLockSecs * 1000) {
    webToken = null;
    throw new Error('Vault is locked. Sign in again.');
  }
  webLastActivity = Date.now();
}
function snapshot(): Snapshot {
  const files = webActive?.files ?? webFiles;
  return { files: [...files.values()].map(f => ({ ...f.meta })).sort((a, b) => b.addedAt - a.addedAt), settings: { ...(webActive?.settings ?? webSettings) } };
}
function validName(name: string) {
  name = name.trim();
  if (!name || [...name].length > 200 || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name) || name.endsWith('.')) {
    throw new Error('Name must be 1–200 characters, without reserved characters or a trailing period.');
  }
  return name;
}
function validPassword(password: string) {
  if ([...password].length < 8 || new TextEncoder().encode(password).length > 1024) throw new Error('Password must be at least 8 characters and at most 1024 bytes.');
}

export const api = {
  async status(): Promise<VaultStatus> {
    if (native) return invoke('vault_status');
    return { containers: [...webContainers.values()].filter(v => !v.hidden).map(v => v.summary) };
  },
  async createContainer(name: string, hidden: boolean, password: string, location?: string): Promise<Login> {
    if (native) return invoke('create_container', { name, hidden, password, location: location || null });
    if (!name.trim()) throw new Error('Enter a container name.');
    validPassword(password);
    if ([...webContainers.values()].some(v => !v.hidden && !hidden && v.summary.name === name.trim())) throw new Error('A container with this visible name already exists.');
    const summary = { id: crypto.randomUUID(), name: name.trim() };
    webActive = { summary, hidden, password, settings: { ...defaultSettings }, files: new Map() };
    webContainers.set(summary.id, webActive);
    webToken = crypto.randomUUID();
    webLastActivity = Date.now();
    return { token: webToken, snapshot: snapshot() };
  },
  async deleteContainer(id: string, passes: 0 | 3): Promise<void> { if (native) return invoke('delete_container', { id, passes }); webContainers.delete(id); },
  async undoDeleteContainer(id: string): Promise<void> { if (native) return invoke('undo_delete_container', { id }); },
  async login(id: string | null, name: string | null, password: string): Promise<Login> {
    if (native) return invoke('unlock_container', { id, name, password });
    const candidate = id ? webContainers.get(id) : [...webContainers.values()].find(v => v.hidden && v.summary.name === name?.trim());
    if (!candidate || candidate.password !== password) throw new Error('Container not found or access details are incorrect.');
    webActive = candidate; webSettings = candidate.settings; webFiles.clear(); candidate.files.forEach((v,k) => webFiles.set(k,v));
    webToken = crypto.randomUUID(); webLastActivity = Date.now(); return { token: webToken, snapshot: snapshot() };
  },
  async recoveryQuestion(id: string | null, name: string | null): Promise<string | null> {
    if (native) return invoke('recovery_question', { id, name });
    return webActive?.settings.recoveryQuestion ?? null;
  },
  async recoverContainer(id: string | null, name: string | null, answer: string, newPassword: string): Promise<Login> {
    if (native) return invoke('recover_vault', { id, name, answer, newPassword });
    validPassword(newPassword);
    const candidate = id ? webContainers.get(id) : [...webContainers.values()].find(v => v.hidden && v.summary.name === name?.trim());
    if (!candidate || candidate.settings.recoveryQuestion === null || answer.trim().toLocaleLowerCase() !== webRecoveryAnswer) throw new Error('Incorrect answer.');
    candidate.password = newPassword; webActive = candidate; webToken = crypto.randomUUID(); webLastActivity = Date.now();
    return { token: webToken, snapshot: snapshot() };
  },
  async lock(): Promise<void> {
    if (native) return invoke('lock_vault');
    webToken = null; webActive = null;
  },
  async recover(answer: string, newPassword: string): Promise<Login> {
    if (native) return invoke('recover_vault', { answer, newPassword });
    if (!webSettings.recoveryQuestion || answer.trim().toLocaleLowerCase() !== webRecoveryAnswer) throw new Error('Incorrect answer.');
    validPassword(newPassword);
    if (!webActive) throw new Error('No container selected.');
    webActive.password = newPassword;
    webToken = crypto.randomUUID();
    webLastActivity = Date.now();
    return { token: webToken, snapshot: snapshot() };
  },
  async revoke(token: string): Promise<void> {
    if (native) return invoke('revoke_session', { token });
    if (webToken === token) webToken = null;
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
    if (bytes.byteLength > maxFileSize) throw new Error('A file may be up to 32 MiB.');
    if (native) return invoke('import_file', bytes, { headers: { 'x-vault-token': token, 'x-vault-name': encodeURIComponent(name) } });
    authorize(token);
    const meta: VaultFile = { id: crypto.randomUUID(), name: validName(name), size: bytes.byteLength, addedAt: Date.now() };
    const target = webActive?.files ?? webFiles;
    const existing = [...target.values()].find(file => file.meta.name === meta.name);
    if (existing) meta.id = existing.meta.id;
    target.set(meta.id, { meta, bytes: bytes.slice() });
    return meta;
  },
  async read(token: string, id: string): Promise<Uint8Array> {
    if (native) return new Uint8Array(await invoke<ArrayBuffer>('export_file', { token, id }));
    authorize(token);
    const file = (webActive?.files ?? webFiles).get(id);
    if (!file) throw new Error('File not found.');
    return file.bytes.slice();
  },
  async openExternal(token: string, id: string): Promise<void> {
    if (native) return invoke('open_external', { token, id });
    throw new Error('Opening in an external application is available only in the desktop application.');
  },
  async eraseExternal(path: string, passes: 0 | 3): Promise<void> {
    if (native) return invoke('erase_external_file', { path, passes });
  },
  async rename(token: string, id: string, name: string): Promise<void> {
    if (native) return invoke('rename_file', { token, id, name });
    authorize(token);
    const file = (webActive?.files ?? webFiles).get(id);
    if (!file) throw new Error('File not found.');
    file.meta.name = validName(name);
  },
  async delete(token: string, id: string): Promise<void> {
    if (native) return invoke('delete_file', { token, id });
    authorize(token);
    if (!(webActive?.files ?? webFiles).delete(id)) throw new Error('File not found.');
  },
  async settings(token: string, settings: Settings, password: string, newPassword?: string, recoveryAnswer?: string): Promise<void> {
    if (native) return invoke('save_settings', { token, settings, password, newPassword: newPassword || null, recoveryAnswer: recoveryAnswer || null });
    authorize(token);
    if (!webActive || password !== webActive.password) throw new Error('Incorrect password.');
    if (newPassword) { validPassword(newPassword); webActive.password = newPassword; }
    if (!settings.recoveryQuestion) webRecoveryAnswer = null;
    else if (recoveryAnswer) webRecoveryAnswer = recoveryAnswer.trim().toLocaleLowerCase();
    else if (settings.recoveryQuestion !== webSettings.recoveryQuestion) throw new Error('Enter an answer for the recovery question.');
    webSettings = { ...settings }; webActive.settings = webSettings;
  },
};

export interface PickedFile { name: string; size: number; sourcePath?: string; read: () => Promise<Uint8Array> }
export async function pickNativeFiles(): Promise<PickedFile[]> {
  const paths = await open({ multiple: true, directory: false, title: translate('Import files') });
  if (!paths) return [];
  return Promise.all(paths.map(async (path, index) => {
    const info = await stat(path);
    // Android document providers may expose an opaque URI, rather than the original name.
    const basename = path.split(/[\\/]/).pop() || translate('File');
    const name = path.startsWith('content:') ? translate('Import-{{date}}-{{index}}', { date: Date.now(), index: index + 1 }) : path.startsWith('file:') ? decodeURIComponent(basename) : basename;
    return { name, size: info.size, sourcePath: path, read: () => readFile(path) };
  }));
}
export function browserFiles(files: FileList | File[]): PickedFile[] {
  return Array.from(files).map(file => ({ name: file.name, size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()) }));
}
export async function exportFile(token: string, file: VaultFile, stillActive: () => boolean): Promise<boolean> {
  if (native) {
    const destination = await save({ defaultPath: file.name, title: translate('Export file') });
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
const errorAliases: Record<string, string> = {
  'Хранилище заблокировано. Войдите снова.': 'Vault is locked. Sign in again.',
  'Имя: 1–200 символов, без служебных символов и точки в конце.': 'Name must be 1–200 characters, without reserved characters or a trailing period.',
  'Пароль: минимум 8 символов, максимум 1024 байта.': 'Password must be at least 8 characters and at most 1024 bytes.',
  'Введите имя контейнера.': 'Enter a container name.',
  'Контейнер с таким видимым именем уже существует.': 'A container with this visible name already exists.',
  'Контейнер не найден или неверные данные доступа.': 'Container not found or access details are incorrect.',
  'Неверный ответ.': 'Incorrect answer.',
  'Неверный пароль.': 'Incorrect password.',
  'Контейнер не выбран.': 'No container selected.',
  'Один файл может занимать до 32 МиБ.': 'A file may be up to 32 MiB.',
  'Файл не найден.': 'File not found.',
  'Открытие во внешнем приложении доступно только в нативной версии.': 'Opening in an external application is available only in the desktop application.',
  'Открытие во внешнем приложении доступно только в настольном приложении.': 'Opening in an external application is available only in the desktop application.',
  'Введите ответ для контрольного вопроса.': 'Enter an answer for the recovery question.',
  'Нет сессии.': 'No session.',
  'Нет имени файла.': 'No file name.',
  'Некорректное имя файла.': 'Invalid file name.',
  'Ожидались двоичные данные.': 'Binary data was expected.',
  'Контейнер не найден.': 'Container not found.',
  'Не удалось защитить имя контейнера.': 'Could not protect the container name.',
  'Допустимо 0 или 3 прохода очистки.': 'Only 0 or 3 wipe passes are allowed.',
  'Окно отмены истекло.': 'The undo window has expired.',
  'Неверный ответ или восстановление не настроено.': 'The answer is incorrect or recovery is not configured.',
  'Исходный файл не найден.': 'Source file not found.',
  'Не удалось удалить исходный файл.': 'Could not delete the source file.',
  'Неизвестная тема.': 'Unknown theme.',
  'Неизвестный режим защиты.': 'Unknown protection mode.',
  'Некорректные настройки.': 'Invalid settings.',
  'Некорректный цвет интерфейса.': 'Invalid interface color.',
  'Хранилище уже создано.': 'Vault already exists.',
  'Повреждена запись пароля.': 'The password record is damaged.',
  'Сначала создайте хранилище.': 'Create a vault first.',
  'Восстановление пароля не настроено.': 'Password recovery is not configured.',
  'Ошибка системных часов.': 'System clock error.',
  'Введите ответ заново для обновления защиты.': 'Enter the answer again to update protection.',
  'Не удалось обработать пароль.': 'Could not process the password.',
  'Не удалось получить ключ шифрования.': 'Could not derive the encryption key.',
  'Ошибка ключа шифрования.': 'Encryption key error.',
  'Не удалось защитить ключ хранилища.': 'Could not protect the vault key.',
  'Повреждён контейнер ключа.': 'The key container is damaged.',
  'Не удалось открыть ключ хранилища.': 'Could not open the vault key.',
  'Не удалось зашифровать данные.': 'Could not encrypt data.',
  'Повреждён зашифрованный контейнер.': 'The encrypted container is damaged.',
  'Контейнер повреждён или подменён.': 'The container is damaged or has been modified.',
  'Обнаружено незашифрованное имя файла.': 'An unencrypted file name was found.',
  'Повреждено имя файла.': 'The file name is damaged.',
  'Обнаружены незашифрованные данные файла.': 'Unencrypted file data was found.',
  'Контрольный вопрос: от 3 до 200 символов.': 'Recovery question must be 3–200 characters.',
  'Ответ: минимум 3 символа, максимум 1024 байта.': 'Answer must be at least 3 characters and at most 1024 bytes.',
};
const errorPrefixes: [string, string][] = [
  ['Операция прервана.', 'Operation cancelled.'],
  ['Внутренняя ошибка. Перезапустите приложение.', 'Internal error. Restart the application.'],
  ['Ошибка индекса контейнеров:', 'Container index error:'],
  ['Не удалось удалить контейнер:', 'Could not delete the container:'],
  ['Не удалось восстановить контейнер:', 'Could not restore the container:'],
  ['Не удалось создать временную папку:', 'Could not create a temporary folder:'],
  ['Не удалось подготовить файл:', 'Could not prepare the file:'],
  ['Не удалось открыть файл:', 'Could not open the file:'],
  ['Ошибка локального хранилища:', 'Local storage error:'],
  ['Повторите через', 'Try again in'],
];
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  for (const [source, replacement] of errorPrefixes) {
    if (text.startsWith(source)) return `${replacement}${text.slice(source.length)}`;
  }
  return errorAliases[text] ?? text;
}
