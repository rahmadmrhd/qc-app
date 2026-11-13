import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { isGuardFailure } from '@server/core/cas';
import type { AppError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { getRoutes } from '@server/routes';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppError, captureAppErrorAsync } from '@server-test/errors';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { StickerDto, StickerTypeDto } from '@shared/contract';
import { saveSticker, saveStickerType, setStickerStatus } from './service';
import { opnameSetStmt } from './stock-repo';
import { opnameStock, recordStock } from './stock-service';
import { validateOpname, validateRecordStock } from './validate';

setDefaultTimeout(60_000);

const A = 'loc-a';
const B = 'loc-b';
const STALE = 'Stok berubah sejak dihitung; hitung ulang';

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
  await seedRole(env, { id: 'r-edit', name: 'Edit', permissions: { stickerstock: 'edit' } });
  await seedRole(env, { id: 'r-manage', name: 'Kelola', permissions: { stickerstock: 'manage' } });
  await seedUser(env, {
    id: 'u-edit',
    email: 'edit-a@gmail.com',
    assignments: [{ locationId: A, roleIds: ['r-edit'] }],
  });
  await seedUser(env, {
    id: 'u-manage',
    email: 'manage-a@gmail.com',
    assignments: [{ locationId: A, roleIds: ['r-manage'] }],
  });
  type = await saveStickerType(env, { name: 'Umum', rule: 'none' }, admin);
});

let counter = 0;
async function newSticker(): Promise<StickerDto> {
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
    },
    admin,
  );
}

async function stock(stickerId: string, locationId: string, qty: number) {
  await recordStock(
    env,
    validateRecordStock({ locationId, stickerId, kind: 'in', quantity: qty, reason: '' }),
    admin,
  );
}

async function qtyAt(stickerId: string, locationId: string): Promise<number | null> {
  const row = await env.DB.prepare(
    'SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = ?',
  )
    .bind(stickerId, locationId)
    .first<{ qty: number }>();
  return row ? Number(row.qty) : null;
}

async function opnameEntries() {
  const rows = await env.DB.prepare(
    "SELECT sticker_id, location_id, delta, qty_after, count_json, reason FROM sticker_stock_entries WHERE kind = 'opname' ORDER BY id",
  ).all<{
    sticker_id: string;
    location_id: string;
    delta: number;
    qty_after: number;
    count_json: string;
    reason: string;
  }>();
  return rows.results;
}

const row = (
  stickerId: string,
  locationId: string,
  expectedQty: number,
  count: { rows?: { sheets: number; perSheet: number }[]; loose?: number },
) => ({
  stickerId,
  locationId,
  expectedQty,
  count: { rows: count.rows ?? [], loose: count.loose ?? 0 },
});

