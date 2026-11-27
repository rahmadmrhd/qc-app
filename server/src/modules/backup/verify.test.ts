import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createDb, type Db } from '@server/core/db';
import type { Env } from '@server/core/env';
import { getSetting } from '@server/core/settings';
import { runPendingJobs } from '@server/jobs/runner';
import { findActiveJob } from '@server/modules/jobs/repo';
import { testDbUrl } from '@server-test/db-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { removeTempDir } from '../../../test-support/safe-rm';
import { backupName } from './names';
import { SETTING_BACKUP_LAST_SUCCESS } from './service';
import { ensureBackupFolder } from './upload';
import {
  newestLocalBackup,
  runBackupVerification,
  sweepOrphanVerifySchemas,
  VERIFY_WORK_DIR,
  type VerifyPorts,
} from './verify';
import { scheduleBackupVerifyJob } from './verify-schedule';
import {
  isVerifyDue,
  readVerifyResult,
  SETTING_BACKUP_LAST_SUCCESS_NAME,
  VERIFY_MAX_ATTEMPTS,
  VERIFY_RETRY_AFTER_MS,
} from './verify-state';

/** Awalan skema sementara tes: pengguna tes hanya berhak atas `qc_test_%`. */
const PREFIX = 'qc_test_vfy_';
const MINUTE = 60 * 1000;

let admin: Db;
let env: TestEnv;
let dir: string;
let baseDump: string;
let importCalls: number;
let afterImport: ((target: Db) => Promise<void>) | undefined;
let importError: Error | undefined;

/** Dump sah dari struktur skema tes saat ini (SHOW CREATE TABLE per tabel), tanpa baris. */
async function buildBaseDump(source: Db): Promise<string> {
  const tables = (
    await source
      .prepare(
        "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
      )
      .all<{ t: string }>()
  ).results.map((row) => row.t);
  const parts = ['SET FOREIGN_KEY_CHECKS=0;'];
  for (const table of tables) {
    const row = await source
      .prepare(`SHOW CREATE TABLE \`${table}\``)
      .first<Record<string, string>>();
    parts.push(`${row?.['Create Table'] ?? ''};`);
  }
  return parts.join('\n');
}

const dumpOf = (...rows: string[]) =>
  `${baseDump}\n${rows.join('\n')}\n-- Dump completed on 2026-01-15\n`;
const ROWS = "INSERT INTO `settings` VALUES ('k1','v1'),('k2','a),(''b'')');";

function ports(overrides: Partial<VerifyPorts> = {}): VerifyPorts {
  return {
    db: admin,
    schemaPrefix: PREFIX,
    close: async () => {},
    importSql: async (sqlPath, schema) => {
      importCalls += 1;
      if (importError !== undefined) throw importError;
      const target = createDb({ url: testDbUrl(), database: schema, connectionLimit: 1 });
      try {
        await target.exec(await Bun.file(sqlPath).text());
        await afterImport?.(target);
      } finally {
        await target.close();
      }
    },
    ...overrides,
  };
}

/** Menaruh cadangan di folder lokal; `drive` memilih salinan Drive: sama, berbeda isi, atau tak ada. */
async function placeBackup(
  sql: string,
  drive: 'same' | 'different' | 'none' = 'same',
  name = backupName(env.clock.now()),
): Promise<string> {
  const bytes = gzipSync(sql);
  await writeFile(join(dir, name), bytes);
  if (drive !== 'none') {
    const driveBytes = drive === 'same' ? bytes : gzipSync(`${sql}\n-- beda`);
    await env.BRIDGE.uploadFile(
      await ensureBackupFolder(env),
      name,
      'application/gzip',
      driveBytes,
      {
        appProperties: { sha256: createHash('sha256').update(driveBytes).digest('hex'), app: 'qc' },
      },
    );
  }
  return name;
}

async function scratchSchemas(): Promise<string[]> {
  const rows = await admin
    .prepare('SELECT SCHEMA_NAME AS s FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?')
    .bind('qc\\_test\\_vfy\\_%')
    .all<{ s: string }>();
  return rows.results.map((row) => row.s);
}

const run = (name?: string) =>
  runBackupVerification(env, ports(), { localDir: dir, ...(name === undefined ? {} : { name }) });

beforeAll(async () => {
  admin = createDb({ url: testDbUrl(), connectionLimit: 2 });
  env = await makeEnv();
  baseDump = await buildBaseDump(env.DB);
}, 120_000);

afterAll(async () => {
  for (const schema of await scratchSchemas())
    await admin.exec(`DROP DATABASE IF EXISTS \`${schema}\``);
  await admin.close();
});

