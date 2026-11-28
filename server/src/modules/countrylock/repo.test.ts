import { beforeEach, describe, expect, test } from 'bun:test';
import { isGuardFailure } from '@server/core/cas';
import { DbError } from '@server/core/db';
import { newId } from '@server/core/id';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  advanceHeadStmt,
  type ClFileRecord,
  firmwareRows,
  getFileByPath,
  insertFileStmt,
  insertRevisionStmt,
  latestBundle,
  listFiles,
  listRevisions,
} from './repo';
import { COUNTRYLOCK_FIRMWARE_SEEDED_KEY, seedCountryLockFirmwares } from './seed';

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
});

const NOW = '2026-11-28T00:00:00.000Z';
const HASH = 'a'.repeat(64);

function fileRecord(path: string, overrides: Partial<ClFileRecord> = {}): ClFileRecord {
  return {
    id: newId(),
    path,
    role: 'script',
    kind: 'text',
    headRev: 0,
    removedAt: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

async function duplicateKeyOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DbError);
  expect((error as DbError).kind).toBe('duplicate');
  return (error as DbError).key;
}

async function insertFirmware(code: string, removedAt = ''): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO cl_firmwares (id, brand, code, label, script_path, parallel, sort, removed_at, created_at, updated_at) VALUES (?, 'mikrotik', ?, ?, NULL, 0, 0, ?, ?, ?)",
  )
    .bind(newId(), code, code, removedAt, NOW, NOW)
    .run();
}

