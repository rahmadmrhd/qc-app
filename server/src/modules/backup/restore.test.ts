import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createFakeBridge, type FakeBridge } from '@server-test/fake-bridge';
import {
  parseRestoreArgs,
  RESTORE_USAGE,
  type RestoreDb,
  type RestoreDeps,
  RestoreError,
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
    ).rejects.toThrow(/CREATE DATABASE\/USE/);
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
