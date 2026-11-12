import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  isSafeUiPath,
  UI_MANIFEST_FILE,
  UI_MANIFEST_SIGNATURE_FILE,
  UI_MIN_BRIDGE_VERSION,
  type UiManifest,
  type UiManifestFile,
} from '../countrylock/src/ui-manifest';
import { WEB_DIST_DIR } from './paths';

export interface BuildUiManifestOptions {
  /** Versi jembatan minimum yang dibutuhkan UI (bawaan `UI_MIN_BRIDGE_VERSION`). */
  minBridge: number;
  /** Epoch milidetik untuk `createdAt`. */
  now: number;
}

/** Semua berkas di bawah `directory` (rekursif) sebagai jalur relatif ber-`/`; symlink ditolak. */
function walk(root: string, directory: string, found: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    // `lstat`: symlink (ke dalam maupun ke luar dist) tak pernah diikuti, supaya manifest tak dapat
    // memuat berkas di luar `server/dist`.
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink tidak diizinkan di folder bundel UI: ${path.relative(root, full)}`);
    }
    if (stat.isDirectory()) {
      walk(root, full, found);
    } else if (stat.isFile()) {
      found.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
}

/** Membangun manifest dari isi `distDir`: semua berkas kecuali `ui-manifest.json`/`ui-manifest.sig` di akarnya. */
export function buildUiManifest(distDir: string, options: BuildUiManifestOptions): UiManifest {
  const root = path.resolve(distDir);
  const relatives: string[] = [];
  walk(root, root, relatives);
  const paths = relatives
    .filter((file) => file !== UI_MANIFEST_FILE && file !== UI_MANIFEST_SIGNATURE_FILE)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (paths.length === 0)
    throw new Error(`Tidak ada berkas di ${distDir}; jalankan build web dulu`);

  const files: UiManifestFile[] = paths.map((file) => {
    if (!isSafeUiPath(file)) throw new Error(`Nama berkas tidak aman untuk bundel UI: ${file}`);
    const bytes = readFileSync(path.join(root, ...file.split('/')));
    return {
      path: file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
    };
  });
  const uiVersion = createHash('sha256')
    .update(files.map((file) => `${file.path}\0${file.sha256}\n`).join(''))
    .digest('hex');
  return { uiVersion, minBridge: options.minBridge, files, createdAt: options.now };
}

/**
 * Menulis `ui-manifest.json` (bentuk kanonik `JSON.stringify(manifest)`: penanda tangan dan desktop menandatangani
 * dan memverifikasi byte persis ini) di akar `distDir`, dan MEMBUANG `ui-manifest.sig` lama (tanda tangan basi
 * tidak boleh tersisa untuk manifest baru).
 */
export function writeUiManifest(distDir: string, options: BuildUiManifestOptions): UiManifest {
  const manifest = buildUiManifest(distDir, options);
  writeFileSync(path.join(distDir, UI_MANIFEST_FILE), JSON.stringify(manifest), 'utf8');
  rmSync(path.join(distDir, UI_MANIFEST_SIGNATURE_FILE), { force: true });
  return manifest;
}

if (import.meta.main) {
  const distDir = process.argv[2] ?? WEB_DIST_DIR;
  try {
    const manifest = writeUiManifest(distDir, {
      minBridge: UI_MIN_BRIDGE_VERSION,
      now: Date.now(),
    });
    console.log(
      `ui-manifest OK (${manifest.files.length} berkas, uiVersion ${manifest.uiVersion.slice(0, 12)}, minBridge ${manifest.minBridge})`,
    );
  } catch (error) {
    console.error(`build-ui-manifest gagal: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