describe('stok opname', () => {
  test('dua baris (selisih + dan -) menulis dua riwayat opname dengan qtyAfter benar, urut sesuai masukan', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    await stock(s1.id, A, 10);
    await stock(s2.id, A, 20);
    const out = await opnameStock(
      env,
      validateOpname({
        rows: [
          row(s1.id, A, 10, { rows: [{ sheets: 1, perSheet: 12 }] }), // 12: +2
          row(s2.id, A, 20, { rows: [{ sheets: 1, perSheet: 10 }], loose: 5 }), // 15: -5
        ],
      }),
      admin,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      stickerId: s1.id,
      locationId: A,
      kind: 'opname',
      delta: 2,
      qtyAfter: 12,
      count: { rows: [{ sheets: 1, perSheet: 12 }], loose: 0 },
      actor: 'admin@gmail.com',
    });
    expect(out[1]).toMatchObject({
      stickerId: s2.id,
      kind: 'opname',
      delta: -5,
      qtyAfter: 15,
      count: { rows: [{ sheets: 1, perSheet: 10 }], loose: 5 },
    });
    expect(await qtyAt(s1.id, A)).toBe(12);
    expect(await qtyAt(s2.id, A)).toBe(15);
    // urutan tulis mengikuti kunci (stiker, lokasi), bukan urutan masukan: bandingkan sebagai himpunan
    const written = (await opnameEntries()).map((e) => [Number(e.delta), Number(e.qty_after)]);
    expect(written.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))).toEqual([
      [-5, 15],
      [2, 12],
    ]);
  });

  test('baris tanpa selisih tidak membuat riwayat dan tidak mengubah stok; semua tanpa selisih = []', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    await stock(s1.id, A, 10);
    await stock(s2.id, A, 5);
    const out = await opnameStock(
      env,
      validateOpname({
        rows: [row(s1.id, A, 10, { loose: 10 }), row(s2.id, A, 5, { loose: 8 })],
      }),
      admin,
    );
    expect(out.map((e) => e.stickerId)).toEqual([s2.id]);
    expect(await opnameEntries()).toHaveLength(1);
    expect(await qtyAt(s1.id, A)).toBe(10);
    const none = await opnameStock(
      env,
      validateOpname({ rows: [row(s1.id, A, 10, { loose: 10 })] }),
      admin,
    );
    expect(none).toEqual([]);
    expect(await opnameEntries()).toHaveLength(1);
  });

  test('stiker tanpa baris stok (expectedQty 0) dapat dihitung pertama kali; hitungan 0 butir menolkan stok', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    await stock(s2.id, B, 9);
    const out = await opnameStock(
      env,
      validateOpname({
        rows: [row(s1.id, A, 0, { loose: 7 }), row(s2.id, B, 9, {})],
      }),
      admin,
    );
    expect(out.map((e) => [e.delta, e.qtyAfter])).toEqual([
      [7, 7],
      [-9, 0],
    ]);
    expect(await qtyAt(s1.id, A)).toBe(7);
    expect(await qtyAt(s2.id, B)).toBe(0);
  });

  test('stiker nonaktif boleh dihitung; stiker tak dikenal NOT_FOUND tanpa menulis apa pun', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    await stock(s1.id, A, 10);
    await setStickerStatus(env, { id: s1.id, status: 'inactive' }, admin);
    const ok = await opnameStock(
      env,
      validateOpname({ rows: [row(s1.id, A, 10, { loose: 4 })] }),
      admin,
    );
    expect(ok[0]).toMatchObject({ delta: -6, qtyAfter: 4 });
    await stock(s2.id, A, 3);
    const missing = await captureAppErrorAsync(() =>
      opnameStock(
        env,
        validateOpname({
          rows: [row(s2.id, A, 3, { loose: 1 }), row('tidak-ada', A, 0, { loose: 1 })],
        }),
        admin,
      ),
    );
    expect(missing.code).toBe('NOT_FOUND');
    expect(await qtyAt(s2.id, A)).toBe(3);
  });

  test('satu baris usang menolak SELURUH permintaan (staleError) dan tidak menulis apa pun', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    const s3 = await newSticker();
    await stock(s1.id, A, 10);
    await stock(s2.id, A, 20);
    await stock(s3.id, A, 30);
    const error = await captureAppErrorAsync(() =>
      opnameStock(
        env,
        validateOpname({
          rows: [
            row(s1.id, A, 10, { loose: 1 }),
            row(s2.id, A, 21, { loose: 5 }), // usang: tersimpan 20
            row(s3.id, A, 30, { loose: 2 }),
          ],
        }),
        admin,
      ),
    );
    expect(error.code).toBe('CONFLICT');
    expect(error.stale).toBe(true);
    expect(error.message).toBe(STALE);
    expect([await qtyAt(s1.id, A), await qtyAt(s2.id, A), await qtyAt(s3.id, A)]).toEqual([
      10, 20, 30,
    ]);
    expect(await opnameEntries()).toHaveLength(0);
    // expectedQty != 0 untuk pasangan tanpa baris stok juga usang
    const s4 = await newSticker();
    const empty = await captureAppErrorAsync(() =>
      opnameStock(env, validateOpname({ rows: [row(s4.id, A, 5, { loose: 1 })] }), admin),
    );
    expect(empty.stale).toBe(true);
    // baris tanpa selisih yang usang juga menolak seluruhnya
    const noDiff = await captureAppErrorAsync(() =>
      opnameStock(
        env,
        validateOpname({
          rows: [row(s1.id, A, 10, { loose: 3 }), row(s2.id, A, 19, { loose: 19 })],
        }),
        admin,
      ),
    );
    expect(noDiff.stale).toBe(true);
    expect(await qtyAt(s1.id, A)).toBe(10);
  });

  test('stok diubah serentak: opname seluruhnya diterapkan atau seluruhnya ditolak (atomik)', async () => {
    for (let round = 0; round < 4; round++) {
      const x = await newSticker();
      const y = await newSticker();
      await stock(x.id, A, 10);
      await stock(y.id, A, 10);
      const results = await Promise.allSettled([
        opnameStock(
          env,
          validateOpname({
            rows: [row(x.id, A, 10, { loose: 5 }), row(y.id, A, 10, { loose: 5 })],
          }),
          admin,
        ),
        recordStock(
          env,
          validateRecordStock({
            locationId: A,
            stickerId: y.id,
            kind: 'out',
            quantity: 3,
            reason: 'x',
          }),
          admin,
        ),
      ]);
      const [opname, record] = results;
      expect(record?.status).toBe('fulfilled');
      const qx = await qtyAt(x.id, A);
      const qy = await qtyAt(y.id, A);
      if (opname?.status === 'fulfilled') {
        expect(qx).toBe(5);
        expect(qy).toBe(2); // opname lebih dulu (y=5) lalu keluar 3
      } else {
        const reason = (opname as PromiseRejectedResult).reason as AppError;
        expect(reason.stale).toBe(true);
        expect(qx).toBe(10); // tidak ada baris yang tertulis
        expect(qy).toBe(7);
      }
    }
  });

  test('penjaga CAS di batch: satu baris usang membatalkan seluruh batch (baris lain tak tertulis)', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    await stock(s1.id, A, 10);
    await stock(s2.id, A, 20);
    const now = '2026-11-09T00:00:00.000Z';
    const error = await env.DB.batch([
      opnameSetStmt(env.DB, s1.id, A, 10, 99, now),
      opnameSetStmt(env.DB, s2.id, A, 21, 99, now), // usang
    ]).catch((e: unknown) => e);
    expect(isGuardFailure(error)).toBe(true);
    expect(await qtyAt(s1.id, A)).toBe(10);
    expect(await qtyAt(s2.id, A)).toBe(20);
  });

  test('validator: 1..100 baris, pasangan stiker x lokasi unik, bentuk hitungan dan expectedQty', () => {
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => row(`s${i}`, A, 0, { loose: 1 }));
    expect(validateOpname({ rows: rows(100) }).rows).toHaveLength(100);
    expect(captureAppError(() => validateOpname({ rows: rows(101) })).code).toBe('VALIDATION');
    expect(captureAppError(() => validateOpname({ rows: [] })).fields).toHaveProperty('rows');
    expect(captureAppError(() => validateOpname({})).fields).toHaveProperty('rows');
    const dup = captureAppError(() =>
      validateOpname({ rows: [row('s', A, 0, { loose: 1 }), row('s', A, 0, { loose: 2 })] }),
    );
    expect(dup.code).toBe('VALIDATION');
    expect(dup.fields).toHaveProperty('rows');
    // stiker sama di lokasi berbeda boleh
    expect(
      validateOpname({ rows: [row('s', A, 0, { loose: 1 }), row('s', B, 0, { loose: 2 })] }).rows,
    ).toHaveLength(2);
    const bad = (overrides: Record<string, unknown>) =>
      captureAppError(() =>
        validateOpname({ rows: [{ ...row('s', A, 0, { loose: 1 }), ...overrides }] }),
      );
    // negatif sah: stok boleh negatif akibat pemotongan Serial Number
    expect(
      validateOpname({ rows: [{ ...row('s', A, -1, { loose: 1 }) }] }).rows[0]?.expectedQty,
    ).toBe(-1);
    expect(bad({ expectedQty: 1.5 }).fields).toHaveProperty('rows');
    expect(bad({ expectedQty: '3' }).fields).toHaveProperty('rows');
    expect(bad({ stickerId: '' }).fields).toHaveProperty('rows');
    expect(bad({ locationId: '' }).fields).toHaveProperty('rows');
    expect(bad({ count: undefined }).fields).toHaveProperty('rows');
    expect(bad({ count: { rows: [{ sheets: -1, perSheet: 2 }], loose: 0 } }).fields).toHaveProperty(
      'rows',
    );
    expect(bad({ count: { rows: [], loose: 1_000_001 } }).fields).toHaveProperty('rows');
    expect(
      bad({
        count: { rows: Array.from({ length: 21 }, () => ({ sheets: 1, perSheet: 1 })), loose: 0 },
      }).fields,
    ).toHaveProperty('rows');
    // locationIds diturunkan dari baris (lokasi unik, urut kemunculan); isian klien diabaikan
    expect(
      validateOpname({
        rows: [row('s', B, 0, {}), row('t', A, 0, {}), row('u', B, 0, {})],
        locationIds: ['lain'],
      }).locationIds,
    ).toEqual([B, A]);
  });
});

