// Logika murni `verify-pack.ts`: arsitektur hasil kemas yang diperiksa dan apakah host dapat menjalankannya.
// Dipisah agar dapat diuji (Vitest) tanpa membangun Electron.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseUiManifest, UI_MANIFEST_FILE } from '../../countrylock/src/ui-manifest';

export type PackArch = 'x64' | 'arm64';

const ARCHES: readonly string[] = ['x64', 'arm64'];

/** Membaca `--arch <x64|arm64>` atau `--arch=<...>`; tanpa argumen = `x64` (perilaku sebelum dukungan arm64). */
export function parseArch(argv: string[]): PackArch {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    let value: string | undefined;
    if (arg === '--arch') value = argv[i + 1];
    else if (arg.startsWith('--arch=')) value = arg.slice('--arch='.length);
    else continue;
    if (value === undefined || !ARCHES.includes(value)) {
      throw new Error(`--arch harus x64 atau arm64 (diterima: ${value ?? '(kosong)'})`);
    }
    return value as PackArch;
  }
  return 'x64';
}

/** Nama folder `electron-builder --dir` di `dist-app/` untuk Windows. */
export function unpackedDirName(arch: PackArch): string {
  return arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked';
}

/**
 * Hasil kemas x64 dapat dijalankan di host x64 maupun arm64 (emulasi Windows); hasil arm64 hanya di host arm64.
 * Yang tak dapat dijalankan hanya diperiksa statis (exe, app.asar, UI dasar ada).
 */
export function canRun(arch: PackArch, hostArch: string): boolean {
  return arch === 'x64' || hostArch === 'arm64';
}

/**
 * Masalah pada `ui-manifest.json` di folder UI dasar terkemas (`resources/ui-baseline`), atau `null` bila sah.
 * Desktop memakai `createdAt` manifest itu untuk aturan "UI dasar yang lebih baru menang" (`ui-bundle.ts`); tanpanya
 * aturan mati dan bundel server yang lebih lama tetap menang atas UI installer. Manifest ditulis `bun run build` akar
 * (`scripts/build-ui-manifest.ts`), bukan `build:web`.
 */
export function baselineManifestProblem(baselineDir: string): string | null {
  const file = join(baselineDir, UI_MANIFEST_FILE);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return `UI dasar tanpa ${UI_MANIFEST_FILE} (build installer harus lewat "bun run build", bukan "build:web" saja)`;
  }
  return parseUiManifest(text) === null ? `${UI_MANIFEST_FILE} UI dasar tidak valid` : null;
}
