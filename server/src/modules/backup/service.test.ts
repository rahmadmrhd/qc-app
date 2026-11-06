import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { base64ToBytes } from '@server/core/bytes';
import type { Env } from '@server/core/env';
import { getSetting } from '@server/core/settings';
import { runPendingJobs } from '@server/jobs/runner';
import { JOB_MAX_ATTEMPTS, runJobStep } from '@server/modules/jobs/consumer';
import { findActiveJob, findJob } from '@server/modules/jobs/repo';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { backupName } from './names';
import { isBackupDue, SETTING_BACKUP_LAST_SUCCESS, scheduleBackupJob } from './service';
import { ensureBackupFolder, listAllEntries } from './upload';

const DAY = 24 * 60 * 60 * 1000;
/** 2026-01-15 10:00 WIB (bawaan jam uji 03:00Z). */
const NOW_WIB_10 = Date.parse('2026-01-15T03:00:00.000Z');
const SQL = `CREATE TABLE a (id int);\nINSERT INTO a VALUES (1);\n-- Dump completed on 2026-01-15\n`;

let env: TestEnv;
let dir: string;
let dumpCalls: string[];

async function makeEnv(overrides: Partial<Env> = {}): Promise<TestEnv> {
  return createTestEnv({
    BACKUP_ENABLED: true,
    BACKUP_LOCAL_DIR: dir,
    BACKUP_DUMP: async (outputPath) => {
      dumpCalls.push(outputPath);
      await writeFile(outputPath, gzipSync(SQL));
    },
    ...overrides,
  });
}

async function runBackup(): Promise<string> {
  const id = await scheduleBackupJob(env);
  if (id === null) throw new Error('job cadangan tidak dijadwalkan');
  await runPendingJobs(env);
  return id;
}

async function seedDriveBackup(name: string, content = 'x'): Promise<void> {
  const folderId = await ensureBackupFolder(env);
  await env.BRIDGE.uploadFile(
    folderId,
    name,
    'application/gzip',
    new TextEncoder().encode(content),
  );
}

const driveNames = async () =>
  (await listAllEntries(env, await ensureBackupFolder(env))).map((entry) => entry.name).sort();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qc-backup-svc-'));
  dumpCalls = [];
  env = await makeEnv();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('isBackupDue (fungsi murni)', () => {
  test('belum jatuh tempo sebelum 02:00 WIB; jatuh tempo sesudahnya bila belum berhasil hari ini', () => {
    const at = (iso: string) => Date.parse(iso);
    expect(isBackupDue(at('2026-01-14T18:59:00Z'), '20260114')).toBe(false); // 01:59 WIB
    expect(isBackupDue(at('2026-01-14T19:00:00Z'), '20260114')).toBe(true); // 02:00 WIB tgl 15
    expect(isBackupDue(at('2026-01-14T19:00:00Z'), '20260115')).toBe(false); // sudah berhasil hari ini
    expect(isBackupDue(at('2026-01-15T10:00:00Z'), '')).toBe(true); // mengejar ketinggalan
  });
});

describe('scheduleBackupJob', () => {
  test('tidak melakukan apa pun bila BACKUP_ENABLED tidak diset (dev dan tes)', async () => {
    const plain = await createTestEnv();
    expect(await scheduleBackupJob(plain)).toBeNull();
  });

  test('menyisipkan satu job db_backup saat jatuh tempo, tidak menumpuk selama masih aktif', async () => {
    const first = await scheduleBackupJob(env);
    const second = await scheduleBackupJob(env);
    expect(typeof first).toBe('string');
    expect(second).toBeNull();
    expect((await findActiveJob(env, 'db_backup'))?.id).toBe(first as string);
  });

  test('sebelum 02:00 WIB tidak dijadwalkan; sesudah cadangan hari ini berhasil, tidak lagi; hari berikutnya ya', async () => {
    env.clock.set(Date.parse('2026-01-14T18:00:00Z')); // 01:00 WIB tgl 15
    expect(await scheduleBackupJob(env)).toBeNull();
    env.clock.set(NOW_WIB_10);
    await runBackup();
    expect(await getSetting(env, SETTING_BACKUP_LAST_SUCCESS)).toBe('20260115');
    expect(await scheduleBackupJob(env)).toBeNull();
    env.clock.set(NOW_WIB_10 + DAY);
    expect(typeof (await scheduleBackupJob(env))).toBe('string');
  });
});

