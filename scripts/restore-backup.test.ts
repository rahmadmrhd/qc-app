import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'restore-backup.ts');

async function run(args: string[]) {
  const proc = Bun.spawn([process.execPath, SCRIPT, ...args], {
    env: { PATH: process.env.PATH ?? '' },
    cwd: tmpdir(), // tanpa berkas .env (Bun memuat .env dari cwd)
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { stderr, code };
}

describe('scripts/restore-backup.ts (CLI)', () => {
  test('tanpa --target: cetak petunjuk dan keluar 2 (tidak menyentuh konfigurasi/Google/DB)', async () => {
    const result = await run([]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--target');
  });

  test('argumen asing: keluar 2', async () => {
    expect((await run(['--target', 'x', '--aneh'])).code).toBe(2);
  });

  test('konfigurasi tak lengkap: gagal (kode 1) dengan pesan tanpa rahasia, tanpa menyentuh jaringan', async () => {
    const result = await run(['--target', 'qc_restore_check']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Konfigurasi tidak valid');
  });
});
