import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');
const builder = read('electron-builder.yml');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

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
