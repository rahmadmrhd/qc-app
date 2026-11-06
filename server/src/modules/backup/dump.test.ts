import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  type DumpProcess,
  dumpArgs,
  ensureLocalDir,
  fileDigest,
  parseDatabaseUrl,
  parseMysqlUrl,
  pruneLocalDumps,
  runDump,
  type SpawnFn,
} from './dump';

const SENTINEL = 'SANDI-RAHASIA-SENTINEL-9f3';
const TARGET = parseDatabaseUrl(`mysql://qc_user:${SENTINEL}@qc-db:3307/qc_dev`);
const TRAILER = '-- Dump completed on 2026-01-15  2:00:01\n';
const encoder = new TextEncoder();

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function fakeSpawn(options: {
  stdout: string[];
  stderr?: string;
  exit?: number;
  seen?: { command: string[]; env: Record<string, string> }[];
}): SpawnFn {
  return (command, env): DumpProcess => {
    options.seen?.push({ command, env });
    return {
      stdout: streamOf(...options.stdout),
      stderr: streamOf(options.stderr ?? ''),
      exited: Promise.resolve(options.exit ?? 0),
    };
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qc-dump-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseDatabaseUrl dan dumpArgs', () => {
  test('mengurai mysql:// dengan kredensial ter-encode', () => {
    const target = parseDatabaseUrl('mysql://us%40er:p%3Aw%2Fd@db.example:3310/qc_dev');
    expect(target).toEqual({
      host: 'db.example',
      port: 3310,
      user: 'us@er',
      password: 'p:w/d',
      database: 'qc_dev',
    });
  });

  test('port bawaan 3306; URL bukan mysql:// atau tanpa skema ditolak tanpa membocorkan URL', () => {
    expect(parseDatabaseUrl('mysql://u:p@h/qc').port).toBe(3306);
    expect(() => parseDatabaseUrl(`postgres://u:${SENTINEL}@h/qc`)).toThrow();
    expect(() => parseDatabaseUrl(`mysql://u:${SENTINEL}@h`)).toThrow();
    for (const bad of [`postgres://u:${SENTINEL}@h/qc`, `mysql://u:${SENTINEL}@h`]) {
      try {
        parseDatabaseUrl(bad);
      } catch (error) {
        expect(String(error)).not.toContain(SENTINEL);
      }
    }
  });

  test('argumen: opsi yang dibutuhkan, nama basis data POSISIONAL (tanpa --databases/-B), kata sandi TIDAK ada di argumen', () => {
    const args = dumpArgs(TARGET);
    expect(args).toContain('--single-transaction');
    expect(args).toContain('--routines');
    expect(args).toContain('--host=qc-db');
    expect(args).toContain('--port=3307');
    expect(args).toContain('--user=qc_user');
    expect(args.some((arg) => arg.startsWith('--max-allowed-packet='))).toBe(true);
    expect(args.at(-1)).toBe('qc_dev');
    expect(args).not.toContain('--databases');
    expect(args).not.toContain('-B');
    expect(args).not.toContain('--skip-comments'); // baris penutup "Dump completed" harus ada
    expect(args.join(' ')).not.toContain(SENTINEL);
    expect(args.some((arg) => arg.includes('password') || arg.startsWith('-p'))).toBe(false);
  });
});

