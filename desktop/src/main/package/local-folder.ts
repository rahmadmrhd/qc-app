// Sumber paket dari folder lokal: `config.QC` + hanya skrip yang dirujuk entri `firmware`.
// `folder` dan `file` berasal dari berkas yang dapat diedit/diunduh pihak lain, jadi divalidasi
// SEBELUM menyentuh disk: bukan jalur (tanpa pemisah, tanpa `..`, tanpa jalur absolut/drive), dan
// jalur akhir (setelah menyelesaikan tautan simbolik) harus tetap di bawah `dir`.

import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { ConfigError, type CountryLockConfig, parseConfig } from '@countrylock/config';
import { scriptKey } from '@countrylock/inject-plan';

export interface LoadedPackage {
  dir: string;
  config: CountryLockConfig;
  scripts: Record<string, string>;
  /** Kunci skrip (`<folder>/<file>`) yang dirujuk config tetapi tidak dapat dimuat. */
  missing: string[];
  warnings: string[];
}

export type PackageErrorCode = 'NO_CONFIG' | 'BAD_CONFIG';

export class PackageError extends Error {
  readonly code: PackageErrorCode;
  constructor(code: PackageErrorCode, message: string) {
    super(message);
    this.name = 'PackageError';
    this.code = code;
  }
}

/** Satu komponen nama berkas/folder yang aman: bukan jalur, bukan `.`/`..`, tanpa karakter kontrol. */
export function isSafePathComponent(name: string): boolean {
  if (name === '' || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes(':')) return false; // drive (`C:`) dan alternate data stream NTFS
  for (let i = 0; i < name.length; i += 1) {
    if (name.charCodeAt(i) < 0x20) return false;
  }
  if (isAbsolute(name)) return false;
  // Windows menolak nama berakhir titik/spasi dengan perilaku ganjil; tolak sekalian.
  return !/[. ]$/.test(name);
}

function isInside(root: string, target: string): boolean {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return target.toLowerCase().startsWith(prefix.toLowerCase());
}

export async function loadLocalPackage(dir: string): Promise<LoadedPackage> {
  const root = resolve(dir);
  let configText: string;
  try {
    configText = await readFile(join(root, 'config.QC'), 'utf8');
  } catch {
    throw new PackageError('NO_CONFIG', 'config.QC tidak ditemukan di folder paket');
  }

  let parsed: ReturnType<typeof parseConfig>;
  try {
    parsed = parseConfig(configText);
  } catch (error) {
    // ConfigError hanya memuat nama kolom, tidak pernah nilainya.
    const detail = error instanceof ConfigError ? error.message : 'berkas tidak dapat dibaca';
    throw new PackageError('BAD_CONFIG', `config.QC tidak valid: ${detail}`);
  }
  const { config, warnings } = parsed;

  let realRoot = root;
  try {
    realRoot = await realpath(root);
  } catch {
    // Folder baru saja dibaca; bila realpath gagal, pakai jalur apa adanya.
  }

  const scripts: Record<string, string> = {};
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const brand of Object.values(config.brands)) {
    if (!brand) continue;
    for (const firmware of brand.firmware) {
      const key = scriptKey(brand, firmware.file);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isSafePathComponent(brand.folder) || !isSafePathComponent(firmware.file)) {
        missing.push(key);
        warnings.push(`Rujukan skrip "${key}" ditolak: folder/file harus nama biasa tanpa jalur`);
        continue;
      }
      const path = join(root, brand.folder, firmware.file);
      try {
        // Selesaikan tautan simbolik/junction: berkas nyata harus tetap di bawah folder paket.
        const real = await realpath(path);
        if (!isInside(realRoot, real)) {
          missing.push(key);
          warnings.push(`Rujukan skrip "${key}" ditolak: berkas berada di luar folder paket`);
          continue;
        }
        scripts[key] = await readFile(real, 'utf8');
      } catch {
        missing.push(key);
      }
    }
  }
  return { dir: root, config, scripts, missing, warnings };
}