describe('seedCountryLockFirmwares', () => {
  // Daftar awal sama dengan `config.QC` lama (daftar tetap lama yang sudah dihapus; kode dan label).
  const INITIAL = {
    mikrotik: [
      ['AC', 'AC'],
      ['5Ghz', '5GHz'],
      ['2Ghz', '2GHz'],
      ['AC2', 'AC2'],
      ['ARM', 'ARM'],
      ['Mantbox 19s', 'Mantbox 19s'],
      ['AX', 'AX'],
      ['AX2', 'AX2'],
    ],
    ubiquiti: [
      ['WA', 'WA Firmware'],
      ['2WA', '2WA Firmware'],
      ['LAP120', 'LAP120 Firmware'],
      ['XC', 'XC Firmware'],
      ['2XC', '2XC Firmware'],
      ['M', 'airMAX M'],
      ['af5xhd', 'AF-5XHD'],
      ['XW', 'XW Firmware'],
      ['XM', 'XM Firmware'],
    ],
  } as const;
  const EXPECTED = Object.values(INITIAL).reduce((sum, list) => sum + list.length, 0);

  test('memasukkan 17 firmware awal, idempoten bila dipanggil berulang', async () => {
    expect(EXPECTED).toBe(17);
    const first = await seedCountryLockFirmwares(env);
    expect(first.inserted).toBe(17);
    const second = await seedCountryLockFirmwares(env);
    expect(second.inserted).toBe(0);
    const rows = await firmwareRows(env.DB);
    expect(rows).toHaveLength(17);
    expect(rows.every((row) => row.removedAt === '' && row.parallel === false)).toBe(true);
    expect(rows.every((row) => row.scriptPath === null)).toBe(true);
    expect(rows.filter((row) => row.brand === 'mikrotik').map((row) => row.code)).toEqual(
      INITIAL.mikrotik.map(([code]) => code),
    );
    expect(rows.filter((row) => row.brand === 'ubiquiti').map((row) => row.label)).toEqual(
      INITIAL.ubiquiti.map(([, label]) => label),
    );
  });

  test('aman dijalankan serentak: tidak ada baris ganda', async () => {
    await Promise.all([seedCountryLockFirmwares(env), seedCountryLockFirmwares(env)]);
    expect(await firmwareRows(env.DB)).toHaveLength(17);
  });

  test('firmware yang sengaja dihapus admin tidak dihidupkan lagi oleh seed', async () => {
    await seedCountryLockFirmwares(env);
    await env.DB.prepare(
      "UPDATE cl_firmwares SET removed_at = ? WHERE brand = 'mikrotik' AND code = 'AC'",
    )
      .bind(NOW)
      .run();
    const again = await seedCountryLockFirmwares(env);
    expect(again.inserted).toBe(0);
    const live = await firmwareRows(env.DB);
    expect(live).toHaveLength(16);
    expect(live.some((row) => row.brand === 'mikrotik' && row.code === 'AC')).toBe(false);
    expect(await firmwareRows(env.DB, { includeRemoved: true })).toHaveLength(17);
  });

  test('admin mengganti kode firmware: seed berikutnya tidak membuat baris hantu berkode lama', async () => {
    await seedCountryLockFirmwares(env);
    await env.DB.prepare(
      "UPDATE cl_firmwares SET code = 'AC-v7' WHERE brand = 'mikrotik' AND code = 'AC'",
    ).run();
    const again = await seedCountryLockFirmwares(env);
    expect(again.inserted).toBe(0);
    const rows = await firmwareRows(env.DB, { includeRemoved: true });
    expect(rows).toHaveLength(17);
    expect(rows.some((row) => row.brand === 'mikrotik' && row.code === 'AC')).toBe(false);
    expect(rows.some((row) => row.code === 'AC-v7')).toBe(true);
  });

  test('seed hanya sekali: penanda di settings; tabel yang sudah berisi (lingkungan lama tanpa penanda) tidak diisi ulang', async () => {
    const marker = () =>
      env.DB.prepare('SELECT value FROM settings WHERE `key` = ?')
        .bind(COUNTRYLOCK_FIRMWARE_SEEDED_KEY)
        .first<{ value: string }>();
    expect(await marker()).toBeNull();
    await seedCountryLockFirmwares(env);
    expect(await marker()).not.toBeNull();

    // Admin mengosongkan daftar sepenuhnya: penanda mencegah seed menghidupkannya lagi.
    await env.DB.prepare('DELETE FROM cl_firmwares').run();
    expect((await seedCountryLockFirmwares(env)).inserted).toBe(0);
    expect(await firmwareRows(env.DB, { includeRemoved: true })).toHaveLength(0);

    // Lingkungan yang sudah di-seed versi lama (baris ada, penanda belum): hanya menulis penanda.
    await env.DB.prepare('DELETE FROM settings WHERE `key` = ?')
      .bind(COUNTRYLOCK_FIRMWARE_SEEDED_KEY)
      .run();
    await env.DB.prepare(
      "INSERT INTO cl_firmwares (id, brand, code, label, script_path, parallel, sort, removed_at, created_at, updated_at) VALUES ('f1', 'mikrotik', 'X', 'X', NULL, 0, 10, '', ?, ?)",
    )
      .bind(NOW, NOW)
      .run();
    expect((await seedCountryLockFirmwares(env)).inserted).toBe(0);
    expect(await firmwareRows(env.DB, { includeRemoved: true })).toHaveLength(1);
    expect(await marker()).not.toBeNull();
  });
});

describe('cl_firmwares', () => {
  test('unik (brand, code) hidup menolak duplikat dan mengizinkan kode sama setelah removed_at terisi', async () => {
    await insertFirmware('AC');
    expect(await duplicateKeyOf(insertFirmware('AC'))).toBe('cl_firmwares_code_live');
    await env.DB.prepare("UPDATE cl_firmwares SET removed_at = ? WHERE code = 'AC'")
      .bind(NOW)
      .run();
    await insertFirmware('AC');
    await insertFirmware('AC', '2026-11-28T01:00:00.000Z');
    const rows = await firmwareRows(env.DB, { includeRemoved: true });
    expect(rows.filter((row) => row.code === 'AC')).toHaveLength(3);
    expect(await firmwareRows(env.DB)).toHaveLength(1);
  });
});

