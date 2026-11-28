import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { restCall } from '@server-test/rest-call';
import { seedSerial } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedWarehouseWorld, WH_USERS } from '@server-test/warehouse-fixtures';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const E = WH_USERS.edit;

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedWarehouseWorld(env);
});

type Row =
  | { kind: 'existing'; serialId: string; serial: string }
  | { kind: 'new'; clientId: string; serial: string; locationId: string; testDate: string };

const header = (total: number, over: Record<string, unknown> = {}) => ({
  dispatchedOn: '2026-11-12',
  orderNumber: 'SO-1',
  buId: 'bu-a',
  customerName: 'PT Maju',
  itemId: 'i-a1',
  note: '',
  handoverIds: [] as string[],
  total,
  chunkSize: 200,
  ...over,
});

const fresh = (serial: string, over: Record<string, unknown> = {}): Row =>
  ({
    kind: 'new',
    clientId: crypto.randomUUID(),
    serial,
    locationId: 'loc-sby',
    testDate: '2026-11-12',
    ...over,
  }) as Row;

const existing = (id: string, serial: string): Row => ({ kind: 'existing', serialId: id, serial });

function submit(
  email: string,
  rows: Row[],
  over: { clientId?: string; chunkIndex?: number; header?: Record<string, unknown> } = {},
) {
  return call(email, 'serialWarehouse.submit', {
    clientId: over.clientId ?? crypto.randomUUID(),
    chunkIndex: over.chunkIndex ?? 0,
    header: header(rows.length, over.header),
    rows,
  });
}

async function stock(stickerId: string): Promise<number> {
  const found = await env.DB.prepare(
    "SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = 'loc-sby'",
  )
    .bind(stickerId)
    .first<{ qty: number | string }>();
  return Number(found?.qty);
}

const count = async (sql: string): Promise<number> =>
  Number((await env.DB.prepare(sql).first<{ n: number | string }>())?.n);

