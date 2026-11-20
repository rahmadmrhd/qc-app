// Tes skrip penyatuan serial ganda lintas BU (spek serial unik se-sistem §8 butir 2) terhadap MariaDB nyata.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { ensureSerialUniqueIndex } from '@server/modules/serial/bu-history';
import { seedBusinessUnit } from '@server-test/access-fixtures';
import { seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  type DupRow,
  findDuplicateGroups,
  mergeSerial,
  parseArgs,
  planAll,
  planGroup,
  reportCsv,
} from './merge-duplicate-serials';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk baris beragam, diperiksa per tes
type Json = any;

const NOW = '2026-11-20T01:00:00.000Z';
let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await seedSerialWorld(env);
  // Keadaan sebelum penyatuan: indeks unik belum ada (ada serial ganda lintas BU).
  await env.DB.prepare('DROP INDEX IF EXISTS serials_serial ON serials').run();
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, '')",
  ).run();
});

afterEach(async () => {
  // Skema dipakai bersama tes lain dalam proses ini: kembalikan indeks unik.
  await env.DB.prepare('DELETE FROM serials').run();
  await env.DB.prepare(
    'CREATE UNIQUE INDEX IF NOT EXISTS serials_serial ON serials (serial)',
  ).run();
});

const event = (
  id: string,
  serialId: string,
  seq: number,
  type: string,
  createdAt: string,
  caseId = '',
  clientId: string | null = null,
) =>
  env.DB.prepare(
    "INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json, client_id) VALUES (?, ?, ?, ?, ?, '2026-11-01', ?, '', 'X', 'qc', '', '[]', '{}', ?)",
  )
    .bind(id, serialId, caseId, seq, type, createdAt, clientId)
    .run();

/** Dua catatan DUP-1: sn-a (BU A, lama, tanpa laporan) dan sn-b (BU B, baru, dengan laporan aktif). */
async function seedDuplicate(): Promise<void> {
  await seedSerial(env, {
    id: 'sn-a',
    serial: 'DUP-1',
    createdAt: '2026-11-01T00:00:00.000Z',
    testDate: '2026-11-01',
    stickers: [{ stickerId: 's1', qty: 1 }],
  });
  await seedSerial(env, {
    id: 'sn-b',
    serial: 'DUP-1',
    buId: 'bu-b',
    itemId: 'i-b',
    createdAt: '2026-11-05T00:00:00.000Z',
    testDate: '2026-11-05',
    status: 'reported',
    openCase: { id: 'case-b', number: 'LP/B/2611-0001', openedOn: '2026-11-06' },
    stickers: [
      { stickerId: 's1', qty: 2 },
      { stickerId: 's2', qty: 1 },
    ],
  });
}

const one = async <T>(sql: string, ...binds: unknown[]): Promise<T | null> =>
  env.DB.prepare(sql)
    .bind(...binds)
    .first<T>();
const all = async <T>(sql: string, ...binds: unknown[]): Promise<T[]> =>
  (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<T>()
  ).results;
