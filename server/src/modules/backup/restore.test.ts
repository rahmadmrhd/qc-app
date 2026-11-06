import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createFakeBridge, type FakeBridge } from '@server-test/fake-bridge';
import { parseMysqlUrl } from './dump';
import {
  importArgs,
  parseRestoreArgs,
  purgeStaleRestoreDirs,
  RESTORE_USAGE,
  type RestoreDb,
  type RestoreDeps,
  RestoreError,
  resolveBackupFolderId,
  restoreBackup,
} from './restore';

const FOLDER = 'folder-cadangan';
const NAME = 'qc-backup-20260115-0200.sql.gz';
const SQL = [
  'CREATE TABLE users (id int);',
  'INSERT INTO users VALUES (1);',
  'INSERT INTO users VALUES (2);',
  'CREATE TABLE items (id int);',
  'INSERT INTO items VALUES (1);',
  '-- Dump completed on 2026-01-15  2:00:01',
  '',
].join('\n');

interface FakeSchemas {
  schemas: Map<string, Map<string, number>>;
  created: string[];
  dropped: string[];
}

function fakeDb(state: FakeSchemas): RestoreDb {
  return {
    async schemaExists(schema) {
      return state.schemas.has(schema);
    },
    async tableNames(schema) {
      return [...(state.schemas.get(schema)?.keys() ?? [])].sort();
    },
    async createSchema(schema) {
      state.created.push(schema);
      state.schemas.set(schema, new Map());
    },
    async dropSchema(schema) {
      state.dropped.push(schema);
      state.schemas.delete(schema);
    },
    async countRows(schema, table) {
      return state.schemas.get(schema)?.get(table) ?? 0;
    },
  };
}

/** Pengimpor tiruan: membangun tabel dan jumlah baris dari isi .sql. */
function fakeImporter(state: FakeSchemas, options: { fail?: boolean } = {}) {
  const imported: string[] = [];
  return {
    imported,
    async importSql(sqlPath: string, schema: string) {
      const text = await readFile(sqlPath, 'utf8');
      imported.push(text);
      const tables = state.schemas.get(schema);
      if (!tables) throw new Error('skema tidak ada');
      let current = '';
      for (const line of text.split('\n')) {
        const create = /^CREATE TABLE (\w+)/.exec(line);
        if (create) {
          current = create[1] as string;
          tables.set(current, 0);
        } else if (line.startsWith('INSERT') && current !== '') {
          tables.set(current, (tables.get(current) ?? 0) + 1);
        }
        if (options.fail && tables.size > 0 && line.startsWith('INSERT')) {
          throw new Error('ERROR 1064 di tengah impor');
        }
      }
    },
  };
}

let dir: string;
let bridge: FakeBridge;
let state: FakeSchemas;

async function seed(bytes: Uint8Array, appProperties?: Record<string, string>, name = NAME) {
  const sha = createHash('sha256').update(bytes).digest('hex');
  await bridge.uploadFile(FOLDER, name, 'application/gzip', bytes, {
    appProperties: appProperties ?? { sha256: sha, app: 'qc' },
  });
}

