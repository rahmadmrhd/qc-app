import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');
const builder = read('electron-builder.yml');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
const rootPkg = JSON.parse(read('../package.json')) as { scripts: Record<string, string> };
const verifyPack = read('scripts/verify-pack.ts');

describe('pengemasan installer (rencana bagian 4, Task 7)', () => {
  test('target NSIS untuk x64 dan arm64', () => {
    expect(builder).toMatch(/target: nsis\s+arch:\s+- x64\s+- arm64/);
  });

  test('nama installer tetap: QC-App-Setup-<versi>-<arch>.<ext> (dipakai manifest rilis)', () => {
    expect(builder).toContain('artifactName: QC-App-Setup-${version}-${arch}.${ext}');
  });

  test('tanpa publish: electron-builder tak membuat app-update.yml bawaan dan tak mengunggah (kita menulisnya sendiri)', () => {
    expect(builder).toMatch(/^publish: null$/m);
  });

  test('pack lokal tetap x64 saja; pack:all dan dist membangun kedua arsitektur', () => {
    expect(pkg.scripts.pack).toContain('--x64');
    expect(pkg.scripts.pack).not.toContain('arm64');
    expect(pkg.scripts['pack:all']).toContain('--x64 --arm64');
    // `dist` memakai arch dari konfigurasi (x64 + arm64) dan tak boleh mengunggah apa pun.
    expect(pkg.scripts.dist).toContain('--publish never');
  });
});

describe('UI dasar installer membawa ui-manifest.json (aturan "UI dasar yang lebih baru menang", 2026-11-20)', () => {
  test('build:desktop membangun lewat `build` akar (yang menulis ui-manifest.json), bukan build:web saja', () => {
    const script = rootPkg.scripts['build:desktop'] ?? '';
    expect(script).toMatch(/^bun run build && /);
    expect(script).not.toContain('build:web');
    expect(rootPkg.scripts.build).toContain('scripts/build-ui-manifest.ts');
  });

  test('verify-pack memeriksa manifest UI dasar di jalur statis (x64 dan arm64) maupun penuh', () => {
    expect(verifyPack).toContain('baselineManifestProblem');
    // Pemeriksaan statis (host tak dapat menjalankan exe) harus lebih dulu dari `process.exit(0)` jalur itu.
    const staticBranch = verifyPack.slice(
      verifyPack.indexOf('if (!canRun('),
      verifyPack.indexOf('process.exit(0)'),
    );
    expect(staticBranch).toContain('baselineManifestProblem');
  });
});