describe('job db_backup', () => {
  test('dump diunggah utuh (byte masuk = byte keluar), SHA-256 di appProperties, dump lokal tersimpan', async () => {
    const id = await runBackup();
    expect((await findJob(env, id))?.status).toBe('done');
    const name = backupName(NOW_WIB_10);
    const local = await readFile(join(dir, name));
    const entries = await listAllEntries(env, await ensureBackupFolder(env));
    expect(entries.map((entry) => entry.name)).toEqual([name]);
    const driveFile = [...env.BRIDGE.state.files.values()].find((file) => file.name === name);
    expect(Buffer.compare(Buffer.from(base64ToBytes(driveFile?.base64 ?? '')), local)).toBe(0);
    expect(entries[0]?.md5Checksum).toBe(createHash('md5').update(local).digest('hex'));
    expect(entries[0]?.appProperties.sha256).toBe(createHash('sha256').update(local).digest('hex'));
    expect(dumpCalls).toEqual([join(dir, name)]);
  });

  test('folder cadangan dibuat di bawah folder induk bila BACKUP_FOLDER_ID kosong dan dicatat di settings', async () => {
    await runBackup();
    expect(await getSetting(env, 'BACKUP_FOLDER_ID')).not.toBe('');
  });

  test('MD5 Drive beda dengan lokal -> job gagal dan berkas Drive yang cacat dibuang; hari itu belum dianggap berhasil', async () => {
    const real = env.BRIDGE.uploadFile.bind(env.BRIDGE);
    env.BRIDGE.uploadFile = async (...args) => ({
      ...(await real(...args)),
      md5Checksum: '0'.repeat(32),
    });
    const id = await runBackup();
    const job = await findJob(env, id);
    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('Checksum');
    expect(await driveNames()).toEqual([]);
    expect(await getSetting(env, SETTING_BACKUP_LAST_SUCCESS)).toBe('');
  });

  test('unggahan gagal -> dump lokal tetap ada, job failed; detak berikutnya menjadwalkan ulang dan berhasil', async () => {
    env.BRIDGE.failNext('uploadFile', new Error('jaringan putus'));
    const id = (await scheduleBackupJob(env)) as string;
    // Langkah 0 (dump) dan 1 (unggah gagal sementara); percobaan terakhir menandai job gagal.
    expect((await runJobStep(env, id, 1)).kind).toBe('advanced');
    expect((await runJobStep(env, id, JOB_MAX_ATTEMPTS)).kind).toBe('failed');
    expect((await findJob(env, id))?.status).toBe('failed');
    const name = backupName(NOW_WIB_10);
    expect((await stat(join(dir, name))).isFile()).toBe(true);
    expect(await driveNames()).toEqual([]);

    env.clock.advance(60 * 60 * 1000);
    await runBackup();
    expect(await driveNames()).toEqual([backupName(NOW_WIB_10 + 60 * 60 * 1000)]);
  });

  test('pengulangan setelah gagal di tengah memakai ulang berkas yang sudah di Drive (tanpa duplikat)', async () => {
    const id = (await scheduleBackupJob(env)) as string;
    expect((await runJobStep(env, id, 1)).kind).toBe('advanced'); // dump
    // Unggahan sebelumnya selesai di Drive tetapi job mati sebelum mencatatnya.
    const name = backupName(NOW_WIB_10);
    const local = await readFile(join(dir, name));
    await env.BRIDGE.uploadFile(await ensureBackupFolder(env), name, 'application/gzip', local);
    await runPendingJobs(env);
    expect((await findJob(env, id))?.status).toBe('done');
    expect(await driveNames()).toEqual([name]);
    expect(env.BRIDGE.calls.filter((call) => call.action === 'uploadFile')).toHaveLength(1);
  });

  test('sisa unggahan bernama sama tetapi isi berbeda dibuang sebelum mengunggah ulang', async () => {
    const name = backupName(NOW_WIB_10);
    await seedDriveBackup(name, 'rusak-separuh');
    await runBackup();
    expect(await driveNames()).toEqual([name]);
    const entries = await listAllEntries(env, await ensureBackupFolder(env));
    expect(entries[0]?.size).toBeGreaterThan(20); // isi dump gzip nyata, bukan sisa
  });

  test('dump gagal -> job gagal setelah percobaan ulang, tidak ada yang diunggah', async () => {
    env = await makeEnv({
      BACKUP_DUMP: async () => {
        throw new Error('mariadb-dump gagal (kode keluar 2)');
      },
    });
    const id = (await scheduleBackupJob(env)) as string;
    expect((await runJobStep(env, id, JOB_MAX_ATTEMPTS)).kind).toBe('failed');
    expect(await driveNames()).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  test('dump kejar-ketinggalan lewat tengah malam: tanggal sukses = tanggal NAMA berkas, jadi cadangan 02:00 berikutnya tetap jalan', async () => {
    const late = Date.parse('2026-01-15T16:50:00Z'); // 23:50 WIB tgl 15
    env.clock.set(late);
    const base = env.BRIDGE;
    env = await makeEnv({
      BRIDGE: base,
      BACKUP_DUMP: async (outputPath) => {
        await writeFile(outputPath, gzipSync(SQL));
        env.clock.advance(20 * 60 * 1000); // unggah selesai 00:10 WIB tgl 16
      },
    });
    env.clock.set(late);
    await runBackup();
    expect(await getSetting(env, SETTING_BACKUP_LAST_SUCCESS)).toBe('20260115');
    env.clock.set(Date.parse('2026-01-15T19:00:00Z')); // 02:00 WIB tgl 16
    expect(typeof (await scheduleBackupJob(env))).toBe('string');
  });

  test('retensi: 30 berkas harian + berkas tak dikenal -> tersisa 7 harian + 4 mingguan (+ yang baru), tak dikenal utuh', async () => {
    for (let index = 29; index >= 1; index--) {
      await seedDriveBackup(backupName(NOW_WIB_10 - index * DAY));
    }
    await seedDriveBackup('catatan.txt');
    await runBackup();
    const names = await driveNames();
    expect(names).toContain('catatan.txt');
    expect(names).toContain(backupName(NOW_WIB_10));
    expect(names.filter((name) => name.startsWith('qc-backup-'))).toHaveLength(11);
    expect(
      JSON.parse((await findJob(env, (await findLastJobId()) as string))?.result ?? '{}').deleted,
    ).toBe(19);
  });

  test('retensi: hanya 3 berkas -> tidak ada yang dihapus', async () => {
    await seedDriveBackup(backupName(NOW_WIB_10 - 2 * DAY));
    await seedDriveBackup(backupName(NOW_WIB_10 - DAY));
    await runBackup();
    expect(await driveNames()).toHaveLength(3);
  });

  test('retensi berhalaman: lebih dari satu halaman daftar tetap diproses', async () => {
    const folderId = await ensureBackupFolder(env); // sekali: tiap pemanggilan ensure = kueri DB lewat tunnel
    const bytes = new TextEncoder().encode('x');
    for (let index = 0; index < 205; index++) {
      await env.BRIDGE.uploadFile(
        folderId,
        backupName(NOW_WIB_10 - (index + 1) * DAY),
        'application/gzip',
        bytes,
      );
    }
    await runBackup();
    expect((await driveNames()).filter((name) => name.startsWith('qc-backup-'))).toHaveLength(11);
  });

  test('di VPS hanya 3 salinan dump terakhir', async () => {
    for (const index of [4, 3, 2, 1]) {
      await writeFile(join(dir, backupName(NOW_WIB_10 - index * DAY)), 'lama');
    }
    await writeFile(join(dir, 'catatan.txt'), 'x');
    await runBackup();
    expect((await readdir(dir)).sort()).toEqual(
      [
        'catatan.txt',
        backupName(NOW_WIB_10 - 2 * DAY),
        backupName(NOW_WIB_10 - DAY),
        backupName(NOW_WIB_10),
      ].sort(),
    );
  });

  test('kegagalan retensi tidak menggagalkan cadangan yang sudah terunggah dan terverifikasi', async () => {
    await seedDriveBackup(backupName(NOW_WIB_10 - 20 * DAY));
    env.BRIDGE.failNext('deleteFile', new Error('403 tak boleh menghapus'));
    for (let index = 19; index >= 1; index--) {
      await seedDriveBackup(backupName(NOW_WIB_10 - index * DAY));
    }
    const id = await runBackup();
    const job = await findJob(env, id);
    expect(job?.status).toBe('done');
    expect(await getSetting(env, SETTING_BACKUP_LAST_SUCCESS)).toBe('20260115');
  });
});

async function findLastJobId(): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT id FROM jobs WHERE kind = 'db_backup' ORDER BY created_at DESC LIMIT 1",
  ).first<{ id: string }>();
  return row?.id ?? null;
}
