import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { getRoutes } from '@server/routes';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppError, captureAppErrorAsync } from '@server-test/errors';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { StickerDto, StickerTypeDto } from '@shared/contract';
import { saveSticker, saveStickerType, setStickerStatus, setStickerTypeStatus } from './service';
import { adjustStock, listStickerStock, recordStock, stockHistory } from './stock-service';
import {
  validateAdjustStock,
  validateListStickerStock,
  validateRecordStock,
  validateStockHistory,
} from './validate';

setDefaultTimeout(60_000);

const A = 'loc-a';
const B = 'loc-b';
const OFF = 'loc-off';

let env: TestEnv;
let admin: UserContext;
let type: StickerTypeDto;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-09T00:00:00.000Z'));
  const ctx = await loadUserContext(env, 'admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
  await seedLocation(env, { id: A, code: 'A' });
  await seedLocation(env, { id: B, code: 'B' });
  await seedLocation(env, { id: OFF, code: 'X', status: 'inactive' });
  await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { stickerstock: 'view' } });
  await seedRole(env, { id: 'r-edit', name: 'Edit', permissions: { stickerstock: 'edit' } });
  await seedRole(env, { id: 'r-manage', name: 'Kelola', permissions: { stickerstock: 'manage' } });
  const assign = (id: string, email: string, roleId: string, locationId: string) =>
    seedUser(env, { id, email, assignments: [{ locationId, roleIds: [roleId] }] });
  await assign('u-view', 'view-a@gmail.com', 'r-view', A);
  await assign('u-edit', 'edit-a@gmail.com', 'r-edit', A);
  await assign('u-manage', 'manage-a@gmail.com', 'r-manage', A);
  type = await saveStickerType(env, { name: 'Umum', rule: 'none' }, admin);
});

let counter = 0;
async function newSticker(overrides: Record<string, unknown> = {}): Promise<StickerDto> {
  counter += 1;
  return saveSticker(
    env,
    {
      typeId: type.id,
      name: `Stiker ${counter}`,
      alias: '',
      fileId: null,
      minQty: 0,
      businessUnitIds: [],
      ...overrides,
    } as never,
    admin,
  );
}

const rec = (
  stickerId: string,
  locationId: string,
  kind: 'in' | 'out',
  quantity: number,
  reason = 'uji',
) => validateRecordStock({ locationId, stickerId, kind, quantity, reason });

async function qtyAt(stickerId: string, locationId: string): Promise<number | null> {
  const row = await env.DB.prepare(
    'SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = ?',
  )
    .bind(stickerId, locationId)
    .first<{ qty: number }>();
  return row ? Number(row.qty) : null;
}

async function entriesOf(stickerId: string) {
  const rows = await env.DB.prepare(
    'SELECT kind, delta, qty_after FROM sticker_stock_entries WHERE sticker_id = ? ORDER BY id',
  )
    .bind(stickerId)
    .all<{ kind: string; delta: number; qty_after: number }>();
  return rows.results.map((r) => ({
    kind: r.kind,
    delta: Number(r.delta),
    qtyAfter: Number(r.qty_after),
  }));
}

