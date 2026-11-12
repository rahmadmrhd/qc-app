// Pengaturan lokal aplikasi (JSON). Tulis atomik: berkas sementara lalu rename, sehingga crash di
// tengah penulisan tidak meninggalkan berkas setengah jadi.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Settings {
  /** Folder paket Country Lock yang dipilih pengguna; null = belum dipilih. */
  packageDir: string | null;
}

const DEFAULTS: Settings = { packageDir: null };

function sanitize(value: unknown): Settings {
  const result: Settings = { ...DEFAULTS };
  if (typeof value === 'object' && value !== null) {
    const dir = (value as Record<string, unknown>).packageDir;
    if (typeof dir === 'string' && dir.length > 0 && dir.length <= 1024) result.packageDir = dir;
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