async function makeEnv(overrides: Partial<Env> = {}): Promise<TestEnv> {
  return createTestEnv({ BACKUP_ENABLED: true, BACKUP_LOCAL_DIR: dir, ...overrides });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qc-verify-'));
  importCalls = 0;
  afterImport = undefined;
  importError = undefined;
  env = await makeEnv();
  spyOn(console, 'error').mockImplementation(() => {});
  spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  spyOn(console, 'error').mockRestore();
  spyOn(console, 'log').mockRestore();
  for (const schema of await scratchSchemas())
    await admin.exec(`DROP DATABASE IF EXISTS \`${schema}\``);
  await removeTempDir(dir);
});

describe('runBackupVerification: jalur sukses', () => {
  test('cadangan sah: tabel dan jumlah baris hasil impor sama persis dengan isi dump, skema sementara dibuang', async () => {
    await placeBackup(dumpOf(ROWS));
    const result = await run();
    expect(result.failures).toEqual([]);
    expect(result.status).toBe('ok');
    expect(result.rows).toBe(2);
    expect(result.tables).toBeGreaterThan(30);
    expect(result.bytes).toBeGreaterThan(0);
    expect(importCalls).toBe(1);
    expect(await scratchSchemas()).toEqual([]);
    // Perbedaan dengan basis data hidup (tabel settings hidup kosong) hanya catatan, bukan kegagalan.
    expect(result.notes.join(' ')).toContain('settings');
    expect(await readdir(join(dir, VERIFY_WORK_DIR))).toEqual([]);
  }, 120_000);

  test('memilih cadangan lokal terbaru menurut nama bila nama tidak diberikan', async () => {
    await placeBackup(dumpOf(), 'same', 'qc-backup-20260101-0200.sql.gz');
    const newest = await placeBackup(dumpOf(ROWS));
    expect(await newestLocalBackup(dir)).toBe(newest);
    expect((await run()).name).toBe(newest);
  }, 120_000);
});

describe('runBackupVerification: pemulihan yang tidak sama dengan dump', () => {
  test('jumlah baris hasil impor kurang dari isi dump -> failed, menyebut tabel dan jumlahnya', async () => {
    await placeBackup(dumpOf(ROWS));
    afterImport = async (target) => {
      await target.exec('DELETE FROM `settings` LIMIT 1');
    };
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.failures.join(' ')).toContain('settings: dump 2 baris, hasil pemulihan 1 baris');
    expect(await scratchSchemas()).toEqual([]);
  }, 120_000);

  test('tabel ada di dump tetapi tidak terbentuk -> failed', async () => {
    await placeBackup(dumpOf());
    afterImport = async (target) => {
      await target.exec('DROP TABLE `rate_limits`');
    };
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.failures.join(' ')).toContain(
      'Tabel rate_limits ada di dump tetapi tidak terbentuk',
    );
    expect(await scratchSchemas()).toEqual([]);
  }, 120_000);

  test('struktur berbeda dengan skema hidup (migrasi sama) -> failed; migrasi hidup bertambah -> hanya catatan', async () => {
    await placeBackup(dumpOf());
    afterImport = async (target) => {
      await target.exec('ALTER TABLE `rate_limits` ADD COLUMN `zz` INT NULL');
    };
    const strict = await run();
    expect(strict.status).toBe('failed');
    expect(strict.failures.join(' ')).toContain('Struktur tabel rate_limits berbeda');

    await env.DB.prepare('INSERT INTO schema_migrations (name) VALUES (?)').bind('9999_baru').run();
    const lenient = await run();
    expect(lenient.status).toBe('ok');
    expect(lenient.notes.join(' ')).toContain('9999_baru');
    expect(lenient.notes.join(' ')).toContain('Struktur tabel rate_limits berbeda');
  }, 180_000);

  test('impor melempar galat -> failed (final), skema sementara dibuang, kata sandi tak bocor', async () => {
    await placeBackup(dumpOf(ROWS));
    importError = new Error('mariadb gagal (kode keluar 1): ERROR 1064');
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.summary).toContain('Impor dump ke skema sementara gagal');
    expect(await scratchSchemas()).toEqual([]);
  }, 120_000);
});

