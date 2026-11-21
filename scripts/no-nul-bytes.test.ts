import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

// Byte NUL mentah di berkas sumber membuat git menganggapnya biner (diff, blame, dan review hilang).
// Tulis escape `'\u0000'` di literal string, bukan byte-nya. Berlaku untuk SEMUA berkas teks yang dilacak git;
// berkas biner sah dikecualikan menurut ekstensi.

const ROOT = join(import.meta.dir, '..');
const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.icns',
  '.bmp',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.wasm',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.7z',
  '.mp3',
  '.mp4',
  '.webm',
  '.mov',
  '.wav',
  '.ogg',
  '.exe',
  '.dll',
  '.node',
  '.db',
  '.sqlite',
  '.pem',
  '.der',
  '.keystore',
  '.bin',
  '.dat',
  '.lock',
  '.lockb',
  '.sig',
]);

test('berkas teks yang dilacak git tidak memuat byte NUL mentah', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\u0000')
    .filter(Boolean);
  const offenders: string[] = [];
  for (const file of files) {
    if (BINARY_EXT.has(extname(file).toLowerCase())) continue;
    let data: Buffer;
    try {
      data = readFileSync(join(ROOT, file));
    } catch {
      continue; // dihapus di working tree
    }
    if (data.includes(0)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});
