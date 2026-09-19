export type Mode = 'fast' | 'balanced' | 'strong' | 'maximum';
export type Theme = 'forest' | 'midnight' | 'graphite' | 'ocean' | 'violet' | 'rose';
export interface ContainerSummary { id: string; name: string }
export interface Settings {
  mode: Mode;
  chunkKib: number;
  autoLockSecs: number;
  lockOnHide: boolean;
  equalHoldEnabled: boolean;
  recoveryQuestion: string | null;
  theme: Theme;
  maskFileNames: boolean;
  accentColor: string;
  secureDelete: boolean;
}
export interface VaultFile { id: string; name: string; size: number; addedAt: number }
export interface Snapshot { files: VaultFile[]; settings: Settings }
export interface Login { token: string; snapshot: Snapshot }
export interface VaultStatus { containers: ContainerSummary[] }
export const defaultSettings: Settings = { mode: 'balanced', chunkKib: 512, autoLockSecs: 300, lockOnHide: true, equalHoldEnabled: true, recoveryQuestion: null, theme: 'forest', maskFileNames: false, accentColor: '#9be8c4', secureDelete: true };
export const modes: { id: Mode; name: string; memory: string; iterations: number; description: string }[] = [
  { id: 'fast', name: 'Fast', memory: '16 МиБ', iterations: 2, description: 'Для слабых устройств' },
  { id: 'balanced', name: 'Balanced', memory: '32 МиБ', iterations: 3, description: 'На каждый день' },
  { id: 'strong', name: 'Strong', memory: '64 МиБ', iterations: 3, description: 'Больше затрат на перебор' },
  { id: 'maximum', name: 'Maximum', memory: '128 МиБ', iterations: 4, description: 'Для мощных устройств' },
];
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КиБ`;
  return `${(bytes / 1024 ** 2).toFixed(1)} МиБ`;
}
export type Category = 'all' | 'image' | 'document' | 'archive' | 'other';
export function category(name: string): Category {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg', 'bmp', 'avif'].includes(extension)) return 'image';
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'xls', 'xlsx', 'pptx', 'csv', 'odt', 'rtf'].includes(extension)) return 'document';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'xz'].includes(extension)) return 'archive';
  return 'other';
}