describe('runDump', () => {
  test('menulis gzip dari keluaran dump lewat berkas .partial lalu mengganti nama; kata sandi lewat env MYSQL_PWD', async () => {
    const seen: { command: string[]; env: Record<string, string> }[] = [];
    const out = join(dir, 'qc-backup-20260115-0200.sql.gz');
    const sql = `CREATE TABLE a (id int);\nINSERT INTO a VALUES (1);\n${TRAILER}`;
    await runDump(TARGET, out, {
      spawn: fakeSpawn({ stdout: [sql.slice(0, 20), sql.slice(20)], seen }),
    });
    expect(gunzipSync(await readFile(out)).toString('utf8')).toBe(sql);
    expect(await readdir(dir)).toEqual(['qc-backup-20260115-0200.sql.gz']); // tanpa .partial
    expect(seen[0]?.command[0]).toMatch(/mariadb-dump/);
    expect(seen[0]?.command.join(' ')).not.toContain(SENTINEL);
    expect(seen[0]?.env).toEqual({ MYSQL_PWD: SENTINEL });
  });

  test.skipIf(process.platform === 'win32')('dump ditulis dengan mode 0600', async () => {
    const out = join(dir, 'qc-backup-20260115-0200.sql.gz');
    await runDump(TARGET, out, {
      spawn: fakeSpawn({
        stdout: [
          `x
${TRAILER}`,
        ],
      }),
    });
    expect((await stat(out)).mode & 0o777).toBe(0o600);
  });

  test.skipIf(process.platform === 'win32')('ensureLocalDir membuat folder 0700', async () => {
    const sub = join(dir, 'cadangan');
    await ensureLocalDir(sub);
    expect((await stat(sub)).mode & 0o777).toBe(0o700);
  });

  test('kode keluar bukan 0 -> gagal, tidak ada berkas jadi maupun .partial, stderr dibersihkan dari kata sandi', async () => {
    const out = join(dir, 'qc-backup-20260115-0200.sql.gz');
    const promise = runDump(TARGET, out, {
      spawn: fakeSpawn({
        stdout: [`CREATE TABLE a (id int);\n${TRAILER}`],
        stderr: `mariadb-dump: Got error: 1045: Access denied for user (using password: YES) ${SENTINEL}`,
        exit: 2,
      }),
    });
    await expect(promise).rejects.toThrow(/kode keluar 2/);
    await promise.catch((error) => expect(String(error)).not.toContain(SENTINEL));
    expect(await readdir(dir)).toEqual([]);
  });

  test('keluaran terpotong (tanpa baris "Dump completed") walau kode keluar 0 -> ditolak', async () => {
    const out = join(dir, 'qc-backup-20260115-0200.sql.gz');
    await expect(
      runDump(TARGET, out, {
        spawn: fakeSpawn({ stdout: ['CREATE TABLE a (id int);\nINSERT INTO a VAL'] }),
      }),
    ).rejects.toThrow(/tidak lengkap/);
    expect(await readdir(dir)).toEqual([]);
  });

  test('penutup tidak terhitung bila hanya ada di tengah keluaran (hanya ekor yang diperiksa)', async () => {
    const out = join(dir, 'qc-backup-20260115-0200.sql.gz');
    const filler = 'x'.repeat(5000);
    await expect(
      runDump(TARGET, out, { spawn: fakeSpawn({ stdout: [TRAILER, filler] }) }),
    ).rejects.toThrow(/tidak lengkap/);
  });

  test('berkas .partial sisa dari proses yang mati ditimpa dan tidak dianggap cadangan', async () => {
    const out = join(dir, 'qc-backup-20260115-0200.sql.gz');
    await writeFile(`${out}.partial`, 'sisa');
    await runDump(TARGET, out, { spawn: fakeSpawn({ stdout: [`x\n${TRAILER}`] }) });
    expect(await readdir(dir)).toEqual(['qc-backup-20260115-0200.sql.gz']);
  });
});