const count = async (table: string): Promise<number> =>
  Number((await one<{ n: number | string }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n);

describe('pemilihan pemenang (murni)', () => {
  const row = (over: Partial<DupRow>): DupRow => ({
    id: 'x',
    buId: 'bu-a',
    buCode: 'A',
    serial: 'S',
    itemId: 'i',
    testDate: '2026-11-01',
    status: 'good',
    openCaseId: '',
    createdAt: '',
    ...over,
  });

  test('laporan aktif menang atas Rusak dan yang terbaru; Rusak menang atas yang terbaru; lalu tanggal uji, lalu id', () => {
    const a = row({ id: 'a', testDate: '2026-11-09' });
    const b = row({ id: 'b', status: 'broken', testDate: '2026-11-01' });
    const c = row({ id: 'c', status: 'reported', openCaseId: 'k', testDate: '2026-10-01' });
    const plan = planGroup('S', [a, b, c]);
    expect(plan).toMatchObject({ kind: 'merge', reason: 'laporan-aktif' });
    expect(plan.kind === 'merge' && plan.winner.id).toBe('c');
    const broken = planGroup('S', [a, b]);
    expect(broken.kind === 'merge' && [broken.reason, broken.winner.id]).toEqual(['rusak', 'b']);
    const newest = planGroup('S', [row({ id: 'p' }), row({ id: 'q' }), a]);
    expect(newest.kind === 'merge' && [newest.reason, newest.winner.id]).toEqual(['terbaru', 'a']);
    const byId = planGroup('S', [row({ id: 'p' }), row({ id: 'q' })]);
    expect(byId.kind === 'merge' && byId.winner.id).toBe('q');
  });

  test('lebih dari satu catatan dengan laporan aktif: perlu manual', () => {
    const plan = planGroup('S', [
      row({ id: 'a', openCaseId: 'k1' }),
      row({ id: 'b', openCaseId: 'k2' }),
    ]);
    expect(plan.kind).toBe('manual');
  });

  test('argumen: bawaan dry-run; --apply membawa --confirm-database', () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      confirmDatabase: '',
      reportDir: './merge-serials-report',
    });
    expect(parseArgs(['--apply', '--confirm-database', 'qc', '--report-dir', 'x'])).toEqual({
      apply: true,
      confirmDatabase: 'qc',
      reportDir: 'x',
    });
    expect(() => parseArgs(['--aneh'])).toThrow();
  });
});

