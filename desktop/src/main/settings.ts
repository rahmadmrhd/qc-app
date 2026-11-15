// Pengaturan lokal aplikasi (JSON). Tulis atomik: berkas sementara lalu rename, sehingga crash di
// tengah penulisan tidak meninggalkan berkas setengah jadi.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_SERVER_URL = 'https://qc.rhd.my.id';

export interface Settings {
  /** Folder paket Country Lock yang dipilih pengguna; null = belum dipilih. */
  packageDir: string | null;
  /** Alamat server QC (hanya origin, tanpa garis miring akhir). */
  serverUrl: string;
}

const DEFAULTS: Settings = { packageDir: null, serverUrl: DEFAULT_SERVER_URL };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Alamat server yang sah: `https://` apa pun, atau `http://` hanya untuk localhost/127.0.0.1
 * (pengembangan); tanpa kredensial, jalur, query, atau fragmen. Mengembalikan origin, atau null.
 */
export function normalizeServerUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const secure = url.protocol === 'https:';
  const localHttp = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  if (!secure && !localHttp) return null;
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '')
    return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (url.hostname === '') return null;
  return url.origin;
}

function sanitize(value: unknown): Settings {
  const result: Settings = { ...DEFAULTS };
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const dir = record.packageDir;
    if (typeof dir === 'string' && dir.length > 0 && dir.length <= 1024) result.packageDir = dir;
    // Nilai tak sah = bawaan.
    result.serverUrl = normalizeServerUrl(record.serverUrl) ?? DEFAULT_SERVER_URL;
  }
  return result;
}

export function createSettingsStore(file: string): {
  get(): Settings;
  set(next: Partial<Settings>): void;
} {
  let current: Settings = { ...DEFAULTS };
  try {
    current = sanitize(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    // Berkas tak ada atau rusak: pakai nilai bawaan tanpa melempar.
  }
  return {
    get: () => ({ ...current }),
    set(next) {
      const merged = sanitize({ ...current, ...next });
      mkdirSync(dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
      renameSync(temp, file);
      current = merged;
    },
  };
}