describe('fileDigest dan pruneLocalDumps', () => {
  test('fileDigest: md5, sha256, ukuran (streaming)', async () => {
    const path = join(dir, 'a.bin');
    await writeFile(path, 'halo');
    const digest = await fileDigest(path);
    expect(digest.size).toBe(4);
    expect(digest.md5).toBe(new Bun.CryptoHasher('md5').update('halo').digest('hex'));
    expect(digest.sha256).toBe(new Bun.CryptoHasher('sha256').update('halo').digest('hex'));
  });

  test('pruneLocalDumps menyisakan 3 salinan terbaru menurut nama, membuang .partial, menyentuh hanya nama cadangan', async () => {
    const names = [
      'qc-backup-20260110-0200.sql.gz',
      'qc-backup-20260111-0200.sql.gz',
      'qc-backup-20260112-0200.sql.gz',
      'qc-backup-20260113-0200.sql.gz',
      'qc-backup-20260114-0200.sql.gz',
    ];
    for (const name of names) await writeFile(join(dir, name), 'x');
    await writeFile(join(dir, 'qc-backup-20260115-0200.sql.gz.partial'), 'x');
    await writeFile(join(dir, 'catatan.txt'), 'x');
    const removed = await pruneLocalDumps(dir, 3);
    expect(removed.sort()).toEqual([
      'qc-backup-20260110-0200.sql.gz',
      'qc-backup-20260111-0200.sql.gz',
      'qc-backup-20260115-0200.sql.gz.partial',
    ]);
    expect((await readdir(dir)).sort()).toEqual([
      'catatan.txt',
      'qc-backup-20260112-0200.sql.gz',
      'qc-backup-20260113-0200.sql.gz',
      'qc-backup-20260114-0200.sql.gz',
    ]);
    expect((await stat(join(dir, 'catatan.txt'))).isFile()).toBe(true);
  });

  test('pruneLocalDumps pada folder yang belum ada -> tidak melempar', async () => {
    expect(await pruneLocalDumps(join(dir, 'tidak-ada'), 3)).toEqual([]);
  });
});

describe('parseMysqlUrl (URL pemulihan tingkat server, N1)', () => {
  test('tanpa nama basis data diterima bila requireDatabase=false: host/port/pengguna/sandi saja', () => {
    for (const url of [
      'mysql://qc_restore:rahasia@qc-db:3306/',
      'mysql://qc_restore:rahasia@qc-db:3306',
    ]) {
      expect(parseMysqlUrl(url, { name: 'RESTORE_DATABASE_URL', requireDatabase: false })).toEqual({
        host: 'qc-db',
        port: 3306,
        user: 'qc_restore',
        password: 'rahasia',
        database: '',
      });
    }
  });

  test('dengan nama basis data tetap diterima; tanpa sandi diterima (sandi kosong)', () => {
    expect(parseMysqlUrl('mysql://u@h:3307/x', { requireDatabase: false })).toMatchObject({
      user: 'u',
      password: '',
      database: 'x',
      port: 3307,
    });
  });

  test('bawaan (DATABASE_URL) tetap mewajibkan nama basis data', () => {
    expect(() => parseDatabaseUrl('mysql://u:p@h:3306/')).toThrow(/DATABASE_URL harus berbentuk/);
  });

  test('skema salah/bukan URL ditolak dengan pesan yang menyebut variabel yang benar dan tanpa membocorkan URL', () => {
    for (const bad of [`postgres://u:${SENTINEL}@h/`, 'bukan url', `mysql://u:${SENTINEL}@/x`]) {
      let message = '';
      try {
        parseMysqlUrl(bad, { name: 'RESTORE_DATABASE_URL', requireDatabase: false });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, bad).toContain('RESTORE_DATABASE_URL');
      expect(message).not.toContain(SENTINEL);
      expect(message).not.toMatch(/(^|[^_])DATABASE_URL/);
    }
  });

  test('M4: persen-enkode rusak di sandi/pengguna/jalur memberi pesan bernama variabel yang benar, tanpa URL/sandi dan bukan "URI error"', () => {
    const bads = [
      `mysql://u:${SENTINEL}%zz@h:3306/`,
      `mysql://u%:${SENTINEL}@h:3306/`,
      `mysql://u:${SENTINEL}@h:3306/%E0%A4%A`,
    ];
    for (const bad of bads) {
      for (const name of ['RESTORE_DATABASE_URL', 'DATABASE_URL']) {
        let message = '';
        try {
          parseMysqlUrl(bad, { name, requireDatabase: false });
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message, `${name} ${bad}`).toContain(
          name === 'DATABASE_URL' ? 'DATABASE_URL' : 'RESTORE_DATABASE_URL',
        );
        expect(message).toContain('persen-enkode');
        expect(message).not.toMatch(/URI/i);
        expect(message).not.toContain(SENTINEL);
        expect(message).not.toContain('%zz');
        if (name === 'RESTORE_DATABASE_URL') expect(message).not.toMatch(/(^|[^_])DATABASE_URL/);
      }
    }
  });
});