describe('stok masuk dan keluar', () => {
  test('masuk 10x12 + 5 lepas (count) -> stok 125; riwayat memuat count, delta, qtyAfter, pelaku', async () => {
    const sticker = await newSticker();
    const entry = await recordStock(
      env,
      validateRecordStock({
        locationId: A,
        stickerId: sticker.id,
        kind: 'in',
        count: { rows: [{ sheets: 10, perSheet: 12 }], loose: 5 },
        reason: '',
      }),
      admin,
    );
    expect(entry).toMatchObject({
      stickerId: sticker.id,
      locationId: A,
      kind: 'in',
      delta: 125,
      qtyAfter: 125,
      count: { rows: [{ sheets: 10, perSheet: 12 }], loose: 5 },
      actor: 'admin@gmail.com',
      ts: '2026-11-09T00:00:00.000Z',
    });
    expect(await qtyAt(sticker.id, A)).toBe(125);
    const page = await stockHistory(env, validateStockHistory({ locationIds: [A] }), [A]);
    expect(page.entries).toEqual([entry]);
    expect(page.nextCursor).toBeNull();
    const [row] = await listStickerStock(env, [A]);
    expect(row).toMatchObject({ stickerId: sticker.id, total: 125 });
  });

  test('masuk dengan quantity menambah; baris stok dibuat saat catatan pertama; qtyAfter akumulatif', async () => {
    const sticker = await newSticker();
    expect(await qtyAt(sticker.id, A)).toBeNull();
    await recordStock(env, rec(sticker.id, A, 'in', 10), admin);
    const second = await recordStock(env, rec(sticker.id, A, 'in', 7), admin);
    expect(second).toMatchObject({ delta: 7, qtyAfter: 17, count: null });
    expect(await qtyAt(sticker.id, A)).toBe(17);
    expect(await entriesOf(sticker.id)).toEqual([
      { kind: 'in', delta: 10, qtyAfter: 10 },
      { kind: 'in', delta: 7, qtyAfter: 17 },
    ]);
  });

  test('keluar mengurangi; delta negatif; melebihi stok -> VALIDATION "Stok tidak cukup" dan tak ada perubahan', async () => {
    const sticker = await newSticker();
    await recordStock(env, rec(sticker.id, A, 'in', 10), admin);
    const out = await recordStock(env, rec(sticker.id, A, 'out', 4), admin);
    expect(out).toMatchObject({ kind: 'out', delta: -4, qtyAfter: 6 });
    const over = await captureAppErrorAsync(() =>
      recordStock(env, rec(sticker.id, A, 'out', 7), admin),
    );
    expect(over.code).toBe('VALIDATION');
    expect(over.message).toBe('Stok tidak cukup');
    expect(over.fields).toEqual({ quantity: 'Stok tidak cukup' });
    expect(await qtyAt(sticker.id, A)).toBe(6);
    expect(await entriesOf(sticker.id)).toHaveLength(2);
    // tepat habis diperbolehkan
    expect((await recordStock(env, rec(sticker.id, A, 'out', 6), admin)).qtyAfter).toBe(0);
    // stiker tanpa baris stok sama sekali
    const fresh = await newSticker();
    const none = await captureAppErrorAsync(() =>
      recordStock(env, rec(fresh.id, A, 'out', 1), admin),
    );
    expect(none.message).toBe('Stok tidak cukup');
    expect(await qtyAt(fresh.id, A)).toBeNull();
    expect(await entriesOf(fresh.id)).toEqual([]);
  });

  test('dua keluar serentak 8 pada stok 10: tepat satu berhasil, stok 2, satu baris keluar', async () => {
    for (let round = 0; round < 4; round++) {
      const sticker = await newSticker();
      await recordStock(env, rec(sticker.id, A, 'in', 10), admin);
      const results = await Promise.allSettled([
        recordStock(env, rec(sticker.id, A, 'out', 8), admin),
        recordStock(env, rec(sticker.id, A, 'out', 8), admin),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toMatchObject({
        code: 'VALIDATION',
        message: 'Stok tidak cukup',
      });
      expect(await qtyAt(sticker.id, A)).toBe(2);
      expect(await entriesOf(sticker.id)).toEqual([
        { kind: 'in', delta: 10, qtyAfter: 10 },
        { kind: 'out', delta: -8, qtyAfter: 2 },
      ]);
    }
  });

  test('banyak masuk serentak tidak ada yang hilang (qtyAfter unik dan berurutan)', async () => {
    const sticker = await newSticker();
    await Promise.all(
      Array.from({ length: 5 }, () => recordStock(env, rec(sticker.id, A, 'in', 3), admin)),
    );
    expect(await qtyAt(sticker.id, A)).toBe(15);
    const after = (await entriesOf(sticker.id)).map((e) => e.qtyAfter).sort((a, b) => a - b);
    expect(after).toEqual([3, 6, 9, 12, 15]);
  });

  test('stok per lokasi terpisah', async () => {
    const sticker = await newSticker();
    await recordStock(env, rec(sticker.id, A, 'in', 5), admin);
    await recordStock(env, rec(sticker.id, B, 'in', 9), admin);
    const out = await captureAppErrorAsync(() =>
      recordStock(env, rec(sticker.id, A, 'out', 6), admin),
    );
    expect(out.message).toBe('Stok tidak cukup');
    expect(await qtyAt(sticker.id, B)).toBe(9);
  });

  test('jenis nonaktif dengan stiker aktif: masuk ditolak, keluar dan koreksi diizinkan; list membawa typeStatus', async () => {
    const sticker = await newSticker();
    await recordStock(env, rec(sticker.id, A, 'in', 10), admin);
    await setStickerTypeStatus(env, { id: type.id, status: 'inactive' }, admin);
    const refused = await captureAppErrorAsync(() =>
      recordStock(env, rec(sticker.id, A, 'in', 5), admin),
    );
    expect(refused.code).toBe('VALIDATION');
    expect(refused.fields).toHaveProperty('stickerId');
    expect(await qtyAt(sticker.id, A)).toBe(10);
    expect((await recordStock(env, rec(sticker.id, A, 'out', 3), admin)).qtyAfter).toBe(7);
    expect(
      (
        await adjustStock(
          env,
          validateAdjustStock({
            locationId: A,
            stickerId: sticker.id,
            delta: 1,
            reason: 'koreksi',
          }),
          admin,
        )
      ).qtyAfter,
    ).toBe(8);
    const [row] = await listStickerStock(env, [A]);
    expect(row).toMatchObject({ stickerId: sticker.id, status: 'active', typeStatus: 'inactive' });
    // diaktifkan kembali: masuk diterima lagi
    await setStickerTypeStatus(env, { id: type.id, status: 'active' }, admin);
    expect((await recordStock(env, rec(sticker.id, A, 'in', 2), admin)).qtyAfter).toBe(10);
  });

  test('menonaktifkan jenis serentak dengan mencatat masuk: tak ada stok masuk yang lolos setelah jenis nonaktif', async () => {
    for (let round = 0; round < 4; round++) {
      const freshType = await saveStickerType(env, { name: `Jenis ${round}`, rule: 'none' }, admin);
      const sticker = await newSticker({ typeId: freshType.id });
      const results = await Promise.allSettled([
        setStickerTypeStatus(env, { id: freshType.id, status: 'inactive' }, admin),
        recordStock(env, rec(sticker.id, A, 'in', 5), admin),
      ]);
      const [deactivate, record] = results;
      expect(deactivate?.status).toBe('fulfilled');
      if (record?.status === 'rejected') {
        expect((record.reason as { code?: string }).code).toBe('VALIDATION');
      }
      const row = await env.DB.prepare('SELECT status FROM sticker_types WHERE id = ?')
        .bind(freshType.id)
        .first<{ status: string }>();
      expect(row?.status).toBe('inactive');
      // stok dan riwayat konsisten: masuk lolos hanya bila tercatat lengkap
      expect(await qtyAt(sticker.id, A)).toBe(record?.status === 'fulfilled' ? 5 : null);
      expect(await entriesOf(sticker.id)).toHaveLength(record?.status === 'fulfilled' ? 1 : 0);
    }
  });

  test('stiker nonaktif: masuk ditolak, keluar dan koreksi diizinkan; stiker tak dikenal NOT_FOUND', async () => {
    const sticker = await newSticker();
    await recordStock(env, rec(sticker.id, A, 'in', 10), admin);
    await setStickerStatus(env, { id: sticker.id, status: 'inactive' }, admin);
    const refused = await captureAppErrorAsync(() =>
      recordStock(env, rec(sticker.id, A, 'in', 1), admin),
    );
    expect(refused.code).toBe('VALIDATION');
    expect(refused.fields).toHaveProperty('stickerId');
    expect((await recordStock(env, rec(sticker.id, A, 'out', 3), admin)).qtyAfter).toBe(7);
    const adjusted = await adjustStock(
      env,
      validateAdjustStock({ locationId: A, stickerId: sticker.id, delta: -2, reason: 'rusak' }),
      admin,
    );
    expect(adjusted).toMatchObject({ kind: 'adjust', delta: -2, qtyAfter: 5, reason: 'rusak' });
    const missing = await captureAppErrorAsync(() =>
      recordStock(env, rec('tidak-ada', A, 'in', 1), admin),
    );
    expect(missing.code).toBe('NOT_FOUND');
  });
});

describe('koreksi', () => {
  test('koreksi positif dan negatif dengan alasan; di bawah nol ditolak', async () => {
    const sticker = await newSticker();
    const adj = (delta: number, reason = 'hitung ulang') =>
      adjustStock(
        env,
        validateAdjustStock({ locationId: A, stickerId: sticker.id, delta, reason }),
        admin,
      );
    expect((await adj(5)).qtyAfter).toBe(5);
    expect(await adj(-3)).toMatchObject({ kind: 'adjust', delta: -3, qtyAfter: 2 });
    const below = await captureAppErrorAsync(() => adj(-3));
    expect(below.message).toBe('Stok tidak cukup');
    expect(below.fields).toEqual({ delta: 'Stok tidak cukup' });
    expect(await qtyAt(sticker.id, A)).toBe(2);
  });

  test('validator: alasan wajib untuk koreksi dan keluar; delta bukan nol dan bulat; tepat satu dari quantity/count', () => {
    const adj = (overrides: Record<string, unknown>) =>
      captureAppError(() =>
        validateAdjustStock({
          locationId: A,
          stickerId: 's',
          delta: -3,
          reason: 'x',
          ...overrides,
        }),
      );
    expect(adj({ reason: '' }).fields).toHaveProperty('reason');
    expect(adj({ reason: '   ' }).fields).toHaveProperty('reason');
    expect(adj({ reason: 'x'.repeat(301) }).fields).toHaveProperty('reason');
    expect(adj({ delta: 0 }).fields).toHaveProperty('delta');
    expect(adj({ delta: 1.5 }).fields).toHaveProperty('delta');
    expect(adj({ delta: 1_000_001 }).fields).toHaveProperty('delta');
    expect(adj({ delta: '3' }).fields).toHaveProperty('delta');
    const recErr = (overrides: Record<string, unknown>) =>
      captureAppError(() =>
        validateRecordStock({
          locationId: A,
          stickerId: 's',
          kind: 'in',
          quantity: 5,
          reason: '',
          ...overrides,
        }),
      );
    expect(recErr({ kind: 'out', reason: '' }).fields).toHaveProperty('reason');
    expect(recErr({ kind: 'adjust' }).fields).toHaveProperty('kind');
    expect(recErr({ quantity: 0 }).fields).toHaveProperty('quantity');
    expect(recErr({ quantity: 1_000_001 }).fields).toHaveProperty('quantity');
    expect(recErr({ quantity: 2.5 }).fields).toHaveProperty('quantity');
    expect(
      recErr({ count: { rows: [], loose: 3 } }).fields, // keduanya terisi
    ).toHaveProperty('quantity');
    expect(recErr({ quantity: undefined }).fields).toHaveProperty('quantity'); // keduanya kosong
    const noPieces = recErr({ quantity: undefined, count: { rows: [], loose: 0 } });
    expect(noPieces.fields).toHaveProperty('count');
    expect(
      recErr({
        quantity: undefined,
        count: { rows: Array.from({ length: 21 }, () => ({ sheets: 1, perSheet: 1 })), loose: 0 },
      }).fields,
    ).toHaveProperty('count');
    expect(
      recErr({ quantity: undefined, count: { rows: [{ sheets: -1, perSheet: 3 }], loose: 0 } })
        .fields,
    ).toHaveProperty('count');
    expect(
      recErr({
        quantity: undefined,
        count: { rows: [{ sheets: 2_000, perSheet: 2_000 }], loose: 0 },
      }).fields,
    ).toHaveProperty('count'); // 4.000.000 butir > batas
    expect(
      validateRecordStock({
        locationId: ` ${A} `,
        stickerId: 's',
        kind: 'out',
        count: { rows: [{ sheets: 2, perSheet: 3 }], loose: 1 },
        reason: ' rusak ',
      }),
    ).toEqual({
      locationId: A,
      stickerId: 's',
      kind: 'out',
      count: { rows: [{ sheets: 2, perSheet: 3 }], loose: 1 },
      reason: 'rusak',
    });
  });

  test('keluar tanpa alasan ditolak validator; masuk tanpa alasan boleh', async () => {
    expect(
      captureAppError(() =>
        validateRecordStock({
          locationId: A,
          stickerId: 's',
          kind: 'out',
          quantity: 1,
          reason: '',
        }),
      ).code,
    ).toBe('VALIDATION');
    expect(rec('s', A, 'in', 1, '')).toMatchObject({ kind: 'in', quantity: 1, reason: '' });
  });
});

describe('daftar stok', () => {
  test('stiker aktif tanpa stok tampil dengan total 0; nonaktif tanpa stok di lokasi itu tidak tampil', async () => {
    const active = await newSticker({ alias: 'Hijau', minQty: 5 });
    const inactiveEmpty = await newSticker();
    const inactiveStocked = await newSticker();
    const inactiveElsewhere = await newSticker();
    await recordStock(env, rec(inactiveStocked.id, A, 'in', 4), admin);
    await recordStock(env, rec(inactiveElsewhere.id, B, 'in', 4), admin);
    for (const s of [inactiveEmpty, inactiveStocked, inactiveElsewhere]) {
      await setStickerStatus(env, { id: s.id, status: 'inactive' }, admin);
    }
    const rows = await listStickerStock(env, [A]);
    const byId = new Map(rows.map((row) => [row.stickerId, row]));
    expect([...byId.keys()].sort()).toEqual([active.id, inactiveStocked.id].sort());
    expect(byId.get(active.id)).toEqual({
      stickerId: active.id,
      name: 'Hijau',
      typeName: 'Umum',
      typeStatus: 'active',
      status: 'active',
      minQty: 5,
      low: true,
      total: 0,
      byLocation: [{ locationId: A, qty: 0 }],
    });
    expect(byId.get(inactiveStocked.id)).toMatchObject({ status: 'inactive', total: 4 });
    const two = await listStickerStock(env, [A, B]);
    expect(two.map((r) => r.stickerId)).toContain(inactiveElsewhere.id);
  });

  test('total hanya lokasi yang diminta; low memakai total SEMUA lokasi (sama dengan stickers.list)', async () => {
    const sticker = await newSticker({ minQty: 20 });
    await recordStock(env, rec(sticker.id, A, 'in', 5), admin);
    await recordStock(env, rec(sticker.id, B, 'in', 10), admin);
    const [rowA] = await listStickerStock(env, [A]);
    expect(rowA).toMatchObject({ total: 5, low: true, byLocation: [{ locationId: A, qty: 5 }] });
    const [rowAB] = await listStickerStock(env, [A, B]);
    expect(rowAB?.total).toBe(15);
    expect(rowAB?.byLocation).toEqual([
      { locationId: A, qty: 5 },
      { locationId: B, qty: 10 },
    ]);
    const listed = await restCall(env, 'admin@gmail.com', 'stickers.list', null);
    expect(listed).toMatchObject({ ok: true, data: [{ id: sticker.id, low: true }] });
    // minimum 12: total semua lokasi 15 > 12 -> tidak low walau lokasi A saja (5) di bawahnya
    const other = await newSticker({ minQty: 12 });
    await recordStock(env, rec(other.id, A, 'in', 5), admin);
    await recordStock(env, rec(other.id, B, 'in', 10), admin);
    const rows = await listStickerStock(env, [A]);
    expect(rows.find((r) => r.stickerId === other.id)).toMatchObject({ total: 5, low: false });
    const viaRest = await restCall(env, 'view-a@gmail.com', 'stickerStock.list', {
      locationIds: [A],
    });
    expect(viaRest).toMatchObject({ ok: true });
    const data = (viaRest as { data: { stickerId: string; total: number; low: boolean }[] }).data;
    expect(data.find((r) => r.stickerId === sticker.id)).toMatchObject({ total: 5, low: true });
    expect(data.find((r) => r.stickerId === other.id)).toMatchObject({ total: 5, low: false });
  });

  test('stok yang berubah memperbarui low di stickers.list', async () => {
    const sticker = await newSticker({ minQty: 10 });
    await recordStock(env, rec(sticker.id, A, 'in', 30), admin);
    const low = async () =>
      (
        (await restCall(env, 'admin@gmail.com', 'stickers.list', null)) as {
          data: { low: boolean }[];
        }
      ).data[0]?.low;
    expect(await low()).toBe(false);
    await recordStock(env, rec(sticker.id, A, 'out', 20), admin);
    expect(await low()).toBe(true);
  });
});

describe('riwayat', () => {
  test('terbaru dahulu, berkursor, difilter stiker dan lokasi yang diminta', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    for (let i = 0; i < 5; i++) {
      env.clock.advance(1000);
      await recordStock(env, rec(s1.id, A, 'in', i + 1), admin);
    }
    await recordStock(env, rec(s2.id, A, 'in', 9), admin);
    await recordStock(env, rec(s1.id, B, 'in', 50), admin);
    const input = (overrides: Record<string, unknown>) =>
      validateStockHistory({ locationIds: [A], ...overrides });
    const first = await stockHistory(env, input({ limit: 3 }), [A]);
    expect(first.entries).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = await stockHistory(env, input({ limit: 3, cursor: first.nextCursor }), [A]);
    expect(second.entries).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const all = [...first.entries, ...second.entries];
    expect(all).toHaveLength(6); // 5 (s1) + 1 (s2) di lokasi A; lokasi B tidak ikut
    expect(new Set(all.map((e) => e.id)).size).toBe(6);
    expect(all.every((e) => e.locationId === A)).toBe(true);
    const times = all.map((e) => e.ts);
    expect([...times].sort().reverse()).toEqual(times);
    const onlyS2 = await stockHistory(env, input({ stickerId: s2.id }), [A]);
    expect(onlyS2.entries.map((e) => e.stickerId)).toEqual([s2.id]);
    const both = await stockHistory(env, validateStockHistory({ locationIds: [A, B] }), [A, B]);
    expect(both.entries).toHaveLength(7);
  });

  test('validator riwayat: limit 1..200 (bawaan 50), kursor harus valid, lokasi wajib', () => {
    const bad = (raw: unknown) => captureAppError(() => validateStockHistory(raw));
    expect(validateStockHistory({ locationIds: [A] }).limit).toBe(50);
    expect(validateStockHistory({ locationIds: [A], limit: 200 }).limit).toBe(200);
    expect(bad({ locationIds: [A], limit: 201 }).fields).toHaveProperty('limit');
    expect(bad({ locationIds: [A], limit: 0 }).fields).toHaveProperty('limit');
    expect(bad({ locationIds: [A], cursor: 'sampah' }).fields).toHaveProperty('cursor');
    expect(bad({ locationIds: [] }).code).toBe('VALIDATION');
    expect(bad({}).code).toBe('VALIDATION');
    expect(validateListStickerStock({ locationIds: [A, A] })).toEqual({ locationIds: [A] });
  });
});

describe('izin dan lokasi', () => {
  const body = (stickerId: string, locationId: string) => ({
    locationId,
    stickerId,
    kind: 'in',
    quantity: 3,
    reason: '',
  });

  test('stickerstock edit di lokasi A: record di A berhasil, di B FORBIDDEN; list B dan [A,B] ditolak', async () => {
    const sticker = await newSticker();
    expect(
      await restCall(env, 'edit-a@gmail.com', 'stickerStock.record', body(sticker.id, A)),
    ).toMatchObject({ ok: true, data: { delta: 3, qtyAfter: 3, actor: 'edit-a@gmail.com' } });
    expect(
      await restCall(env, 'edit-a@gmail.com', 'stickerStock.record', body(sticker.id, B)),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await qtyAt(sticker.id, B)).toBeNull();
    for (const locationIds of [[B], [A, B]]) {
      expect(
        await restCall(env, 'edit-a@gmail.com', 'stickerStock.list', { locationIds }),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(
        await restCall(env, 'edit-a@gmail.com', 'stickerStock.history', { locationIds }),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    expect(
      await restCall(env, 'edit-a@gmail.com', 'stickerStock.list', { locationIds: [A] }),
    ).toMatchObject({ ok: true });
  });

  test('view saja tidak dapat mencatat; edit tidak dapat koreksi; manage dapat', async () => {
    const sticker = await newSticker();
    await recordStock(env, rec(sticker.id, A, 'in', 10), admin);
    expect(
      await restCall(env, 'view-a@gmail.com', 'stickerStock.record', body(sticker.id, A)),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await restCall(env, 'view-a@gmail.com', 'stickerStock.history', { locationIds: [A] }),
    ).toMatchObject({ ok: true });
    const adjust = { locationId: A, stickerId: sticker.id, delta: -2, reason: 'rusak' };
    expect(await restCall(env, 'edit-a@gmail.com', 'stickerStock.adjust', adjust)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await restCall(env, 'manage-a@gmail.com', 'stickerStock.adjust', adjust)).toMatchObject({
      ok: true,
      data: { kind: 'adjust', delta: -2, qtyAfter: 8 },
    });
    // manage meliputi catat masuk/keluar di lokasinya
    expect(
      await restCall(env, 'manage-a@gmail.com', 'stickerStock.record', body(sticker.id, A)),
    ).toMatchObject({ ok: true });
  });

  test('lokasi nonaktif atau tak dikenal ditolak (juga untuk admin); tanpa izin sticker stok tak dapat membaca katalog', async () => {
    const sticker = await newSticker();
    for (const locationId of [OFF, 'tidak-ada']) {
      expect(
        await restCall(env, 'admin@gmail.com', 'stickerStock.record', body(sticker.id, locationId)),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(
        await restCall(env, 'admin@gmail.com', 'stickerStock.list', { locationIds: [locationId] }),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    expect(await restCall(env, 'view-a@gmail.com', 'stickers.list', null)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  test('izin rute: list/history view, record edit, adjust manage; semuanya berlokasi (modul stickerstock)', () => {
    const routes = getRoutes();
    const loc = (level: 'view' | 'edit' | 'manage') =>
      ({
        module: 'stickerstock',
        level,
        scope: 'location',
      }) as never;
    expect(routes['stickerStock.list'].permission).toEqual(loc('view'));
    expect(routes['stickerStock.history'].permission).toEqual(loc('view'));
    expect(routes['stickerStock.record'].permission).toEqual(loc('edit'));
    expect(routes['stickerStock.adjust'].permission).toEqual(loc('manage'));
  });
});

describe('stiker deprecated (tahap 4a)', () => {
  const deprecate = (stickerId: string) =>
    env.DB.prepare("UPDATE stickers SET status = 'deprecated' WHERE id = ?").bind(stickerId).run();
  const statusOf = async (stickerId: string) =>
    (
      await env.DB.prepare('SELECT status FROM stickers WHERE id = ?')
        .bind(stickerId)
        .first<{ status: string }>()
    )?.status;
  const dtoOf = async (stickerId: string) => {
    const { listStickers } = await import('./service');
    return (await listStickers(env)).find((sticker) => sticker.id === stickerId);
  };

  test('stok masuk ke stiker deprecated ditolak; tidak ada baris stok atau riwayat baru', async () => {
    const sticker = await newSticker();
    await recordStock(env, rec(sticker.id, A, 'in', 5), admin);
    await deprecate(sticker.id);
    const error = await captureAppErrorAsync(() =>
      recordStock(env, rec(sticker.id, A, 'in', 1), admin),
    );
    expect(error.code).toBe('VALIDATION');
    expect(await qtyAt(sticker.id, A)).toBe(5);
    expect(await entriesOf(sticker.id)).toHaveLength(1);
  });

  test('stok keluar yang menghabiskan total semua lokasi menjadikan deprecated -> inactive (respons dan basis data)', async () => {
    const sticker = await newSticker({ minQty: 10 });
    await recordStock(env, rec(sticker.id, A, 'in', 3), admin);
    await recordStock(env, rec(sticker.id, B, 'in', 2), admin);
    await deprecate(sticker.id);
    await recordStock(env, rec(sticker.id, A, 'out', 3), admin);
    // Masih ada stok di lokasi lain: tetap deprecated.
    expect(await statusOf(sticker.id)).toBe('deprecated');
    expect(await dtoOf(sticker.id)).toMatchObject({ status: 'deprecated', low: false });
    await recordStock(env, rec(sticker.id, B, 'out', 2), admin);
    expect(await statusOf(sticker.id)).toBe('inactive');
    expect(await dtoOf(sticker.id)).toMatchObject({ status: 'inactive', low: false });
  });

  test('koreksi (adjust) negatif yang menghabiskan stok juga menonaktifkan; stiker non-deprecated tak berubah', async () => {
    const old = await newSticker();
    const live = await newSticker();
    await recordStock(env, rec(old.id, A, 'in', 4), admin);
    await recordStock(env, rec(live.id, A, 'in', 4), admin);
    await deprecate(old.id);
    for (const id of [old.id, live.id]) {
      await adjustStock(
        env,
        validateAdjustStock({ locationId: A, stickerId: id, delta: -4, reason: 'rusak' }),
        admin,
      );
    }
    expect(await statusOf(old.id)).toBe('inactive');
    expect(await statusOf(live.id)).toBe('active');
  });

  test('stok menipis tidak pernah dihitung untuk deprecated (daftar stok dan katalog)', async () => {
    const sticker = await newSticker({ minQty: 10 });
    await recordStock(env, rec(sticker.id, A, 'in', 4), admin);
    expect((await listStickerStock(env, [A])).find((r) => r.stickerId === sticker.id)?.low).toBe(
      true,
    );
    await deprecate(sticker.id);
    const row = (await listStickerStock(env, [A])).find((r) => r.stickerId === sticker.id);
    expect(row).toMatchObject({ status: 'deprecated', low: false, total: 4 });
    expect((await dtoOf(sticker.id))?.low).toBe(false);
  });

  test('dua pengurangan serentak di lokasi berbeda yang menghabiskan total: stiker menjadi inactive, tanpa galat', async () => {
    for (let round = 0; round < 4; round++) {
      const sticker = await newSticker();
      await recordStock(env, rec(sticker.id, A, 'in', 5), admin);
      await recordStock(env, rec(sticker.id, B, 'in', 5), admin);
      await deprecate(sticker.id);
      const results = await Promise.allSettled([
        adjustStock(
          env,
          validateAdjustStock({ locationId: A, stickerId: sticker.id, delta: -5, reason: 'a' }),
          admin,
        ),
        adjustStock(
          env,
          validateAdjustStock({ locationId: B, stickerId: sticker.id, delta: -5, reason: 'b' }),
          admin,
        ),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await qtyAt(sticker.id, A)).toBe(0);
      expect(await qtyAt(sticker.id, B)).toBe(0);
      expect(await statusOf(sticker.id)).toBe('inactive');
    }
  });

  test('dua keluar serentak di lokasi yang sama: tepat satu penonaktifan tanpa galat', async () => {
    const sticker = await newSticker();
    await recordStock(env, rec(sticker.id, A, 'in', 10), admin);
    await deprecate(sticker.id);
    const results = await Promise.allSettled([
      recordStock(env, rec(sticker.id, A, 'out', 5), admin),
      recordStock(env, rec(sticker.id, A, 'out', 5), admin),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await statusOf(sticker.id)).toBe('inactive');
    expect(await qtyAt(sticker.id, A)).toBe(0);
  });
});