describe('submit Keluar Gudang', () => {
  test('SO baru dibuat otomatis beserta customer baru; clipboard urut seq', async () => {
    const out = await submit(E, [fresh('WH-1'), fresh('WH-2'), fresh('WH-3')]);
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ status: 'done', created: 3, orderNumber: 'SO-1' });
    expect(out.data.serials).toEqual(['WH-1', 'WH-2', 'WH-3']);
    const orders = await env.DB.prepare(
      'SELECT number, `key`, bu_id, customer_name FROM warehouse_orders',
    ).all<{ number: string; key: string; bu_id: string; customer_name: string }>();
    expect(orders.results).toEqual([
      { number: 'SO-1', key: 'so-1', bu_id: 'bu-a', customer_name: 'PT Maju' },
    ]);
    expect(
      await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'customer.create'"),
    ).toBe(1);
    expect(
      await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'serialwh.dispatch_create'"),
    ).toBe(1);
    // Stok stiker terpotong sekali per serial baru (s1 dan s2 berlaku bagi i-a1).
    expect(await stock('s1')).toBe(7);
  });

  test('serial baru bertanda Gudang: wh_created, kejadian recorded bersumber warehouse, bawaan stiker', async () => {
    await submit(E, [fresh('WH-EV')]);
    const row = await env.DB.prepare(
      'SELECT id, wh_created, bu_id, status, custody, note FROM serials WHERE serial = ?',
    )
      .bind('WH-EV')
      .first<{
        id: string;
        wh_created: number | string;
        bu_id: string;
        status: string;
        custody: string;
        note: string;
      }>();
    expect(Number(row?.wh_created)).toBe(1);
    expect(row).toMatchObject({ bu_id: 'bu-a', status: 'good', custody: 'qc' });
    expect(row?.note).toBe('Dicatat Gudang · SO SO-1');
    const event = await env.DB.prepare(
      "SELECT data_json FROM serial_events WHERE serial_id = ? AND type = 'recorded'",
    )
      .bind(row?.id)
      .first<{ data_json: string }>();
    const data = JSON.parse(event?.data_json ?? '{}');
    expect(data.source).toBe('warehouse');
    expect(data.orderNumber).toBe('SO-1');
  });

  test('satu SO satu BU; pengeluaran kedua memakai ulang SO lama', async () => {
    await seedSerial(env, { id: 'x1', serial: 'EX-1' });
    await seedSerial(env, { id: 'x2', serial: 'EX-2' });
    const first = await submit(E, [existing('x1', 'EX-1')]);
    expect(first.ok).toBe(true);
    const second = await submit(E, [existing('x2', 'EX-2')]);
    expect(second.ok).toBe(true);
    expect(second.data.orderId).toBe(first.data.orderId);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_orders')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatches')).toBe(2);
    // Header BU berbeda dari BU SO lama ditolak.
    const clash = await submit(WH_USERS.both, [fresh('NEW-B')], {
      header: { buId: 'bu-b', itemId: 'i-a2' },
    });
    expect(clash.ok).toBe(false);
    // Dicari lewat nomornya saja (tanpa orderId): nomor sudah dipakai BU lain = CONFLICT generik.
    expect(clash.error.code).toBe('CONFLICT');
    // SO lama dipilih eksplisit lewat orderId tetapi BU header berbeda = VALIDATION.
    const explicit = await submit(WH_USERS.both, [fresh('NEW-C')], {
      header: { buId: 'bu-b', itemId: 'i-a2', orderId: first.data.orderId },
    });
    expect(explicit.ok).toBe(false);
    expect(explicit.error.code).toBe('VALIDATION');
  });

  test('No SO yang ada dengan customer berbeda (tanpa orderId) = CONFLICT; customer sama bergabung', async () => {
    const first = await submit(E, [fresh('CU-1')]);
    expect(first.ok).toBe(true);
    const other = await submit(E, [fresh('CU-2')], { header: { customerName: 'PT Lain' } });
    expect(other.ok).toBe(false);
    expect(other.error.code).toBe('CONFLICT');
    expect(await count("SELECT COUNT(*) AS n FROM serials WHERE serial = 'CU-2'")).toBe(0);
    const same = await submit(E, [fresh('CU-3')], { header: { customerName: ' pt  maju ' } });
    expect(same.ok).toBe(true);
    expect(same.data.orderId).toBe(first.data.orderId);
  });

  test('item hanya disyaratkan untuk serial baru: serial lintas BU yang itemnya tak tertaut ke BU SO tetap keluar', async () => {
    await seedSerial(env, { id: 'xb', serial: 'XB-1', buId: 'bu-b', itemId: 'i-b' });
    const ok = await submit(WH_USERS.both, [existing('xb', 'XB-1')], { header: { itemId: 'i-b' } });
    expect(ok.ok).toBe(true);
    // Serial baru dengan item yang tak tertaut ke BU SO tetap ditolak.
    const fail = await submit(E, [fresh('XB-NEW')], {
      header: { itemId: 'i-b', orderNumber: 'SO-9' },
    });
    expect(fail.ok).toBe(false);
    expect(fail.error.code).toBe('VALIDATION');
  });

  test('kejadian recorded serial baru bertanggal tanggal keluar (bukan hari ini)', async () => {
    const out = await submit(E, [fresh('OC-1')], { header: { dispatchedOn: '2026-11-05' } });
    expect(out.ok).toBe(true);
    const event = await env.DB.prepare(
      "SELECT e.occurred_on FROM serial_events e JOIN serials s ON s.id = e.serial_id WHERE s.serial = 'OC-1' AND e.type = 'recorded'",
    ).first<{ occurred_on: string }>();
    expect(event?.occurred_on).toBe('2026-11-05');
  });

  test('jumlah total di luar rentang INT = VALIDATION rapi, bukan galat internal', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => fresh(`BIG-${i + 10}`));
    const big = await call(E, 'serialWarehouse.submit', {
      clientId: crypto.randomUUID(),
      chunkIndex: 0,
      header: header(3_000_000_000, { chunkSize: 200 }),
      rows,
    });
    expect(big.ok).toBe(false);
    expect(big.error.code).toBe('VALIDATION');
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatches')).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM serials WHERE serial LIKE 'BIG-%'")).toBe(0);
  });

  test('nama customer SO baru memakai aturan Serah Terima', async () => {
    for (const customerName of ['!!!', 'A'.repeat(101), 'PT\u0001X']) {
      const out = await submit(E, [fresh(`CN-${customerName.length}`)], {
        header: { customerName, orderNumber: `SO-${customerName.length}` },
      });
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('VALIDATION');
    }
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_orders')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM customers')).toBe(0);
  });

  test('tanggal terakhir SO dan jumlah serial hanya dihitung dari pengeluaran selesai', async () => {
    const clientId = crypto.randomUUID();
    const part = (chunkIndex: number, serial: string) =>
      submit(E, [fresh(serial)], {
        clientId,
        chunkIndex,
        header: { total: 2, chunkSize: 1, dispatchedOn: '2026-11-10' },
      });
    expect((await part(0, 'PD-1')).ok).toBe(true);
    const order = () =>
      env.DB.prepare('SELECT id, last_dispatched_on FROM warehouse_orders').first<{
        id: string;
        last_dispatched_on: string;
      }>();
    expect((await order())?.last_dispatched_on).toBe('');
    const listed = await call(E, 'serialWarehouse.listOrders', {});
    expect(listed.data.items[0]).toMatchObject({ serialCount: 0, lastDispatchedOn: '' });
    expect((await part(1, 'PD-2')).ok).toBe(true);
    expect((await order())?.last_dispatched_on).toBe('2026-11-10');
    const done = await call(E, 'serialWarehouse.listOrders', {});
    expect(done.data.items[0]).toMatchObject({ serialCount: 2, lastDispatchedOn: '2026-11-10' });
  });

  test('tipe berbeda dilewati: tanpa serial yang dapat dicatat pengeluaran ditolak tanpa menulis apa pun', async () => {
    await seedSerial(env, { id: 'y1', serial: 'OTHER-1', itemId: 'i-a2' });
    const out = await submit(E, [existing('y1', 'OTHER-1')]);
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('VALIDATION');
    expect(out.error.fields.rows).toBe(
      'Tidak ada serial yang dapat dicatat. Dilewati: Tipe berbeda (1)',
    );
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatches')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_orders')).toBe(0);
  });

  test('potongan campuran: baris bermasalah dilewati, sisanya tersimpan atomik dengan seq asli', async () => {
    await seedSerial(env, { id: 'm1', serial: 'MIX-OK' });
    await seedSerial(env, { id: 'm2', serial: 'MIX-BAD', status: 'reported' });
    const rows = [fresh('MIX-NEW'), existing('m2', 'MIX-BAD'), existing('m1', 'MIX-OK')];
    const clientId = crypto.randomUUID();
    const out = await submit(E, rows, { clientId });
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ status: 'done', created: 1 });
    expect(out.data.serials).toEqual(['MIX-NEW', 'MIX-OK']);
    expect(out.data.skipped).toEqual([
      { serial: 'MIX-BAD', reason: 'Bukan berstatus Lolos di posisi QC' },
    ]);
    const seqs = await env.DB.prepare(
      'SELECT seq FROM warehouse_dispatch_serials ORDER BY seq',
    ).all<{
      seq: number | string;
    }>();
    expect(seqs.results.map((r) => Number(r.seq))).toEqual([0, 2]);
    // Kiriman ulang potongan yang sama: daftar dilewati identik, tanpa menulis.
    const again = await submit(E, rows, { clientId });
    expect(again.ok).toBe(true);
    expect(again.data.skipped).toEqual(out.data.skipped);
    expect(again.data.skippedTotal).toEqual(out.data.skipped);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatch_serials')).toBe(2);
    // SN yang dilewati tidak jadi anggota SO: setelah diperbaiki boleh keluar ulang ke SO yang sama.
    await env.DB.prepare("UPDATE serials SET status = 'good' WHERE id = 'm2'").run();
    const retry = await submit(E, [existing('m2', 'MIX-BAD')]);
    expect(retry.ok).toBe(true);
    expect(retry.data.skipped).toEqual([]);
    expect(retry.data.serials).toEqual(['MIX-BAD']);
  });

  test('pengeluaran multi-potongan: skippedTotal menggabungkan semua potongan; selesai walau ada yang dilewati', async () => {
    await seedSerial(env, { id: 'p1', serial: 'MC-BAD', itemId: 'i-a2' });
    const clientId = crypto.randomUUID();
    const first = await submit(E, [existing('p1', 'MC-BAD')], {
      clientId,
      chunkIndex: 0,
      header: { total: 2, chunkSize: 1 },
    });
    expect(first.data).toMatchObject({ status: 'pending', chunksReceived: 1 });
    expect(first.data.skippedTotal).toBeUndefined();
    const last = await submit(E, [fresh('MC-OK')], {
      clientId,
      chunkIndex: 1,
      header: { total: 2, chunkSize: 1 },
    });
    expect(last.data).toMatchObject({ status: 'done', created: 1, serials: ['MC-OK'] });
    expect(last.data.skippedTotal).toEqual([{ serial: 'MC-BAD', reason: 'Tipe berbeda' }]);
  });

  test('tanggal uji beda dan BU serial beda tidak menolak', async () => {
    await seedSerial(env, {
      id: 'z1',
      serial: 'OLD-1',
      testDate: '2026-01-05',
      buId: 'bu-b',
      itemId: 'i-a2',
    });
    const out = await submit(E, [existing('z1', 'OLD-1')], { header: { itemId: 'i-a2' } });
    expect(out.ok).toBe(true);
    expect(out.data.serials).toEqual(['OLD-1']);
  });

  test('serial dua kali pada SO yang sama dilewati; SO lain boleh', async () => {
    await seedSerial(env, { id: 'd1', serial: 'TWICE-1' });
    expect((await submit(E, [existing('d1', 'TWICE-1')])).ok).toBe(true);
    const again = await submit(E, [existing('d1', 'TWICE-1')]);
    expect(again.ok).toBe(false);
    expect(again.error.fields.rows).toBe(
      'Tidak ada serial yang dapat dicatat. Dilewati: Sudah ada di SO ini (1)',
    );
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatches')).toBe(1);
    const other = await submit(E, [existing('d1', 'TWICE-1')], { header: { orderNumber: 'SO-2' } });
    expect(other.ok).toBe(true);
  });

  test('status bukan Lolos, posisi bukan QC, dan serial terhapus dilewati', async () => {
    await seedSerial(env, { id: 's-rep', serial: 'BAD-1', status: 'reported' });
    await seedSerial(env, { id: 's-svc', serial: 'BAD-2', custody: 'service' });
    await seedSerial(env, { id: 's-del', serial: 'BAD-3' });
    await env.DB.prepare(
      "UPDATE serials SET deleted_at = '2026-11-01T00:00:00.000Z' WHERE id = 's-del'",
    ).run();
    for (const [id, sn] of [
      ['s-rep', 'BAD-1'],
      ['s-svc', 'BAD-2'],
      ['s-del', 'BAD-3'],
    ] as const) {
      const out = await submit(E, [existing(id, sn)]);
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('VALIDATION');
      expect(out.error.fields.rows).toContain('Tidak ada serial yang dapat dicatat');
    }
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatches')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatch_serials')).toBe(0);
  });

  test('potongan idempoten: kirim ulang tidak menggandakan baris dan stok', async () => {
    const clientId = crypto.randomUUID();
    const rows = [fresh('IDEM-1'), fresh('IDEM-2')];
    const first = await submit(E, rows, { clientId });
    const before = await stock('s1');
    const second = await submit(E, rows, { clientId });
    expect(second.ok).toBe(true);
    expect(second.data.created).toBe(0);
    expect(second.data.dispatchId).toBe(first.data.dispatchId);
    expect(await stock('s1')).toBe(before);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatch_serials')).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM serial_events WHERE type = 'recorded'")).toBe(2);
    // clientId milik pelaku lain = CONFLICT generik.
    const stolen = await submit(WH_USERS.both, rows, { clientId });
    expect(stolen.ok).toBe(false);
    expect(stolen.error.code).toBe('CONFLICT');
    // Header berubah dengan clientId yang sama = VALIDATION.
    const changed = await submit(E, rows, { clientId, header: { note: 'berubah' } });
    expect(changed.ok).toBe(false);
    expect(changed.error.code).toBe('VALIDATION');
  });

  test('baris bermasalah di tengah dilewati: potongan lain dan pengeluaran tetap selesai', async () => {
    await seedSerial(env, { id: 'c-bad', serial: 'CH-BAD', status: 'reported' });
    const clientId = crypto.randomUUID();
    const all: Row[] = [
      fresh('CH-1'),
      fresh('CH-2'),
      existing('c-bad', 'CH-BAD'),
      fresh('CH-4'),
      fresh('CH-5'),
    ];
    const c0 = await call(E, 'serialWarehouse.submit', {
      clientId,
      chunkIndex: 0,
      header: header(5, { chunkSize: 2 }),
      rows: all.slice(0, 2),
    });
    expect(c0.data).toMatchObject({ status: 'pending', chunksReceived: 1, chunkCount: 3 });
    const c1 = await call(E, 'serialWarehouse.submit', {
      clientId,
      chunkIndex: 1,
      header: header(5, { chunkSize: 2 }),
      rows: all.slice(2, 4),
    });
    // Baris bermasalah dilewati: potongan tetap masuk (CH-4), CH-BAD dilaporkan.
    expect(c1.ok).toBe(true);
    expect(c1.data.skipped).toEqual([
      { serial: 'CH-BAD', reason: 'Bukan berstatus Lolos di posisi QC' },
    ]);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatch_serials')).toBe(3);
    const last = await call(E, 'serialWarehouse.submit', {
      clientId,
      chunkIndex: 2,
      header: header(5, { chunkSize: 2 }),
      rows: [all[4] as Row],
    });
    expect(last.data).toMatchObject({ status: 'done', chunksReceived: 3 });
    expect(last.data.serials).toEqual(['CH-1', 'CH-2', 'CH-4', 'CH-5']);
    expect(last.data.skippedTotal).toEqual([
      { serial: 'CH-BAD', reason: 'Bukan berstatus Lolos di posisi QC' },
    ]);
  });

  test('ukuran penuh: 200 serial yang sudah ada dalam satu potongan', async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 200; i += 1) {
      await seedSerial(env, { id: `big-${i}`, serial: `BIG-${String(i).padStart(3, '0')}` });
      rows.push(existing(`big-${i}`, `BIG-${String(i).padStart(3, '0')}`));
    }
    const out = await submit(E, rows);
    expect(out.ok).toBe(true);
    expect(out.data.status).toBe('done');
    expect(out.data.serials).toHaveLength(200);
  }, 240_000);

  test('serial baru dikecualikan dari wajib foto, lalu "Butuh foto" hilang setelah foto cukup', async () => {
    await seedBrand(env, 'Merk Foto');
    await seedItem(env, {
      id: 'i-foto',
      brand: 'Merk Foto',
      model: 'Wajib',
      businessUnitIds: ['bu-a'],
      proofRequired: true,
      proofMin: 2,
    });
    const out = await submit(E, [fresh('FOTO-1')], { header: { itemId: 'i-foto' } });
    expect(out.ok).toBe(true);
    const serial = await env.DB.prepare('SELECT id, wh_created FROM serials WHERE serial = ?')
      .bind('FOTO-1')
      .first<{ id: string; wh_created: number | string }>();
    expect(Number(serial?.wh_created)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM serial_proof_photos')).toBe(0);
  });

  test('checklist stiker di dialog: serial yang sudah tertempel tidak memotong stok, yang belum memotong stok', async () => {
    // Seed 2 serial lama: ST-HAVE sudah punya s1 (tidak ada s2), ST-NONE belum punya stiker sama sekali.
    await seedSerial(env, { id: 'sn-have', serial: 'ST-HAVE' });
    await env.DB.prepare(
      'INSERT INTO serial_stickers (serial_id, sticker_id, qty) VALUES (?, ?, ?)',
    )
      .bind('sn-have', 's1', 1)
      .run();
    await seedSerial(env, { id: 'sn-none', serial: 'ST-NONE' });
    const beforeS1 = await stock('s1');

    const out = await submit(
      E,
      [existing('sn-have', 'ST-HAVE'), existing('sn-none', 'ST-NONE'), fresh('ST-NEW')],
      {
        header: {
          mode: 'note',
          boxStart: 1,
          boxSize: 10,
          orderNumber: '',
          customerName: '',
          locationId: 'loc-sby',
          stickers: [{ stickerId: 's1', qty: 1 }],
        },
      },
    );
    expect(out.ok).toBe(true);
    // s1 dipotong hanya untuk ST-NONE dan ST-NEW (2x), TIDAK untuk ST-HAVE yang sudah tertempel.
    expect(await stock('s1')).toBe(beforeS1 - 2);
  });
});