describe('runBackupVerification: berkas cadangan bermasalah (tidak ada yang diimpor)', () => {
  test('gzip terpotong -> failed tanpa membuat skema', async () => {
    const name = backupName(env.clock.now());
    const bytes = gzipSync(dumpOf(ROWS));
    await writeFile(join(dir, name), bytes.subarray(0, bytes.length - 20));
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.summary).toContain('rusak atau terpotong');
    expect(importCalls).toBe(0);
    expect(await scratchSchemas()).toEqual([]);
  }, 60_000);

  test('tanpa baris penutup "Dump completed" -> failed', async () => {
    await placeBackup(`${baseDump}\n${ROWS}\n`, 'none');
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.summary).toContain('tidak lengkap');
    expect(importCalls).toBe(0);
  }, 60_000);

  test('MD5 berkas lokal tidak sama dengan salinan Drive -> failed', async () => {
    await placeBackup(dumpOf(ROWS), 'different');
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.summary).toContain('MD5/ukuran');
    expect(importCalls).toBe(0);
  }, 60_000);

  test('cadangan tidak ada di Drive -> failed', async () => {
    await ensureBackupFolder(env);
    await placeBackup(dumpOf(ROWS), 'none');
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.summary).toContain('tidak ada di folder cadangan Drive');
    expect(importCalls).toBe(0);
  }, 60_000);

  test('isi dump berbahaya ditolak pemeriksa isi -> failed, tanpa impor', async () => {
    await placeBackup(`${baseDump}\nUSE mysql;\n-- Dump completed on x\n`);
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.summary).toContain('ditolak');
    expect(importCalls).toBe(0);
  }, 60_000);

  test('tidak ada berkas cadangan lokal -> error (dicoba lagi), bukan failed', async () => {
    const result = await run();
    expect(result.status).toBe('error');
    expect(result.summary).toContain('Tidak ada berkas cadangan');
    expect(await run('qc-backup-20260101-0200.sql.gz')).toMatchObject({ status: 'error' });
  }, 60_000);
});

describe('skema sementara yatim', () => {
  test('yang lebih tua dari batas dibuang, yang baru dibiarkan, skema lain tak disentuh', async () => {
    const now = env.clock.now();
    const old = `${PREFIX}${Math.floor((now - 3 * 60 * MINUTE) / 1000)}_abcdef`;
    const fresh = `${PREFIX}${Math.floor((now - 5 * MINUTE) / 1000)}_abcdef`;
    const other = `${PREFIX}bukan_stempel`;
    for (const schema of [old, fresh, other]) await admin.exec(`CREATE DATABASE \`${schema}\``);
    expect(await sweepOrphanVerifySchemas(admin, PREFIX, now)).toEqual([old]);
    expect((await scratchSchemas()).sort()).toEqual([fresh, other].sort());
    await placeBackup(dumpOf());
    const result = await run();
    expect(result.status).toBe('ok');
    expect((await scratchSchemas()).sort()).toEqual([fresh, other].sort());
  }, 120_000);
});

describe('isVerifyDue (fungsi murni)', () => {
  const NAME = 'qc-backup-20260115-0200.sql.gz';
  const BACKUP_AT = Date.parse('2026-01-14T19:00:00Z'); // 02:00 WIB
  const stored = (status: 'ok' | 'failed' | 'error', attempts = 1, finishedAt = BACKUP_AT) => ({
    status,
    name: NAME,
    attempts,
    startedAt: finishedAt,
    finishedAt,
    durationMs: 1,
    summary: '',
    failures: [],
    notes: [],
    tables: 0,
    rows: 0,
    bytes: 0,
  });

  test('cadangan segar tanpa hasil -> jatuh tempo; ok/failed -> tidak; terlalu tua atau nama rusak -> tidak', () => {
    expect(isVerifyDue(BACKUP_AT + 10 * MINUTE, NAME, null)).toBe(true);
    expect(isVerifyDue(BACKUP_AT + 10 * MINUTE, NAME, stored('ok'))).toBe(false);
    expect(isVerifyDue(BACKUP_AT + 10 * MINUTE, NAME, stored('failed'))).toBe(false);
    expect(isVerifyDue(BACKUP_AT + 9 * 60 * MINUTE, NAME, null)).toBe(false);
    expect(isVerifyDue(BACKUP_AT, '', null)).toBe(false);
    expect(isVerifyDue(BACKUP_AT, 'bukan-nama', null)).toBe(false);
  });

  test('hasil untuk cadangan lain tidak dihitung; error diulang setelah jeda dan sampai batas percobaan', () => {
    const other = { ...stored('ok'), name: 'qc-backup-20260114-0200.sql.gz' };
    expect(isVerifyDue(BACKUP_AT + MINUTE, NAME, other)).toBe(true);
    const failedAt = BACKUP_AT + 10 * MINUTE;
    expect(
      isVerifyDue(failedAt + VERIFY_RETRY_AFTER_MS - 1, NAME, stored('error', 1, failedAt)),
    ).toBe(false);
    expect(isVerifyDue(failedAt + VERIFY_RETRY_AFTER_MS, NAME, stored('error', 1, failedAt))).toBe(
      true,
    );
    expect(
      isVerifyDue(
        failedAt + VERIFY_RETRY_AFTER_MS,
        NAME,
        stored('error', VERIFY_MAX_ATTEMPTS, failedAt),
      ),
    ).toBe(false);
  });
});

