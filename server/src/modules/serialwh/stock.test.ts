import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
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
const call = async (email: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, 'serialWarehouse.readyStock', input)) as CallOut;

let counter = 0;

/** Pencatatan ready langsung ke basis data (tanpa lewat submit). */
async function readyDispatch(
  id: string,
  options: { status?: string; buId?: string; itemId?: string; on?: string } = {},
): Promise<void> {
  counter += 1;
  await env.DB.prepare(
    "INSERT INTO warehouse_dispatches (id, number, order_id, client_id, item_id, dispatched_on, note, mode, kind, bu_id, status, header_hash, chunk_size, chunk_count, chunks_received, serial_total, created_count, created_at, created_by, completed_at, cancelled_at) VALUES (?, ?, '', ?, ?, ?, '', 'clipboard', 'ready', ?, ?, 'h', 200, 1, 1, 1, 0, 'x', 'x', '', '')",
  )
    .bind(
      id,
      `RS/T/${counter}`,
      `cid-${id}`,
      options.itemId ?? 'i-a1',
      options.on ?? '2026-11-12',
      options.buId ?? 'bu-a',
      options.status ?? 'done',
    )
    .run();
}

interface BoxSeed {
  id: string;
  number: number;
  capacity: number;
  /** Nomor serial yang ada di kardus (urut = `seq`). */
  serials: string[];
  /** Nomor serial di antaranya yang sudah dilepas ke pengeluaran Penjualan. */
  released?: string[];
  dispatch?: string;
  buId?: string;
  itemId?: string;
  deleted?: string[];
}

async function box(seed: BoxSeed): Promise<void> {
  const dispatch = seed.dispatch ?? 'rd1';
  await env.DB.prepare(
    "INSERT INTO warehouse_ready_boxes (id, bu_id, item_id, number, capacity, dispatch_id, closed_key, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, '', 'x', 'x')",
  )
    .bind(seed.id, seed.buId ?? 'bu-a', seed.itemId ?? 'i-a1', seed.number, seed.capacity, dispatch)
    .run();
  await Promise.all(
    seed.serials.map(async (serial, index) => {
      const id = `id-${serial}`;
      await seedSerial(env, {
        id,
        serial,
        buId: seed.buId ?? 'bu-a',
        itemId: seed.itemId ?? 'i-a1',
      });
      if (seed.deleted?.includes(serial)) {
        await env.DB.prepare("UPDATE serials SET deleted_at = 'x' WHERE id = ?").bind(id).run();
      }
      await env.DB.prepare(
        'INSERT INTO warehouse_ready_serials (serial_id, box_id, dispatch_id, seq, released_dispatch_id) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(id, seed.id, dispatch, index, seed.released?.includes(serial) ? 'out1' : '')
        .run();
    }),
  );
}

const numbers = (data: Json): number[] => data.boxes.map((b: Json) => b.number);

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedWarehouseWorld(env);
  await readyDispatch('rd1');
});

