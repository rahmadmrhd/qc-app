// Logika murni `verify-pack.ts`: arsitektur hasil kemas yang diperiksa dan apakah host dapat menjalankannya.
// Dipisah agar dapat diuji (Vitest) tanpa membangun Electron.

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
