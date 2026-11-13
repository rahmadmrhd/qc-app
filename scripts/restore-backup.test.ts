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

describe('RESTORE_DATABASE_URL (N1)', () => {
  const SENTINEL = 'SANDI-CLI-SENTINEL-31c';
  const BASE_ENV = {
    PATH: process.env.PATH ?? '',
    DATABASE_URL: 'mysql://qc_app:rahasia-app@127.0.0.1:1/qc_app',
    SESSION_SECRET: 'rahasia-sesi-yang-cukup-panjang',
    OAUTH_CLIENT_ID: 'id',
    OAUTH_CLIENT_SECRET: 'rahasia',
    ADMIN_EMAIL: 'admin@example.com',
  };

  async function runWith(restoreUrl: string) {
    const proc = Bun.spawn(
      [
        process.execPath,
        SCRIPT,
        '--target',
        'qc_restore_check',
        '--folder-id',
        'folderFlag1234567',
      ],
      {
        env: { ...BASE_ENV, RESTORE_DATABASE_URL: restoreUrl },
        cwd: tmpdir(),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    return { stderr, code };
  }

  test('URL salah (bukan mysql://): galat menyebut RESTORE_DATABASE_URL, tanpa membocorkan sandi, sebelum koneksi apa pun', async () => {
    const result = await runWith(`postgres://qc_restore:${SENTINEL}@127.0.0.1:1/`);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('RESTORE_DATABASE_URL harus berbentuk');
    expect(result.stderr).not.toContain(SENTINEL);
    expect(result.stderr).not.toMatch(/(^|[^_])DATABASE_URL harus/);
  });

  test('bukan URL sama sekali: galat menyebut RESTORE_DATABASE_URL', async () => {
    const result = await runWith('bukan url');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('RESTORE_DATABASE_URL bukan URL yang valid');
  });

  test('M4: persen-enkode rusak di sandi: galat menyebut RESTORE_DATABASE_URL, tanpa sandi dan tanpa "URI error"', async () => {
    const result = await runWith(`mysql://qc_restore:${SENTINEL}%zz@127.0.0.1:1/`);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('RESTORE_DATABASE_URL berisi persen-enkode yang rusak');
    expect(result.stderr).not.toContain(SENTINEL);
    expect(result.stderr).not.toMatch(/URI error/i);
  });
});