describe('penyatuan ke MariaDB', () => {
  test('uji coba (hanya baca): menemukan kelompok dan rencana tanpa mengubah apa pun', async () => {
    await seedDuplicate();
    const before = await count('serials');
    const plans = planAll(await findDuplicateGroups(env.DB));
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ kind: 'merge', reason: 'laporan-aktif' });
    const csv = reportCsv(plans, false);
    expect(csv).toContain('rencana');
    expect(csv.split('\n')[0]).toBe(
      'serial,id_pemenang,bu_pemenang,alasan_pemenang,id_dilipat,bu_dilipat,hasil',
    );
    expect(await count('serials')).toBe(before);
    expect(await count('serial_business_units')).toBe(2);
    expect(await ensureSerialUniqueIndex(env)).toBe('duplicates');
  });

  test('terapkan: seluruh data kalah pindah ke pemenang; kejadian disusun ulang menurut waktu; indeks unik terbentuk', async () => {
    await seedDuplicate();
    // Kejadian lanjutan pemenang (kasus aktif) dan data terkait catatan yang kalah.
    await event('sn-b-e2', 'sn-b', 2, 'report_failure', '2026-11-06T00:00:00.000Z', 'case-b');
    await event('sn-a-e2', 'sn-a', 2, 'recheck', '2026-11-03T00:00:00.000Z', '', 'client-a2');
    await env.DB.prepare(
      "INSERT INTO sticker_stock_entries (sticker_id, location_id, kind, delta, qty_after, count_json, reason, actor, ts, serial_id, serial_event_id) VALUES ('s1', 'loc-sby', 'serial', -1, 9, '', '', 'x', '2026-11-03', 'sn-a', 'sn-a-e2')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO serial_proof_photos (id, serial_id, event_id, state, created_by) VALUES ('p1', 'sn-a', 'sn-a-e2', 'done', 'x@gmail.com')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO notifications (id, recipient, kind, serial_id) VALUES ('n1', 'x@gmail.com', 'serialProofFailed', 'sn-a')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO files (id, owner_type, owner_id, status) VALUES ('f1', 'serial', 'sn-a', 'active'), ('f2', 'serialproof', 'sn-a', 'active')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO serial_cases (id, number, serial_id, bu_id, opened_on, closed_on, outcome) VALUES ('case-a-old', 'LP/A/2610-0001', 'sn-a', 'bu-a', '2026-10-10', '2026-10-11', 'good')",
    ).run();

    const outcome = await mergeSerial(env.DB, 'DUP-1', NOW);
    expect(outcome.kind).toBe('merged');

    // Satu catatan tersisa: pemenang (laporan aktif).
    expect(await all<Json>('SELECT id, bu_id, open_case_id FROM serials')).toEqual([
      { id: 'sn-b', bu_id: 'bu-b', open_case_id: 'case-b' },
    ]);
    // Kejadian: semua di pemenang, seq 1..5 berurutan menurut waktu, penanda di awal riwayat catatan yang kalah.
    const events = await all<Json>(
      'SELECT id, seq, type, serial_id, client_id, message, data_json FROM serial_events ORDER BY seq',
    );
    expect(events.map((e) => [e.seq, e.id.startsWith('sn-') ? e.id : e.type])).toEqual([
      [1, 'note'],
      [2, 'sn-a-e1'],
      [3, 'sn-a-e2'],
      [4, 'sn-b-e1'],
      [5, 'sn-b-e2'],
    ]);
    expect(new Set(events.map((e) => e.serial_id))).toEqual(new Set(['sn-b']));
    expect(events[0]).toMatchObject({ message: 'Digabung dari BU A', type: 'note' });
    expect(JSON.parse(events[0].data_json).mergedFrom).toMatchObject({
      serialId: 'sn-a',
      buCode: 'A',
    });
    expect(events.find((e) => e.id === 'sn-a-e2')?.client_id).toBe('client-a2');
    // Kasus, stiker (dijumlahkan), stok, foto, notifikasi, gambar pesan: ke pemenang.
    expect(
      (await all<Json>('SELECT id, serial_id FROM serial_cases ORDER BY id')).map((c) => [
        c.id,
        c.serial_id,
      ]),
    ).toEqual([
      ['case-a-old', 'sn-b'],
      ['case-b', 'sn-b'],
    ]);
    expect(
      await all<Json>('SELECT sticker_id, qty FROM serial_stickers ORDER BY sticker_id'),
    ).toEqual([
      { sticker_id: 's1', qty: 3 },
      { sticker_id: 's2', qty: 1 },
    ]);
    expect(await count('sticker_stock_entries')).toBe(1);
    for (const [table, column] of [
      ['sticker_stock_entries', 'serial_id'],
      ['serial_proof_photos', 'serial_id'],
      ['notifications', 'serial_id'],
    ]) {
      expect((await one<Json>(`SELECT ${column} AS v FROM ${table}`))?.v).toBe('sn-b');
    }
    expect(
      (await all<Json>("SELECT owner_id FROM files WHERE id IN ('f1', 'f2') ORDER BY id")).map(
        (f) => f.owner_id,
      ),
    ).toEqual(['sn-b', 'sn-b']);
    // Riwayat BU: BU catatan yang kalah ditinggalkan; BU pemenang tetap saat ini.
    const history = await all<Json>(
      'SELECT serial_id, bu_id, left_at FROM serial_business_units ORDER BY bu_id',
    );
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ serial_id: 'sn-b', bu_id: 'bu-a' });
    expect(history[0].left_at).toBe(NOW);
    expect(history[1]).toMatchObject({ serial_id: 'sn-b', bu_id: 'bu-b', left_at: '' });
    // Indeks unik kini dapat dibuat; menjalankan ulang tidak menemukan apa pun.
    expect(await ensureSerialUniqueIndex(env)).toBe('created');
    expect((await mergeSerial(env.DB, 'DUP-1', NOW)).kind).toBe('gone');
  });

  test('tanpa laporan aktif atau Rusak: yang terbaru menang; tiga catatan sekaligus', async () => {
    await seedSerial(env, {
      id: 'old',
      serial: 'TRI-1',
      testDate: '2026-10-01',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    await seedSerial(env, {
      id: 'mid',
      serial: 'TRI-1',
      buId: 'bu-b',
      itemId: 'i-b',
      testDate: '2026-10-15',
      createdAt: '2026-10-15T00:00:00.000Z',
    });
    await seedBusinessUnit(env, { id: 'bu-c', code: 'C' });
    await seedSerial(env, {
      id: 'new',
      serial: 'TRI-1',
      buId: 'bu-c',
      testDate: '2026-11-10',
      createdAt: '2026-11-10T00:00:00.000Z',
    });
    // Catatan lama tanpa baris riwayat (ditulis image lama): BU-nya tetap harus ikut tercatat.
    await env.DB.prepare("DELETE FROM serial_business_units WHERE serial_id = 'old'").run();
    expect((await mergeSerial(env.DB, 'TRI-1', NOW)).kind).toBe('merged');
    expect((await all<Json>('SELECT id FROM serials')).map((r) => r.id)).toEqual(['new']);
    const events = await all<Json>('SELECT id, seq, type FROM serial_events ORDER BY seq');
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(events.filter((e) => e.type === 'note')).toHaveLength(2);
    const history = await all<Json>(
      'SELECT bu_id, left_at FROM serial_business_units WHERE serial_id = ? ORDER BY bu_id',
      'new',
    );
    expect(history.map((h) => h.bu_id)).toEqual(['bu-a', 'bu-b', 'bu-c']);
    expect(history.map((h) => h.left_at)).toEqual([NOW, NOW, '']);
    expect(await ensureSerialUniqueIndex(env)).toBe('created');
  });

  test('dua laporan aktif: dilewati tanpa mengubah apa pun, indeks tetap tidak dibuat', async () => {
    await seedSerial(env, {
      id: 'ma',
      serial: 'MAN-1',
      status: 'reported',
      openCase: { id: 'ca', number: 'LP/A/2611-0001' },
    });
    await seedSerial(env, {
      id: 'mb',
      serial: 'MAN-1',
      buId: 'bu-b',
      itemId: 'i-b',
      status: 'reported',
      openCase: { id: 'cb', number: 'LP/B/2611-0001' },
    });
    const outcome = await mergeSerial(env.DB, 'MAN-1', NOW);
    expect(outcome.kind).toBe('manual');
    expect(await count('serials')).toBe(2);
    expect(await count('serial_events')).toBe(2);
    expect(await ensureSerialUniqueIndex(env)).toBe('duplicates');
  });

  test('kegagalan di langkah terakhir membatalkan seluruh perubahan serial itu (satu transaksi)', async () => {
    await seedDuplicate();
    await event('sn-a-e2', 'sn-a', 2, 'recheck', '2026-11-03T00:00:00.000Z');
    // Penghapusan catatan yang kalah dibuat gagal: semua langkah sebelumnya sudah berjalan di dalam transaksi.
    await env.DB.exec(
      "CREATE TRIGGER merge_test_fail BEFORE DELETE ON serials FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'gagal uji'",
    );
    try {
      await expect(mergeSerial(env.DB, 'DUP-1', NOW)).rejects.toThrow();
    } finally {
      await env.DB.exec('DROP TRIGGER IF EXISTS merge_test_fail');
    }
    expect(await count('serials')).toBe(2);
    expect(
      await all<Json>(
        "SELECT id, serial_id, seq FROM serial_events WHERE serial_id = 'sn-a' ORDER BY seq",
      ),
    ).toEqual([
      { id: 'sn-a-e1', serial_id: 'sn-a', seq: 1 },
      { id: 'sn-a-e2', serial_id: 'sn-a', seq: 2 },
    ]);
    expect(await count('serial_events')).toBe(3);
    expect(await all<Json>("SELECT qty FROM serial_stickers WHERE serial_id = 'sn-a'")).toEqual([
      { qty: 1 },
    ]);
    expect(
      (await one<Json>("SELECT COUNT(*) AS n FROM serial_cases WHERE serial_id = 'sn-b'"))?.n,
    ).toBe(1);
    expect(await count('serial_business_units')).toBe(2);
  });
});