describe('cl_files dan revisi', () => {
  test('cl_files_path_live menolak dua path hidup beda huruf besar/kecil (path_key)', async () => {
    await env.DB.batch([insertFileStmt(env.DB, fileRecord('Mikrotik/AC.rsc'))]);
    const key = await duplicateKeyOf(
      env.DB.batch([insertFileStmt(env.DB, fileRecord('mikrotik/ac.RSC'))]),
    );
    expect(key).toBe('cl_files_path_live');
  });

  test('path boleh dipakai lagi setelah berkas lama dihapus (removed_at terisi)', async () => {
    const old = fileRecord('a.rsc');
    await env.DB.batch([insertFileStmt(env.DB, old)]);
    await env.DB.prepare('UPDATE cl_files SET removed_at = ? WHERE id = ?').bind(NOW, old.id).run();
    await env.DB.batch([insertFileStmt(env.DB, fileRecord('a.rsc'))]);
    const live = await listFiles(env.DB);
    expect(live.map((row) => row.path)).toEqual(['a.rsc']);
    expect(await listFiles(env.DB, { includeRemoved: true })).toHaveLength(2);
  });

  test('getFileByPath mencari berkas hidup tanpa peka huruf besar/kecil', async () => {
    const record = fileRecord('Mikrotik/AC.rsc');
    await env.DB.batch([insertFileStmt(env.DB, record)]);
    expect((await getFileByPath(env.DB, 'mikrotik/ac.rsc'))?.id).toBe(record.id);
    expect((await getFileByPath(env.DB, 'Mikrotik/AC.rsc'))?.path).toBe('Mikrotik/AC.rsc');
    expect(await getFileByPath(env.DB, 'tidak/ada.rsc')).toBeNull();
  });

  test('revisi: (file_id, seq) unik; kepala maju hanya dari revisi yang dilihat penulis (CAS)', async () => {
    const record = fileRecord('s.rsc');
    await env.DB.batch([insertFileStmt(env.DB, record)]);
    const revision = (seq: number) => ({
      id: newId(),
      fileId: record.id,
      seq,
      sha256: HASH,
      size: 3,
      textBody: 'abc',
      message: '',
      author: 'a@b.test',
      createdAt: NOW,
    });
    await env.DB.batch([
      insertRevisionStmt(env.DB, revision(1)),
      advanceHeadStmt(env.DB, record.id, 0, 1, NOW),
    ]);
    expect(await duplicateKeyOf(env.DB.batch([insertRevisionStmt(env.DB, revision(1))]))).toBe(
      'cl_revisions_file_seq',
    );

    // Penulis basis 0 sementara kepala sudah 1: seluruh batch batal, revisi 2 tidak tertulis.
    const stale = await env.DB.batch([
      insertRevisionStmt(env.DB, revision(2)),
      advanceHeadStmt(env.DB, record.id, 0, 2, NOW),
    ]).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(isGuardFailure(stale)).toBe(true);
    const revisions = await listRevisions(env.DB, record.id);
    expect(revisions.map((row) => row.seq)).toEqual([1]);
    expect((await getFileByPath(env.DB, 's.rsc'))?.headRev).toBe(1);

    await env.DB.batch([
      insertRevisionStmt(env.DB, revision(2)),
      advanceHeadStmt(env.DB, record.id, 1, 2, NOW),
    ]);
    expect((await listRevisions(env.DB, record.id)).map((row) => row.seq)).toEqual([2, 1]);
  });
});

describe('cl_bundles', () => {
  const insertBundle = (number: number) =>
    env.DB.prepare(
      'INSERT INTO cl_bundles (id, number, computer_hash, router_hash, min_app, manifest_json, note, published_by, source_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)',
    )
      .bind(newId(), number, HASH, HASH, '0.0.0', '{}', '', 'a@b.test', NOW)
      .run();

  test('latestBundle null bila kosong; nomor unik; terbaru = nomor terbesar', async () => {
    expect(await latestBundle(env.DB)).toBeNull();
    await insertBundle(1);
    await insertBundle(2);
    expect(await duplicateKeyOf(insertBundle(2))).toBe('cl_bundles_number');
    const latest = await latestBundle(env.DB);
    expect(latest?.number).toBe(2);
    expect(latest?.sourceNumber).toBeNull();
    expect(latest?.minApp).toBe('0.0.0');
  });
});
