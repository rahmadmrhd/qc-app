import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Byte NUL mentah di berkas sumber membuat git menganggapnya biner (diff, blame, dan review hilang).
// Tulis escape `'\u0000'` di literal string, bukan byte-nya.

const ROOT = join(import.meta.dir, '..');
const TEXT_EXT = /\.(ts|tsx|css|json|md|sql|html)$/;

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (TEXT_EXT.test(entry)) found.push(path);
  }
  return found;
}

test('berkas sumber teks tidak memuat byte NUL mentah', () => {
  const offenders: string[] = [];
  for (const dir of ['web/src', 'server/src', 'shared', 'scripts']) {
    for (const file of walk(join(ROOT, dir))) {
      if (readFileSync(file).includes(0)) offenders.push(relative(ROOT, file));
    }
  }
  expect(offenders).toEqual([]);
});
