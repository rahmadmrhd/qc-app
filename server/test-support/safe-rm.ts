import { existsSync, realpathSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Hapus folder sementara milik tes dengan aman. `rm('', { recursive: true })` menghapus FOLDER KERJA (mis. `server/`),
 * jadi helper ini menolak (melempar galat tanpa menghapus apa pun) jalur yang kosong, bukan string, tidak absolut,
 * atau tidak berada DI DALAM `os.tmpdir()` (tmpdir itu sendiri juga ditolak). Jalur yang tak ada = tidak melakukan apa-apa.
 * Tes WAJIB memakai ini, bukan `rm`/`rmSync` rekursif langsung (dijaga `scripts/no-raw-recursive-rm.test.ts`).
 */
function canonical(path: string): string {
  // realpath dari leluhur terdekat yang ada + sisa jalur (jalur belum ada tetap dibandingkan dalam bentuk yang sama dengan tmpdir, mis. nama pendek 8.3 di Windows).
  let head = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync.native(head), ...tail.reverse());
    } catch {
      const parent = dirname(head);
      if (parent === head) return resolve(path);
      tail.push(basename(head));
      head = parent;
    }
  }
}

function normalize(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function assertSafeTempDir(path: unknown): string {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new Error('removeTempDir: jalur kosong atau bukan string ditolak');
  }
  if (!isAbsolute(path)) throw new Error(`removeTempDir: jalur tidak absolut ditolak: ${path}`);
  const target = normalize(canonical(path));
  const base = normalize(canonical(tmpdir()));
  const rel = relative(base, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`removeTempDir: jalur di luar folder sementara ditolak: ${path}`);
  }
  return resolve(path);
}

export async function removeTempDir(path: string): Promise<void> {
  const safe = assertSafeTempDir(path);
  if (!existsSync(safe)) return;
  await rm(safe, { recursive: true, force: true });
}

export function removeTempDirSync(path: string): void {
  const safe = assertSafeTempDir(path);
  if (!existsSync(safe)) return;
  rmSync(safe, { recursive: true, force: true });
}