describe('serialWarehouse.readyStock', () => {
  test('kardus penuh dulu lalu ecer; sisa dan jenis dihitung dari serial yang masih di stok', async () => {
    await box({ id: 'b1', number: 1, capacity: 3, serials: ['A-1', 'A-2', 'A-3'] });
    await box({
      id: 'b2',
      number: 2,
      capacity: 3,
      serials: ['B-1', 'B-2', 'B-3'],
      released: ['B-3'],
    });
    await box({ id: 'b3', number: 3, capacity: 2, serials: ['C-1'] });
    await box({ id: 'b4', number: 4, capacity: 2, serials: ['D-1', 'D-2'] });
    const out = await call(E, {});
    expect(out.ok).toBe(true);
    expect(numbers(out.data)).toEqual([1, 4, 2, 3]);
    expect(out.data.boxes.map((b: Json) => [b.kind, b.remaining, b.capacity])).toEqual([
      ['full', 3, 3],
      ['full', 2, 2],
      ['loose', 2, 3],
      ['loose', 1, 2],
    ]);
    const second = out.data.boxes[2];
    expect(second.serials.map((s: Json) => s.serial)).toEqual(['B-1', 'B-2']);
    expect(second.serials[0]).toMatchObject({
      id: 'id-B-1',
      boxId: 'b2',
      boxNumber: 2,
      capacity: 3,
      recordedOn: '2026-11-12',
      processing: false,
    });
    expect(out.data.boxes[0].itemId).toBe('i-a1');
    expect(out.data.boxes[0].itemLabel).not.toBe('');
    expect(out.data.totals).toEqual({ units: 8, fullBoxes: 2, looseBoxes: 2, maxBoxNumber: 4 });
    expect(out.data.nextCursor).toBeNull();
    expect(out.data.picked).toBeUndefined();
  });

  test('serial di pengeluaran Penjualan pending bertanda diproses dan tidak ikut picked', async () => {
    await box({ id: 'b1', number: 1, capacity: 3, serials: ['P-1', 'P-2', 'P-3'] });
    await env.DB.prepare(
      "INSERT INTO warehouse_dispatches (id, number, order_id, client_id, item_id, dispatched_on, note, mode, kind, bu_id, status, header_hash, chunk_size, chunk_count, chunks_received, serial_total, created_count, created_at, created_by, completed_at, cancelled_at) VALUES ('op', 'OUT/T/1', 'o1', 'cid-op', 'i-a1', '2026-11-12', '', 'clipboard', 'order', '', 'pending', 'h', 200, 2, 1, 2, 0, 'x', 'x', '', '')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO warehouse_dispatch_serials (dispatch_id, order_id, serial_id, serial, seq, created_new) VALUES ('op', 'o1', 'id-P-2', 'P-2', 0, 0)",
    ).run();
    const out = await call(E, { pickCount: 5 });
    const rows = out.data.boxes[0].serials;
    expect(rows.map((s: Json) => [s.serial, s.processing])).toEqual([
      ['P-1', false],
      ['P-2', true],
      ['P-3', false],
    ]);
    expect(out.data.picked).toEqual(['id-P-1', 'id-P-3']);
    expect(out.data.totals.units).toBe(3);
  });

  test('pengeluaran Penjualan yang sudah selesai tidak menandai diproses', async () => {
    await box({ id: 'b1', number: 1, capacity: 2, serials: ['Q-1', 'Q-2'] });
    await env.DB.prepare(
      "INSERT INTO warehouse_dispatches (id, number, order_id, client_id, item_id, dispatched_on, note, mode, kind, bu_id, status, header_hash, chunk_size, chunk_count, chunks_received, serial_total, created_count, created_at, created_by, completed_at, cancelled_at) VALUES ('od', 'OUT/T/2', 'o2', 'cid-od', 'i-a1', '2026-11-12', '', 'clipboard', 'order', '', 'cancelled', 'h', 200, 1, 1, 1, 0, 'x', 'x', '', 'x')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO warehouse_dispatch_serials (dispatch_id, order_id, serial_id, serial, seq, created_new) VALUES ('od', 'o2', 'id-Q-1', 'Q-1', 0, 0)",
    ).run();
    const out = await call(E, {});
    expect(out.data.boxes[0].serials.map((s: Json) => s.processing)).toEqual([false, false]);
  });

  test('filter itemIds dan query (serial dan nomor kardus)', async () => {
    await box({ id: 'b1', number: 1, capacity: 2, serials: ['F-1', 'F-2'] });
    await box({ id: 'b2', number: 2, capacity: 2, serials: ['G-1', 'G-2'], itemId: 'i-a2' });
    expect(numbers((await call(E, { itemIds: ['i-a2'] })).data)).toEqual([2]);
    expect(numbers((await call(E, { itemIds: ['i-a1', 'i-a2'] })).data)).toEqual([1, 2]);
    // Pencarian serial menampilkan seluruh kardusnya, bukan hanya serial yang cocok.
    const bySerial = await call(E, { query: 'g-2' });
    expect(numbers(bySerial.data)).toEqual([2]);
    expect(bySerial.data.boxes[0].serials).toHaveLength(2);
    expect(bySerial.data.totals.units).toBe(2);
    await box({ id: 'b7', number: 7, capacity: 1, serials: ['Z-A'] });
    expect(numbers((await call(E, { query: '7' })).data)).toEqual([7]);
    expect(numbers((await call(E, { query: 'F-' })).data)).toEqual([1]);
    expect(numbers((await call(E, { query: 'tidak-ada' })).data)).toEqual([]);
  });

  test('paginasi menurut kardus: tanpa memotong kardus dan tanpa tumpang tindih; totals tidak bergantung halaman', async () => {
    await box({ id: 'b1', number: 1, capacity: 2, serials: ['N-1', 'N-2'] });
    await box({ id: 'b2', number: 2, capacity: 2, serials: ['N-3', 'N-4'] });
    await box({ id: 'b3', number: 3, capacity: 3, serials: ['N-5', 'N-6'] });
    await box({ id: 'b4', number: 4, capacity: 3, serials: ['N-7'] });
    const page1 = await call(E, { limit: 2 });
    expect(numbers(page1.data)).toEqual([1, 2]);
    expect(page1.data.nextCursor).not.toBeNull();
    expect(page1.data.boxes.every((b: Json) => b.serials.length === b.remaining)).toBe(true);
    const page2 = await call(E, { limit: 2, cursor: page1.data.nextCursor });
    expect(numbers(page2.data)).toEqual([3, 4]);
    expect(page2.data.nextCursor).toBeNull();
    for (const page of [page1, page2]) {
      expect(page.data.totals).toEqual({ units: 7, fullBoxes: 2, looseBoxes: 2, maxBoxNumber: 4 });
    }
    const bad = await call(E, { cursor: 'rusak' });
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe('VALIDATION');
  });

  test('pickCount memilih menurut urutan kardus atas seluruh stok terfilter', async () => {
    await box({ id: 'b1', number: 1, capacity: 3, serials: ['K-1', 'K-2', 'K-3'] });
    await box({ id: 'b2', number: 2, capacity: 3, serials: ['K-4', 'K-5', 'K-6'] });
    await box({ id: 'b3', number: 3, capacity: 3, serials: ['K-7', 'K-8', 'K-9'] });
    await box({ id: 'b4', number: 4, capacity: 3, serials: ['K-10', 'K-11'] });
    const out = await call(E, { pickCount: 11, limit: 1 });
    expect(out.data.boxes).toHaveLength(1);
    expect(out.data.picked).toEqual([
      'id-K-1',
      'id-K-2',
      'id-K-3',
      'id-K-4',
      'id-K-5',
      'id-K-6',
      'id-K-7',
      'id-K-8',
      'id-K-9',
      'id-K-10',
      'id-K-11',
    ]);
    expect(out.data.totals).toEqual({ units: 11, fullBoxes: 3, looseBoxes: 1, maxBoxNumber: 4 });
    const fewer = await call(E, { pickCount: 4 });
    expect(fewer.data.picked).toEqual(['id-K-1', 'id-K-2', 'id-K-3', 'id-K-4']);
  });

  test('hak: BU lain kosong, tanpa serialwh view ditolak, serial terhapus dan ready pending tidak tampil', async () => {
    await readyDispatch('rd-pending', { status: 'pending' });
    await box({
      id: 'b1',
      number: 1,
      capacity: 3,
      serials: ['H-1', 'H-2', 'H-3'],
      deleted: ['H-3'],
    });
    await box({
      id: 'b2',
      number: 2,
      capacity: 1,
      serials: ['H-4'],
      dispatch: 'rd-pending',
    });
    const out = await call(E, {});
    expect(numbers(out.data)).toEqual([1]);
    expect(out.data.boxes[0].remaining).toBe(2);
    expect(out.data.boxes[0].kind).toBe('loose');
    expect(out.data.totals.units).toBe(2);
    // BU lain: daftar kosong (bukan galat) dan filter BU tidak melebarkan hak.
    const other = await call(WH_USERS.editB, {});
    expect(other.ok).toBe(true);
    expect(other.data.boxes).toEqual([]);
    expect(other.data.totals).toEqual({ units: 0, fullBoxes: 0, looseBoxes: 0, maxBoxNumber: 0 });
    const widen = await call(WH_USERS.editB, { buIds: ['bu-a'] });
    expect(widen.data.boxes).toEqual([]);
    const narrow = await call(WH_USERS.both, { buIds: ['bu-b'] });
    expect(narrow.data.boxes).toEqual([]);
    // Pembaca (view) boleh; tanpa serialwh sama sekali ditolak.
    expect((await call(WH_USERS.view, {})).ok).toBe(true);
    const denied = await call(WH_USERS.serialOnly, {});
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe('FORBIDDEN');
  });

  test('maxBoxNumber memuat kardus terbuka tanpa stok dan dari pencatatan pending; kardus tertutup tidak', async () => {
    await readyDispatch('rd-pending', { status: 'pending' });
    await box({ id: 'b1', number: 2, capacity: 2, serials: ['M-1', 'M-2'] });
    // Pending: tidak tampil di daftar, tetapi nomornya dipegang.
    await box({ id: 'b2', number: 9, capacity: 1, serials: ['M-3'], dispatch: 'rd-pending' });
    // Terbuka tanpa stok terlihat (pencatatan pending yang serialnya sudah dilepas): tetap memegang nomor.
    await box({
      id: 'b3',
      number: 12,
      capacity: 1,
      serials: ['M-4'],
      released: ['M-4'],
      dispatch: 'rd-pending',
    });
    // Tertutup: tidak dihitung.
    await box({ id: 'b4', number: 40, capacity: 1, serials: ['M-5'], released: ['M-5'] });
    await env.DB.prepare(
      "UPDATE warehouse_ready_boxes SET closed_key = 'out1' WHERE id = 'b4'",
    ).run();
    // Kardus Tipe lain tidak ikut saat difilter Tipe.
    await box({ id: 'b5', number: 77, capacity: 1, serials: ['M-6'], itemId: 'i-a2' });
    const out = await call(E, { itemIds: ['i-a1'] });
    expect(numbers(out.data)).toEqual([2]);
    expect(out.data.totals.maxBoxNumber).toBe(12);
    expect((await call(E, {})).data.totals.maxBoxNumber).toBe(77);
    expect((await call(WH_USERS.editB, {})).data.totals.maxBoxNumber).toBe(0);
    // Hasil kosong karena pencarian: nomor tetap dari seluruh kardus terbuka BU + Tipe.
    expect(
      (await call(E, { itemIds: ['i-a1'], query: 'tidak-ada' })).data.totals.maxBoxNumber,
    ).toBe(12);
  });

  test('kardus membawa BU dan halaman membawa itemFacets (tidak diiris itemIds, diiris BU terbaca)', async () => {
    await box({ id: 'b1', number: 1, capacity: 1, serials: ['F-1'] });
    await box({ id: 'b2', number: 2, capacity: 1, serials: ['F-2'], itemId: 'i-a2' });
    const out = await call(WH_USERS.view, { itemIds: ['i-a1'] });
    expect(out.ok).toBe(true);
    expect(numbers(out.data)).toEqual([1]);
    const first = out.data.boxes[0];
    expect(first.buId).toBe('bu-a');
    expect(first.buCode).not.toBe('');
    expect(first.buName).not.toBe('');
    const facets = out.data.itemFacets as { id: string; label: string }[];
    expect(facets.map((f) => f.id).sort()).toEqual(['i-a1', 'i-a2']);
    expect(facets.every((f) => f.label !== '')).toBe(true);
    const labels = facets.map((f) => f.label);
    expect([...labels].sort((a, b) => a.localeCompare(b))).toEqual(labels);
    // BU lain tidak terbaca: tanpa facet.
    expect((await call(WH_USERS.editB, {})).data.itemFacets).toEqual([]);
  });

  test('validasi masukan', async () => {
    expect((await call(E, { limit: 0 })).ok).toBe(false);
    expect((await call(E, { limit: 51 })).ok).toBe(false);
    expect((await call(E, { pickCount: 0 })).ok).toBe(false);
    expect((await call(E, { pickCount: 5001 })).ok).toBe(false);
    expect((await call(E, { pickCount: 5000 })).ok).toBe(true);
  });
});