describe('izin dan lokasi', () => {
  test('stickerstock edit ditolak FORBIDDEN; manage di A berhasil', async () => {
    const s1 = await newSticker();
    await stock(s1.id, A, 10);
    const body = { rows: [row(s1.id, A, 10, { loose: 4 })] };
    expect(await restCall(env, 'edit-a@gmail.com', 'stickerStock.opname', body)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await qtyAt(s1.id, A)).toBe(10);
    expect(await restCall(env, 'manage-a@gmail.com', 'stickerStock.opname', body)).toMatchObject({
      ok: true,
      data: [{ kind: 'opname', delta: -6, qtyAfter: 4, actor: 'manage-a@gmail.com' }],
    });
  });

  test('satu lokasi terlarang di antara baris menolak seluruh permintaan (tak ada baris tertulis)', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    await stock(s1.id, A, 10);
    await stock(s2.id, B, 10);
    const result = await restCall(env, 'manage-a@gmail.com', 'stickerStock.opname', {
      rows: [row(s1.id, A, 10, { loose: 1 }), row(s2.id, B, 10, { loose: 1 })],
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await qtyAt(s1.id, A)).toBe(10);
    expect(await qtyAt(s2.id, B)).toBe(10);
    // lokasi tak dikenal juga ditolak
    expect(
      await restCall(env, 'admin@gmail.com', 'stickerStock.opname', {
        rows: [row(s1.id, 'tidak-ada', 0, { loose: 1 })],
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  test('super admin: dua lokasi dalam satu permintaan; baris ke-101 ditolak VALIDATION lewat REST', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    await stock(s1.id, A, 10);
    await stock(s2.id, B, 10);
    const ok = await restCall(env, 'admin@gmail.com', 'stickerStock.opname', {
      rows: [row(s1.id, A, 10, { loose: 11 }), row(s2.id, B, 10, { loose: 9 })],
    });
    expect(ok).toMatchObject({ ok: true });
    expect((ok as { data: unknown[] }).data).toHaveLength(2);
    const many = Array.from({ length: 101 }, (_, i) => row(`s${i}`, A, 0, { loose: 1 }));
    expect(
      await restCall(env, 'admin@gmail.com', 'stickerStock.opname', { rows: many }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  test('izin rute: opname = stickerstock manage berlokasi', () => {
    expect(getRoutes()['stickerStock.opname'].permission).toEqual({
      module: 'stickerstock',
      level: 'manage',
      scope: 'location',
    } as never);
  });
});

describe('stok opname pada stiker deprecated (tahap 4a)', () => {
  const statusOf = async (stickerId: string) =>
    (
      await env.DB.prepare('SELECT status FROM stickers WHERE id = ?')
        .bind(stickerId)
        .first<{ status: string }>()
    )?.status;

  test('opname yang membuat total semua lokasi 0 menjadikan deprecated -> inactive; total > 0 tetap deprecated', async () => {
    const empty = await newSticker();
    const partial = await newSticker();
    const live = await newSticker();
    for (const sticker of [empty, partial, live]) {
      await stock(sticker.id, A, 6);
      await stock(sticker.id, B, 4);
    }
    await env.DB.prepare("UPDATE stickers SET status = 'deprecated' WHERE id IN (?, ?)")
      .bind(empty.id, partial.id)
      .run();
    await opnameStock(
      env,
      validateOpname({
        rows: [
          row(empty.id, A, 6, { loose: 0 }),
          row(empty.id, B, 4, { loose: 0 }),
          row(partial.id, A, 6, { loose: 0 }), // B masih 4: total 4
          row(live.id, A, 6, { loose: 0 }),
          row(live.id, B, 4, { loose: 0 }),
        ],
      }),
      admin,
    );
    expect(await statusOf(empty.id)).toBe('inactive');
    expect(await statusOf(partial.id)).toBe('deprecated');
    expect(await statusOf(live.id)).toBe('active');
  });

  test('opname serentak dengan pengurangan di lokasi lain: total 0 tetap menonaktifkan', async () => {
    const sticker = await newSticker();
    await stock(sticker.id, A, 5);
    await stock(sticker.id, B, 5);
    await env.DB.prepare("UPDATE stickers SET status = 'deprecated' WHERE id = ?")
      .bind(sticker.id)
      .run();
    const results = await Promise.allSettled([
      opnameStock(env, validateOpname({ rows: [row(sticker.id, A, 5, { loose: 0 })] }), admin),
      recordStock(
        env,
        validateRecordStock({
          locationId: B,
          stickerId: sticker.id,
          kind: 'out',
          quantity: 5,
          reason: 'uji',
        }),
        admin,
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await qtyAt(sticker.id, A)).toBe(0);
    expect(await qtyAt(sticker.id, B)).toBe(0);
    expect(await statusOf(sticker.id)).toBe('inactive');
  });
});