function deps(
  importer: ReturnType<typeof fakeImporter>,
  extra: Partial<RestoreDeps> = {},
): RestoreDeps {
  return {
    bridge,
    folderId: FOLDER,
    workDir: join(dir, 'kerja'),
    db: fakeDb(state),
    importSql: importer.importSql,
    protectedSchemas: ['qc_dev'],
    ...extra,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qc-restore-test-'));
  bridge = createFakeBridge();
  state = {
    schemas: new Map([
      [
        'qc_dev',
        new Map([
          ['users', 2],
          ['items', 1],
        ]),
      ],
    ]),
    created: [],
    dropped: [],
  };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('restoreBackup', () => {
  test('cadangan sah: diverifikasi, dipulihkan ke skema baru, jumlah baris dibandingkan dengan sumber, temp dibersihkan', async () => {
    await seed(gzipSync(SQL));
    const importer = fakeImporter(state);
    const report = await restoreBackup(deps(importer), {
      targetSchema: 'qc_restore_check',
      compareWith: 'qc_dev',
    });
    expect(importer.imported).toEqual([SQL]);
    expect(report.name).toBe(NAME);
    expect(report.matched).toBe(true);
    expect(report.tables).toEqual([
      { table: 'items', restored: 1, source: 1 },
      { table: 'users', restored: 2, source: 2 },
    ]);
    expect(state.created).toEqual(['qc_restore_check']);
    expect(report.dropped).toBe(false);
    expect(await readdir(join(dir, 'kerja'))).toEqual([]);
  });

  test('--drop-after menghapus skema target setelah perbandingan', async () => {
    await seed(gzipSync(SQL));
    const report = await restoreBackup(deps(fakeImporter(state)), {
      targetSchema: 'qc_restore_check',
      compareWith: 'qc_dev',
      dropAfter: true,
    });
    expect(report.dropped).toBe(true);
    expect(state.dropped).toEqual(['qc_restore_check']);
    expect(state.schemas.has('qc_restore_check')).toBe(false);
  });

  test('jumlah baris beda dengan sumber -> matched false', async () => {
    await seed(gzipSync(SQL));
    state.schemas.get('qc_dev')?.set('users', 3);
    const report = await restoreBackup(deps(fakeImporter(state)), {
      targetSchema: 'qc_restore_check',
      compareWith: 'qc_dev',
    });
    expect(report.matched).toBe(false);
  });

  test('tabel sumber yang tidak ada di hasil pemulihan -> matched false', async () => {
    await seed(gzipSync(SQL));
    state.schemas.get('qc_dev')?.set('orders', 5);
    const report = await restoreBackup(deps(fakeImporter(state)), {
      targetSchema: 'qc_restore_check',
      compareWith: 'qc_dev',
    });
    expect(report.matched).toBe(false);
  });

  test('--file-id memilih berkas tertentu; tanpa itu yang terbaru menurut nama', async () => {
    await seed(
      gzipSync('CREATE TABLE lama (id int);\n-- Dump completed\n'),
      undefined,
      'qc-backup-20260101-0200.sql.gz',
    );
    await seed(gzipSync(SQL));
    const newest = await restoreBackup(deps(fakeImporter(state)), {
      targetSchema: 'qc_restore_a',
    });
    expect(newest.name).toBe(NAME);
    const oldId = [...bridge.state.files].find(([, file]) =>
      file.name.includes('20260101'),
    )?.[0] as string;
    const old = await restoreBackup(deps(fakeImporter(state)), {
      targetSchema: 'qc_restore_b',
      fileId: oldId,
    });
    expect(old.name).toBe('qc-backup-20260101-0200.sql.gz');
  });

  test('gzip terpotong (MD5 cocok karena berkas memang itu) -> ditolak, skema TIDAK dibuat, tidak ada impor', async () => {
    const full = gzipSync(SQL.repeat(200));
    await seed(full.subarray(0, Math.floor(full.length / 2)));
    const importer = fakeImporter(state);
    await expect(
      restoreBackup(deps(importer), { targetSchema: 'qc_restore_check' }),
    ).rejects.toThrow(/rusak atau terpotong/);
    expect(state.created).toEqual([]);
    expect(importer.imported).toEqual([]);
    expect(await readdir(join(dir, 'kerja'))).toEqual([]);
  });

  test('SHA-256 di appProperties tidak cocok -> ditolak sebelum menyentuh skema', async () => {
    await seed(gzipSync(SQL), { sha256: '0'.repeat(64) });
    const importer = fakeImporter(state);
    await expect(
      restoreBackup(deps(importer), { targetSchema: 'qc_restore_check' }),
    ).rejects.toThrow(/SHA-256/);
    expect(state.created).toEqual([]);
    expect(importer.imported).toEqual([]);
  });

  test('MD5 Drive tidak cocok dengan unduhan -> ditolak', async () => {
    await seed(gzipSync(SQL));
    const list = bridge.listFolder.bind(bridge);
    bridge.listFolder = async (...args) => {
      const page = await list(...args);
      return {
        ...page,
        files: page.files.map((file) => ({ ...file, md5Checksum: 'f'.repeat(32) })),
      };
    };
    const importer = fakeImporter(state);
    await expect(
      restoreBackup(deps(importer), { targetSchema: 'qc_restore_check' }),
    ).rejects.toThrow(/MD5/);
    expect(state.created).toEqual([]);
  });

  test('cadangan tanpa SHA-256 di appProperties tidak dapat diverifikasi -> ditolak', async () => {
    await seed(gzipSync(SQL), {});
    await expect(
      restoreBackup(deps(fakeImporter(state)), { targetSchema: 'qc_restore_check' }),
    ).rejects.toThrow(/tidak dapat diverifikasi/);
  });

  test('dump tanpa baris penutup (terpotong tetapi gzip utuh) -> ditolak', async () => {
    await seed(gzipSync('CREATE TABLE users (id int);\nINSERT INTO users VALUES (1);\n'));
    const importer = fakeImporter(state);
    await expect(
      restoreBackup(deps(importer), { targetSchema: 'qc_restore_check' }),
    ).rejects.toThrow(/tidak lengkap/);
    expect(importer.imported).toEqual([]);
  });

  test('dump yang memuat CREATE DATABASE / USE ditolak (tidak akan menimpa skema lain)', async () => {
    await seed(gzipSync('USE `qc_dev`;\nCREATE TABLE a (id int);\n-- Dump completed\n'));
    await expect(
      restoreBackup(deps(fakeImporter(state)), { targetSchema: 'qc_restore_check' }),
    ).rejects.toThrow(/isi yang ditolak/);
    expect(state.created).toEqual([]);
  });

  test('impor gagal di tengah -> skema yang setengah terisi dibuang dan galat jelas', async () => {
    await seed(gzipSync(SQL));
    await expect(
      restoreBackup(deps(fakeImporter(state, { fail: true })), {
        targetSchema: 'qc_restore_check',
      }),
    ).rejects.toThrow(/Impor gagal dan skema qc_restore_check dibuang/);
    expect(state.schemas.has('qc_restore_check')).toBe(false);
    expect(state.dropped).toEqual(['qc_restore_check']);
  });

  test('skema target yang sudah berisi tabel ditolak; skema aplikasi (dilindungi) ditolak', async () => {
    await seed(gzipSync(SQL));
    state.schemas.set('qc_restore_check', new Map([['ada', 1]]));
    await expect(
      restoreBackup(deps(fakeImporter(state)), { targetSchema: 'qc_restore_check' }),
    ).rejects.toThrow(/sudah berisi tabel/);
    await expect(
      restoreBackup(deps(fakeImporter(state)), { targetSchema: 'qc_dev' }),
    ).rejects.toThrow(/skema aplikasi/);
    expect(state.dropped).toEqual([]); // skema yang bukan buatan kita tidak pernah dibuang
  });

  test('skema target kosong yang sudah ada dipakai tanpa dibuat ulang', async () => {
    await seed(gzipSync(SQL));
    state.schemas.set('qc_restore_check', new Map());
    const report = await restoreBackup(deps(fakeImporter(state)), {
      targetSchema: 'qc_restore_check',
    });
    expect(state.created).toEqual([]);
    expect(report.tables).toHaveLength(2);
  });

  test('nama skema tidak valid ditolak sebelum apa pun dilakukan', async () => {
    for (const bad of ['', 'a-b', 'a`b', 'a;DROP', 'x'.repeat(65)]) {
      await expect(
        restoreBackup(deps(fakeImporter(state)), { targetSchema: bad }),
      ).rejects.toBeInstanceOf(RestoreError);
    }
    expect(bridge.calls).toEqual([]);
  });

  test('folder tanpa cadangan -> galat jelas', async () => {
    await expect(
      restoreBackup(deps(fakeImporter(state)), { targetSchema: 'qc_restore_check' }),
    ).rejects.toThrow(/Tidak ada cadangan/);
  });
});

describe('parseRestoreArgs', () => {
  test('argumen sah', () => {
    expect(
      parseRestoreArgs([
        '--target',
        'qc_restore_check',
        '--compare-with',
        'qc_dev',
        '--drop-after',
        '--file-id',
        'abc',
      ]),
    ).toEqual({
      targetSchema: 'qc_restore_check',
      compareWith: 'qc_dev',
      dropAfter: true,
      fileId: 'abc',
    });
    expect(parseRestoreArgs(['--target', 'x'])).toEqual({ targetSchema: 'x', dropAfter: false });
  });

  test('salah pakai -> null', () => {
    expect(parseRestoreArgs([])).toBeNull();
    expect(parseRestoreArgs(['--target'])).toBeNull();
    expect(parseRestoreArgs(['--target', '--drop-after'])).toBeNull();
    expect(parseRestoreArgs(['--target', 'x', '--aneh'])).toBeNull();
    expect(RESTORE_USAGE).toContain('--target');
  });
});

describe('restoreBackup: pengerasan (M2, M9)', () => {
  test('bentuk berbahaya yang umum ditolak sebelum skema dibuat (lapisan tambahan; batas utama = pengguna qc_restore) (USE tanpa backtick, perintah klien, tulisan ke skema lain)', async () => {
    for (const line of [
      'USE qc_dev;',
      '\\! cat /etc/passwd',
      'system id',
      'DROP DATABASE qc_dev;',
      "GRANT ALL ON *.* TO 'x'@'%';",
      'INSERT INTO mysql.user VALUES (1);',
    ]) {
      bridge = createFakeBridge();
      state.created = [];
      await seed(
        gzipSync(`CREATE TABLE a (id int);
${line}
-- Dump completed
`),
      );
      const importer = fakeImporter(state);
      await expect(
        restoreBackup(deps(importer), { targetSchema: 'qc_restore_check' }),
        line,
      ).rejects.toThrow(/isi yang ditolak/);
      expect(state.created, line).toEqual([]);
      expect(importer.imported).toEqual([]);
    }
  });

  test('dump asli MariaDB 11 (baris sandbox dan komentar bersyarat) tetap lolos', async () => {
    await seed(
      gzipSync(
        [
          '/*M!999999\\- enable the sandbox mode */',
          '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;',
          SQL,
        ].join('\n'),
      ),
    );
    const report = await restoreBackup(deps(fakeImporter(state)), {
      targetSchema: 'qc_restore_check',
    });
    expect(report.tables).toHaveLength(2);
  });

  test('announce dipanggil dengan nama dan tanggal cadangan SEBELUM impor', async () => {
    await seed(gzipSync(SQL));
    const order: string[] = [];
    const importer = fakeImporter(state);
    await restoreBackup(
      deps(
        {
          ...importer,
          importSql: async (...args) => {
            order.push('impor');
            await importer.importSql(...args);
          },
        },
        { announce: (backup) => order.push(`announce:${backup.name}:${backup.date}`) },
      ),
      { targetSchema: 'qc_restore_check' },
    );
    expect(order).toEqual([`announce:${NAME}:20260115`, 'impor']);
  });

  test.skipIf(process.platform === 'win32')(
    'berkas kerja pemulihan hanya dapat dibaca pemilik (0600) dan folder 0700',
    async () => {
      await seed(gzipSync(SQL));
      let mode = 0;
      let dirMode = 0;
      const importer = fakeImporter(state);
      await restoreBackup(
        deps({
          ...importer,
          importSql: async (sqlPath, schema) => {
            mode = (await stat(sqlPath)).mode & 0o777;
            dirMode = (await stat(join(dir, 'kerja'))).mode & 0o777;
            await importer.importSql(sqlPath, schema);
          },
        }),
        { targetSchema: 'qc_restore_check' },
      );
      expect(mode).toBe(0o600);
      expect(dirMode).toBe(0o700);
    },
  );

  test('purgeStaleRestoreDirs membuang job-* yang usang (> 6 jam) saja; yang baru (pemulihan lain yang berjalan) dibiarkan', async () => {
    const root = join(dir, 'restore-tmp');
    for (const name of ['job-lama', 'job-baru', 'lain'])
      await mkdir(join(root, name), { recursive: true });
    const hours = (count: number) => new Date(Date.now() - count * 3_600_000);
    await utimes(join(root, 'job-lama'), hours(7), hours(7));
    await utimes(join(root, 'job-baru'), hours(1), hours(1));
    await utimes(join(root, 'lain'), hours(9), hours(9));
    expect(await purgeStaleRestoreDirs(root)).toBe(1);
    expect((await readdir(root)).sort()).toEqual(['job-baru', 'lain']);
    expect(await purgeStaleRestoreDirs(join(dir, 'tidak-ada'))).toBe(0);
  });

  test('purgeStaleRestoreDirs: ambang dapat diatur dan memakai jam yang disuntik', async () => {
    const root = join(dir, 'restore-tmp');
    await mkdir(join(root, 'job-x'), { recursive: true });
    expect(await purgeStaleRestoreDirs(root, { now: Date.now() + 10_000, maxAgeMs: 60_000 })).toBe(
      0,
    );
    expect(await purgeStaleRestoreDirs(root, { now: Date.now() + 120_000, maxAgeMs: 60_000 })).toBe(
      1,
    );
  });
});

describe('importArgs (N1)', () => {
  test('skema target dari argumen CLI secara posisional; URL tingkat server tanpa nama basis data cukup', () => {
    const target = parseMysqlUrl('mysql://qc_restore:rahasia@qc-db:3306/', {
      name: 'RESTORE_DATABASE_URL',
      requireDatabase: false,
    });
    const args = importArgs(target, 'qc_restore_check');
    expect(args.at(-1)).toBe('qc_restore_check');
    expect(args).toContain('--user=qc_restore');
    expect(args).toContain('--host=qc-db');
    expect(args.join(' ')).not.toContain('rahasia');
    expect(args).not.toContain('');
  });
});

describe('resolveBackupFolderId (I1)', () => {
  const ID_FLAG = 'folderFlag1234567';
  const ID_ENV = 'folderEnv12345678';
  const ID_SETTING = 'folderSetting1234';
  const failing = async (): Promise<string> => {
    throw new Error("Table 'mysql.settings' doesn't exist");
  };

  test('urutan: --folder-id menang atas BACKUP_FOLDER_ID, yang menang atas settings; settings tak dibaca bila ada yang di atasnya', async () => {
    let reads = 0;
    const readSetting = async () => {
      reads += 1;
      return ID_SETTING;
    };
    expect(await resolveBackupFolderId({ flag: ID_FLAG, configured: ID_ENV, readSetting })).toBe(
      ID_FLAG,
    );
    expect(await resolveBackupFolderId({ configured: ID_ENV, readSetting })).toBe(ID_ENV);
    expect(reads).toBe(0);
    expect(await resolveBackupFolderId({ configured: '', readSetting })).toBe(ID_SETTING);
    expect(reads).toBe(1);
  });

  test('--folder-id divalidasi sebagai id Drive', async () => {
    for (const bad of ['../x', 'a b', 'x?alt=media', 'pendek']) {
      await expect(
        resolveBackupFolderId({ flag: bad, configured: '', readSetting: async () => '' }),
      ).rejects.toThrow(/--folder-id/);
    }
  });

  test('skema aplikasi tak terbaca dan tak ada sumber lain: galat jelas yang menyebut --folder-id; flag tetap berfungsi', async () => {
    await expect(resolveBackupFolderId({ configured: '', readSetting: failing })).rejects.toThrow(
      /--folder-id/,
    );
    expect(
      await resolveBackupFolderId({ flag: ID_FLAG, configured: '', readSetting: failing }),
    ).toBe(ID_FLAG);
  });

  test('settings kosong dan tak ada sumber lain: galat menyebut --folder-id', async () => {
    await expect(
      resolveBackupFolderId({ configured: '', readSetting: async () => '' }),
    ).rejects.toThrow(/--folder-id/);
  });

  test('parseRestoreArgs menerima --folder-id', () => {
    expect(parseRestoreArgs(['--target', 'x', '--folder-id', ID_FLAG])).toEqual({
      targetSchema: 'x',
      dropAfter: false,
      folderId: ID_FLAG,
    });
    expect(RESTORE_USAGE).toContain('--folder-id');
  });
});