describe('job backup_verify (rantai dari cadangan)', () => {
  const SQL = () => dumpOf(ROWS);

  async function makeVerifyEnv(factory?: () => Promise<VerifyPorts>): Promise<TestEnv> {
    return makeEnv({
      BACKUP_DUMP: async (outputPath) => {
        await writeFile(outputPath, gzipSync(SQL()));
      },
      BACKUP_VERIFY: factory ?? (async () => ports()),
    });
  }

  test('db_backup sukses langsung memicu verifikasi; hasil tersimpan; tidak diulang', async () => {
    env = await makeVerifyEnv();
    const { scheduleBackupJob } = await import('./service');
    expect(typeof (await scheduleBackupJob(env))).toBe('string');
    await runPendingJobs(env);

    const name = backupName(env.clock.now());
    expect(await getSetting(env, SETTING_BACKUP_LAST_SUCCESS)).toBe('20260115');
    expect(await getSetting(env, SETTING_BACKUP_LAST_SUCCESS_NAME)).toBe(name);
    const stored = await readVerifyResult(env);
    expect(stored).toMatchObject({ status: 'ok', name, attempts: 1, rows: 2 });
    expect(importCalls).toBe(1);
    expect(await findActiveJob(env, 'backup_verify')).toBeNull();
    expect(await scheduleBackupVerifyJob(env)).toBeNull();
    expect(await scratchSchemas()).toEqual([]);
  }, 180_000);

  test('verifikasi yang tidak cocok = hasil, bukan kegagalan job: dicatat sekali, tanpa percobaan ulang runner', async () => {
    afterImport = async (target) => {
      await target.exec('DELETE FROM `settings`');
    };
    env = await makeVerifyEnv();
    const { scheduleBackupJob } = await import('./service');
    await scheduleBackupJob(env);
    await runPendingJobs(env);
    expect(importCalls).toBe(1);
    const stored = await readVerifyResult(env);
    expect(stored?.status).toBe('failed');
    expect(stored?.failures.join(' ')).toContain('settings');
    // Final: penjadwal tidak mengantre ulang verifikasi untuk cadangan yang sama.
    expect(await scheduleBackupVerifyJob(env)).toBeNull();
    expect(importCalls).toBe(1);
  }, 180_000);

  test('hasil error dicoba lagi setelah jeda, dan berhenti sesudah batas percobaan', async () => {
    env = await makeVerifyEnv();
    // Cadangan terakhir tercatat berhasil, tetapi berkas lokalnya hilang: verifikasi tak dapat diselesaikan.
    const name = backupName(env.clock.now());
    const { putSetting } = await import('@server/core/settings');
    await putSetting(env, SETTING_BACKUP_LAST_SUCCESS_NAME, name);
    for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
      expect(typeof (await scheduleBackupVerifyJob(env))).toBe('string');
      await runPendingJobs(env);
      expect(await readVerifyResult(env)).toMatchObject({ status: 'error', attempts: attempt });
      expect(await scheduleBackupVerifyJob(env)).toBeNull(); // belum lewat jeda
      env.clock.advance(VERIFY_RETRY_AFTER_MS + MINUTE);
    }
    expect(await scheduleBackupVerifyJob(env)).toBeNull(); // percobaan habis
    expect(importCalls).toBe(0);
  }, 120_000);

  test('tanpa BACKUP_VERIFY atau tanpa BACKUP_ENABLED penjadwal tidak membuat job (dev dan tes)', async () => {
    const plain = await makeEnv({ BACKUP_VERIFY: undefined });
    await (await import('@server/core/settings')).putSetting(
      plain,
      SETTING_BACKUP_LAST_SUCCESS_NAME,
      backupName(plain.clock.now()),
    );
    expect(await scheduleBackupVerifyJob(plain)).toBeNull();
    const off = await makeEnv({ BACKUP_ENABLED: false, BACKUP_VERIFY: async () => ports() });
    await (await import('@server/core/settings')).putSetting(
      off,
      SETTING_BACKUP_LAST_SUCCESS_NAME,
      backupName(off.clock.now()),
    );
    expect(await scheduleBackupVerifyJob(off)).toBeNull();
  });
});
