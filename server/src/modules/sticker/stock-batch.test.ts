import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { getRoutes } from '@server/routes';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppError, captureAppErrorAsync } from '@server-test/errors';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { StickerDto, StickerTypeDto } from '@shared/contract';
import { STICKER_LIMITS } from '@shared/stickers';
import { saveSticker, saveStickerType } from './service';
import { adjustStockBatch, recordStock, recordStockBatch } from './stock-service';
import {
  validateAdjustStockBatch,
  validateRecordStock,
  validateRecordStockBatch,
} from './validate';

// Entri stok batch (redesain fase 4a, Task 2b): masuk/keluar dan koreksi banyak stiker x lokasi dalam SATU transaksi.

setDefaultTimeout(60_000);

const A = 'loc-a';
const B = 'loc-b';
const C = 'loc-c';

let env: TestEnv;
let admin: UserContext;
let type: StickerTypeDto;
let counter = 0;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-21T00:00:00.000Z'));
  const ctx = await loadUserContext(env, 'admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
  await seedLocation(env, { id: A, code: 'A' });
  await seedLocation(env, { id: B, code: 'B' });
  await seedLocation(env, { id: C, code: 'C' });
  await seedRole(env, { id: 'r-edit', name: 'Edit', permissions: { stickerstock: 'edit' } });
  await seedRole(env, { id: 'r-manage', name: 'Kelola', permissions: { stickerstock: 'manage' } });
  await seedUser(env, {
    id: 'u-edit',
    email: 'edit-ab@gmail.com',
    assignments: [
      { locationId: A, roleIds: ['r-edit'] },
      { locationId: B, roleIds: ['r-edit'] },
    ],
  });
  await seedUser(env, {
    id: 'u-manage',
    email: 'manage-ab@gmail.com',
    assignments: [
      { locationId: A, roleIds: ['r-manage'] },
      { locationId: B, roleIds: ['r-manage'] },
    ],
  });
  type = await saveStickerType(env, { name: 'Umum', rule: 'none' }, admin);
});

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

async function qtyAt(stickerId: string, locationId: string): Promise<number | null> {
  const row = await env.DB.prepare(
    'SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = ?',
  )
    .bind(stickerId, locationId)
    .first<{ qty: number | string }>();
  return row ? Number(row.qty) : null;
}

const entryCount = async (): Promise<number> =>
  Number(
    (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM sticker_stock_entries').first<{
        n: number | string;
      }>()
    )?.n,
  );

const statusOf = async (stickerId: string): Promise<string | undefined> =>
  (
    await env.DB.prepare('SELECT status FROM stickers WHERE id = ?')
      .bind(stickerId)
      .first<{ status: string }>()
  )?.status;

const seedQty = (stickerId: string, locationId: string, quantity: number) =>
  recordStock(
    env,
    validateRecordStock({ locationId, stickerId, kind: 'in', quantity, reason: '' }),
    admin,
  );

const recordBatch = (kind: 'in' | 'out', reason: string, rows: unknown[]) =>
  validateRecordStockBatch({ kind, reason, rows });

describe('stickerStock.recordBatch: masuk', () => {
  test('banyak stiker x lokasi dalam satu permintaan; hasil urut masukan; satu alasan disalin ke tiap entri', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    const entries = await recordStockBatch(
      env,
      recordBatch('in', 'kiriman gudang', [
        { stickerId: s2.id, locationId: B, quantity: 7 },
        { stickerId: s1.id, locationId: A, quantity: 5 },
        {
          stickerId: s1.id,
          locationId: B,
          count: { rows: [{ sheets: 2, perSheet: 10 }], loose: 3 },
        },
      ]),
      admin,
    );
    expect(entries.map((entry) => [entry.stickerId, entry.locationId, entry.delta])).toEqual([
      [s2.id, B, 7],
      [s1.id, A, 5],
      [s1.id, B, 23],
    ]);
    expect(entries.map((entry) => entry.qtyAfter)).toEqual([7, 5, 23]);
    expect(entries.every((entry) => entry.reason === 'kiriman gudang')).toBe(true);
    expect(entries.every((entry) => entry.kind === 'in')).toBe(true);
    expect(entries[2]?.count).toEqual({ rows: [{ sheets: 2, perSheet: 10 }], loose: 3 });
    expect(entries.every((entry) => entry.actor === 'admin@gmail.com')).toBe(true);
    expect(await qtyAt(s1.id, A)).toBe(5);
    expect(await qtyAt(s1.id, B)).toBe(23);
    expect(await qtyAt(s2.id, B)).toBe(7);
    expect(await entryCount()).toBe(3);
  });

  test('menambah ke baris stok yang sudah ada; qtyAfter akumulatif', async () => {
    const sticker = await newSticker();
    await seedQty(sticker.id, A, 10);
    const [entry] = await recordStockBatch(
      env,
      recordBatch('in', '', [{ stickerId: sticker.id, locationId: A, quantity: 4 }]),
      admin,
    );
    expect(entry).toMatchObject({ delta: 4, qtyAfter: 14 });
  });

  test('satu stiker nonaktif, digantikan, atau berjenis nonaktif menolak SELURUH batch dengan nomor baris', async () => {
    const ok = await newSticker();
    const off = await newSticker();
    await env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = ?").bind(off.id).run();
    const error = await captureAppErrorAsync(() =>
      recordStockBatch(
        env,
        recordBatch('in', '', [
          { stickerId: ok.id, locationId: A, quantity: 1 },
          { stickerId: off.id, locationId: A, quantity: 1 },
        ]),
        admin,
      ),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toBe('Baris 2: Stiker nonaktif tidak dapat menerima stok masuk');
    expect(error.fields).toEqual({ rows: error.message });
    expect(await qtyAt(ok.id, A)).toBeNull();
    expect(await entryCount()).toBe(0);

    await env.DB.prepare("UPDATE stickers SET status = 'deprecated' WHERE id = ?")
      .bind(off.id)
      .run();
    const deprecated = await captureAppErrorAsync(() =>
      recordStockBatch(
        env,
        recordBatch('in', '', [{ stickerId: off.id, locationId: A, quantity: 1 }]),
        admin,
      ),
    );
    expect(deprecated.message).toBe(
      'Baris 1: Stiker sudah digantikan versi baru; stok masuk tidak dapat dicatat',
    );

    await env.DB.prepare("UPDATE sticker_types SET status = 'inactive' WHERE id = ?")
      .bind(type.id)
      .run();
    const typeOff = await captureAppErrorAsync(() =>
      recordStockBatch(
        env,
        recordBatch('in', '', [{ stickerId: ok.id, locationId: A, quantity: 1 }]),
        admin,
      ),
    );
    expect(typeOff.message).toBe('Baris 1: Jenis stiker nonaktif; stok masuk tidak dapat dicatat');
    expect(await entryCount()).toBe(0);
  });

  test('stiker tak dikenal atau terhapus = NOT_FOUND (didahulukan atas pelanggaran baris lain); tak menulis apa pun', async () => {
    const ok = await newSticker();
    const gone = await newSticker();
    await env.DB.prepare(
      "UPDATE stickers SET status = 'inactive', deleted_at = '2026-11-20T00:00:00.000Z', deleted_by = 'seed' WHERE id = ?",
    )
      .bind(gone.id)
      .run();
    for (const stickerId of [gone.id, 'tidak-ada']) {
      const error = await captureAppErrorAsync(() =>
        recordStockBatch(
          env,
          recordBatch('in', '', [
            { stickerId: ok.id, locationId: A, quantity: 1 },
            { stickerId, locationId: A, quantity: 1 },
          ]),
          admin,
        ),
      );
      expect(error.code).toBe('NOT_FOUND');
    }
    expect(await qtyAt(ok.id, A)).toBeNull();
    expect(await entryCount()).toBe(0);
  });
});

describe('stickerStock.recordBatch: keluar', () => {
  test('mengurangi banyak baris sekaligus; riwayat negatif; hasil urut masukan', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    await seedQty(s1.id, A, 10);
    await seedQty(s2.id, A, 6);
    await seedQty(s2.id, B, 6);
    const entries = await recordStockBatch(
      env,
      recordBatch('out', 'kirim customer', [
        { stickerId: s2.id, locationId: B, quantity: 6 },
        { stickerId: s1.id, locationId: A, quantity: 3 },
        { stickerId: s2.id, locationId: A, quantity: 1 },
      ]),
      admin,
    );
    expect(entries.map((entry) => [entry.stickerId, entry.locationId, entry.delta])).toEqual([
      [s2.id, B, -6],
      [s1.id, A, -3],
      [s2.id, A, -1],
    ]);
    expect(entries.map((entry) => entry.qtyAfter)).toEqual([0, 7, 5]);
    expect(await qtyAt(s2.id, B)).toBe(0);
    expect(await qtyAt(s1.id, A)).toBe(7);
    expect(await qtyAt(s2.id, A)).toBe(5);
  });

  test('satu baris melebihi stok menolak SELURUH batch: "Baris 3: Stok tidak cukup"; stok dan riwayat utuh', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    await seedQty(s1.id, A, 10);
    await seedQty(s2.id, A, 2);
    const before = await entryCount();
    const error = await captureAppErrorAsync(() =>
      recordStockBatch(
        env,
        recordBatch('out', 'kirim', [
          { stickerId: s1.id, locationId: A, quantity: 3 },
          { stickerId: s1.id, locationId: B, quantity: 1 },
          { stickerId: s2.id, locationId: A, quantity: 3 },
        ]),
        admin,
      ),
    );
    expect(error.code).toBe('VALIDATION');
    // baris 2 lebih dulu melanggar (tak ada stok di B); baris berikutnya tak dihitung
    expect(error.message).toBe('Baris 2: Stok tidak cukup');
    expect(await qtyAt(s1.id, A)).toBe(10);
    expect(await qtyAt(s2.id, A)).toBe(2);
    expect(await entryCount()).toBe(before);
    const third = await captureAppErrorAsync(() =>
      recordStockBatch(
        env,
        recordBatch('out', 'kirim', [
          { stickerId: s1.id, locationId: A, quantity: 3 },
          { stickerId: s2.id, locationId: A, quantity: 3 },
        ]),
        admin,
      ),
    );
    expect(third.message).toBe('Baris 2: Stok tidak cukup');
  });

  test('keluar diizinkan pada stiker nonaktif; stiker deprecated yang kosong menjadi inactive', async () => {
    const off = await newSticker();
    const dep = await newSticker();
    await seedQty(off.id, A, 5);
    await seedQty(dep.id, A, 3);
    await env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = ?").bind(off.id).run();
    await env.DB.prepare("UPDATE stickers SET status = 'deprecated' WHERE id = ?")
      .bind(dep.id)
      .run();
    await recordStockBatch(
      env,
      recordBatch('out', 'habis', [
        { stickerId: off.id, locationId: A, quantity: 2 },
        { stickerId: dep.id, locationId: A, quantity: 3 },
      ]),
      admin,
    );
    expect(await qtyAt(off.id, A)).toBe(3);
    expect(await statusOf(off.id)).toBe('inactive');
    expect(await qtyAt(dep.id, A)).toBe(0);
    expect(await statusOf(dep.id)).toBe('inactive');
  });

  test('dua batch keluar serentak berebut stok yang sama: tepat satu berhasil, stok tak negatif, tanpa deadlock tak tertangani', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    await seedQty(s1.id, A, 10);
    await seedQty(s2.id, A, 10);
    const rowsAB = [
      { stickerId: s1.id, locationId: A, quantity: 8 },
      { stickerId: s2.id, locationId: A, quantity: 8 },
    ];
    // urutan baris dibalik: urutan kunci tetap di server mencegah saling tunggu
    const settled = await Promise.allSettled([
      recordStockBatch(env, recordBatch('out', 'x', rowsAB), admin),
      recordStockBatch(env, recordBatch('out', 'y', [...rowsAB].reverse()), admin),
    ]);
    expect(settled.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const failed = settled.find((entry) => entry.status === 'rejected') as PromiseRejectedResult;
    expect((failed.reason as { code?: string }).code).toBe('VALIDATION');
    expect(await qtyAt(s1.id, A)).toBe(2);
    expect(await qtyAt(s2.id, A)).toBe(2);
    // yang gagal tak menulis setengah: tepat dua entri keluar dari batch yang berhasil
    const outs = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM sticker_stock_entries WHERE kind = 'out'",
    ).first<{ n: number | string }>();
    expect(Number(outs?.n)).toBe(2);
  });
});

describe('stickerStock.adjustBatch', () => {
  test('koreksi positif dan negatif banyak baris; alasan disalin; hasil urut masukan; boleh pada stiker nonaktif', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    await seedQty(s1.id, A, 10);
    await seedQty(s2.id, B, 4);
    await env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = ?").bind(s2.id).run();
    const entries = await adjustStockBatch(
      env,
      validateAdjustStockBatch({
        reason: 'hasil hitung ulang',
        rows: [
          { stickerId: s2.id, locationId: B, delta: -4 },
          { stickerId: s1.id, locationId: A, delta: -3 },
          { stickerId: s1.id, locationId: C, delta: 9 },
        ],
      }),
      admin,
    );
    expect(entries.map((entry) => [entry.stickerId, entry.locationId, entry.delta])).toEqual([
      [s2.id, B, -4],
      [s1.id, A, -3],
      [s1.id, C, 9],
    ]);
    expect(entries.every((entry) => entry.kind === 'adjust')).toBe(true);
    expect(entries.every((entry) => entry.reason === 'hasil hitung ulang')).toBe(true);
    expect(entries.map((entry) => entry.qtyAfter)).toEqual([0, 7, 9]);
  });

  test('satu koreksi di bawah nol menolak SELURUH batch dengan nomor baris; stiker terhapus = NOT_FOUND', async () => {
    const s1 = await newSticker();
    await seedQty(s1.id, A, 5);
    const error = await captureAppErrorAsync(() =>
      adjustStockBatch(
        env,
        validateAdjustStockBatch({
          reason: 'koreksi',
          rows: [
            { stickerId: s1.id, locationId: A, delta: 2 },
            { stickerId: s1.id, locationId: B, delta: -1 },
          ],
        }),
        admin,
      ),
    );
    expect(error.message).toBe('Baris 2: Stok tidak cukup');
    expect(await qtyAt(s1.id, A)).toBe(5);
    await env.DB.prepare(
      "UPDATE stickers SET status = 'inactive', deleted_at = '2026-11-20T00:00:00.000Z', deleted_by = 'seed' WHERE id = ?",
    )
      .bind(s1.id)
      .run();
    const gone = await captureAppErrorAsync(() =>
      adjustStockBatch(
        env,
        validateAdjustStockBatch({
          reason: 'koreksi',
          rows: [{ stickerId: s1.id, locationId: A, delta: 1 }],
        }),
        admin,
      ),
    );
    expect(gone.code).toBe('NOT_FOUND');
  });
});

describe('validator batch', () => {
  const row = { stickerId: 's1', locationId: A, quantity: 1 };

  test('record: 1..100 baris, pasangan unik, tepat satu dari quantity/count, alasan wajib untuk keluar', () => {
    expect(
      captureAppError(() => validateRecordStockBatch({ kind: 'in', reason: '', rows: [] })).code,
    ).toBe('VALIDATION');
    const many = Array.from({ length: STICKER_LIMITS.opnameRows + 1 }, (_, index) => ({
      stickerId: `s${index}`,
      locationId: A,
      quantity: 1,
    }));
    expect(
      captureAppError(() => validateRecordStockBatch({ kind: 'in', reason: '', rows: many })).code,
    ).toBe('VALIDATION');
    expect(
      validateRecordStockBatch({
        kind: 'in',
        reason: '',
        rows: many.slice(0, STICKER_LIMITS.opnameRows),
      }).rows,
    ).toHaveLength(STICKER_LIMITS.opnameRows);
    const dup = captureAppError(() =>
      validateRecordStockBatch({ kind: 'in', reason: '', rows: [row, { ...row }] }),
    );
    expect(dup.fields).toEqual({ rows: 'Baris 2: pasangan stiker dan lokasi kembar' });
    const both = captureAppError(() =>
      validateRecordStockBatch({
        kind: 'in',
        reason: '',
        rows: [{ ...row, count: { rows: [], loose: 1 } }],
      }),
    );
    expect(both.fields).toEqual({
      rows: 'Baris 1: Isi tepat satu: jumlah butir atau hitungan lembar',
    });
    const neither = captureAppError(() =>
      validateRecordStockBatch({
        kind: 'in',
        reason: '',
        rows: [{ stickerId: 's1', locationId: A }],
      }),
    );
    expect(neither.code).toBe('VALIDATION');
    for (const quantity of [0, -1, 1.5, '3', STICKER_LIMITS.qtyMax + 1]) {
      expect(
        captureAppError(() =>
          validateRecordStockBatch({ kind: 'in', reason: '', rows: [{ ...row, quantity }] }),
        ).code,
      ).toBe('VALIDATION');
    }
    const noReason = captureAppError(() =>
      validateRecordStockBatch({ kind: 'out', reason: '  ', rows: [row] }),
    );
    expect(noReason.fields).toEqual({ reason: 'Alasan wajib diisi' });
    expect(
      captureAppError(() => validateRecordStockBatch({ kind: 'lain', reason: '', rows: [row] }))
        .code,
    ).toBe('VALIDATION');
  });

  test('locationIds diturunkan server dari semua baris (isian klien diabaikan)', () => {
    const parsed = validateRecordStockBatch({
      kind: 'in',
      reason: '',
      locationIds: ['loc-palsu'],
      rows: [
        row,
        { stickerId: 's2', locationId: B, quantity: 2 },
        { stickerId: 's3', locationId: A, quantity: 3 },
      ],
    });
    expect(parsed.locationIds).toEqual([A, B]);
    const adjust = validateAdjustStockBatch({
      reason: 'x',
      rows: [
        { stickerId: 's1', locationId: C, delta: 1 },
        { stickerId: 's2', locationId: A, delta: -1 },
      ],
    });
    expect(adjust.locationIds).toEqual([C, A]);
  });

  test('adjust: alasan wajib, delta bulat bukan 0 dan dalam batas', () => {
    const base = { stickerId: 's1', locationId: A };
    expect(
      captureAppError(() => validateAdjustStockBatch({ reason: '', rows: [{ ...base, delta: 1 }] }))
        .code,
    ).toBe('VALIDATION');
    for (const delta of [
      0,
      1.5,
      '1',
      null,
      STICKER_LIMITS.qtyMax + 1,
      -STICKER_LIMITS.qtyMax - 1,
    ]) {
      expect(
        captureAppError(() => validateAdjustStockBatch({ reason: 'x', rows: [{ ...base, delta }] }))
          .code,
      ).toBe('VALIDATION');
    }
    expect(
      validateAdjustStockBatch({ reason: 'x', rows: [{ ...base, delta: -STICKER_LIMITS.qtyMax }] })
        .rows,
    ).toHaveLength(1);
  });
});

describe('izin dan lokasi (REST)', () => {
  const body = (stickerId: string, rows: Array<{ locationId: string }>) => ({
    kind: 'in',
    reason: '',
    rows: rows.map((entry) => ({ stickerId, locationId: entry.locationId, quantity: 2 })),
  });

  test('izin rute: recordBatch edit, adjustBatch manage; keduanya berlokasi (modul stickerstock)', () => {
    const routes = getRoutes();
    const loc = (level: 'edit' | 'manage') =>
      ({ module: 'stickerstock', level, scope: 'location' }) as never;
    expect(routes['stickerStock.recordBatch'].permission).toEqual(loc('edit'));
    expect(routes['stickerStock.adjustBatch'].permission).toEqual(loc('manage'));
  });

  test('satu lokasi di luar hak menolak seluruh batch (FORBIDDEN) tanpa menulis; semua lokasi berhak berhasil', async () => {
    const sticker = await newSticker();
    const denied = await restCall(
      env,
      'edit-ab@gmail.com',
      'stickerStock.recordBatch',
      body(sticker.id, [{ locationId: A }, { locationId: C }]),
    );
    expect(denied).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await qtyAt(sticker.id, A)).toBeNull();
    const ok = await restCall(
      env,
      'edit-ab@gmail.com',
      'stickerStock.recordBatch',
      body(sticker.id, [{ locationId: A }, { locationId: B }]),
    );
    expect(ok).toMatchObject({ ok: true });
    expect((ok as { data: unknown[] }).data).toHaveLength(2);
    expect(await qtyAt(sticker.id, B)).toBe(2);
  });

  test('klien tak dapat menyelundupkan lokasi lewat locationIds: lokasi baris tetap diperiksa', async () => {
    const sticker = await newSticker();
    const result = await restCall(env, 'edit-ab@gmail.com', 'stickerStock.recordBatch', {
      ...body(sticker.id, [{ locationId: C }]),
      locationIds: [A],
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await qtyAt(sticker.id, C)).toBeNull();
  });

  test('adjustBatch: edit saja ditolak, manage diterima; lokasi nonaktif atau tak dikenal ditolak', async () => {
    const sticker = await newSticker();
    await seedQty(sticker.id, A, 10);
    const input = {
      reason: 'koreksi',
      rows: [{ stickerId: sticker.id, locationId: A, delta: -2 }],
    };
    expect(
      await restCall(env, 'edit-ab@gmail.com', 'stickerStock.adjustBatch', input),
    ).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(
      await restCall(env, 'manage-ab@gmail.com', 'stickerStock.adjustBatch', input),
    ).toMatchObject({ ok: true, data: [{ delta: -2, qtyAfter: 8, actor: 'manage-ab@gmail.com' }] });
    expect(
      await restCall(env, 'admin@gmail.com', 'stickerStock.adjustBatch', {
        ...input,
        rows: [{ stickerId: sticker.id, locationId: 'tidak-ada', delta: 1 }],
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});

describe('perilaku lama tak berubah', () => {
  test('recordStock tunggal tetap memakai pesan dan kunci galat lama', async () => {
    const sticker = await newSticker();
    await env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = ?")
      .bind(sticker.id)
      .run();
    const error = await captureAppErrorAsync(() =>
      recordStock(
        env,
        validateRecordStock({
          locationId: A,
          stickerId: sticker.id,
          kind: 'in',
          quantity: 1,
          reason: '',
        }),
        admin,
      ),
    );
    expect(error.message).toBe('Stiker nonaktif tidak dapat menerima stok masuk');
    expect(error.fields).toEqual({ stickerId: error.message });
  });
});

describe('stickerStock.recordBatch/adjustBatch: idempoten (clientId, K1)', () => {
  const ID1 = '11111111-1111-4111-8111-111111111111';
  const ID2 = '22222222-2222-4222-8222-222222222222';

  test('kiriman ulang oleh pelaku yang sama mengembalikan entri yang sama tanpa menulis ulang', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    const input = recordBatch('in', 'kiriman gudang', [
      { stickerId: s1.id, locationId: A, quantity: 5, clientId: ID1 },
      { stickerId: s2.id, locationId: A, quantity: 3, clientId: ID2 },
    ]);
    const first = await recordStockBatch(env, input, admin);
    const again = await recordStockBatch(env, input, admin);
    expect(again.map((entry) => entry.id)).toEqual(first.map((entry) => entry.id));
    expect(await qtyAt(s1.id, A)).toBe(5);
    expect(await qtyAt(s2.id, A)).toBe(3);
    expect(await entryCount()).toBe(2);
  });

  test('kiriman ulang batch keluar tidak memotong stok dua kali', async () => {
    const sticker = await newSticker();
    await seedQty(sticker.id, A, 10);
    const input = recordBatch('out', 'rusak', [
      { stickerId: sticker.id, locationId: A, quantity: 4, clientId: ID1 },
    ]);
    await recordStockBatch(env, input, admin);
    await recordStockBatch(env, input, admin);
    expect(await qtyAt(sticker.id, A)).toBe(6);
  });

  test('koreksi: kiriman ulang idempoten', async () => {
    const sticker = await newSticker();
    await seedQty(sticker.id, A, 10);
    const input = validateAdjustStockBatch({
      reason: 'opname',
      rows: [{ stickerId: sticker.id, locationId: A, delta: -3, clientId: ID1 }],
    });
    const first = await adjustStockBatch(env, input, admin);
    const again = await adjustStockBatch(env, input, admin);
    expect(again[0]?.id).toBe(first[0]?.id);
    expect(await qtyAt(sticker.id, A)).toBe(7);
  });

  test('clientId milik pelaku lain = CONFLICT generik; tak menulis apa pun', async () => {
    const sticker = await newSticker();
    const input = recordBatch('in', '', [
      { stickerId: sticker.id, locationId: A, quantity: 5, clientId: ID1 },
    ]);
    await recordStockBatch(env, input, admin);
    const other = await loadUserContext(env, 'manage-ab@gmail.com');
    if (!other) throw new Error('manage hilang');
    const error = await captureAppErrorAsync(() => recordStockBatch(env, input, other));
    expect(error.code).toBe('CONFLICT');
    expect(await qtyAt(sticker.id, A)).toBe(5);
    expect(await entryCount()).toBe(1);
  });

  test('sebagian clientId sudah ada = CONFLICT; tak menulis baris baru', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    await recordStockBatch(
      env,
      recordBatch('in', '', [{ stickerId: s1.id, locationId: A, quantity: 5, clientId: ID1 }]),
      admin,
    );
    const error = await captureAppErrorAsync(() =>
      recordStockBatch(
        env,
        recordBatch('in', '', [
          { stickerId: s1.id, locationId: A, quantity: 5, clientId: ID1 },
          { stickerId: s2.id, locationId: A, quantity: 2, clientId: ID2 },
        ]),
        admin,
      ),
    );
    expect(error.code).toBe('CONFLICT');
    expect(await qtyAt(s2.id, A)).toBeNull();
    expect(await entryCount()).toBe(1);
  });

  test('clientId sama dengan isi berbeda (jumlah, jenis, alasan, rute) = CONFLICT; entri dan stok tak berubah; pesan tak memuat isi lama', async () => {
    const sticker = await newSticker();
    await seedQty(sticker.id, A, 20);
    await recordStockBatch(
      env,
      recordBatch('out', 'rusak', [
        { stickerId: sticker.id, locationId: A, quantity: 4, clientId: ID1 },
      ]),
      admin,
    );
    const variants = [
      recordBatch('out', 'rusak', [
        { stickerId: sticker.id, locationId: A, quantity: 9, clientId: ID1 },
      ]),
      recordBatch('in', 'rusak', [
        { stickerId: sticker.id, locationId: A, quantity: 4, clientId: ID1 },
      ]),
      recordBatch('out', 'alasan lain', [
        { stickerId: sticker.id, locationId: A, quantity: 4, clientId: ID1 },
      ]),
    ];
    for (const input of variants) {
      const error = await captureAppErrorAsync(() => recordStockBatch(env, input, admin));
      expect(error.code).toBe('CONFLICT');
      expect(error.message).not.toContain('rusak');
    }
    const asAdjust = await captureAppErrorAsync(() =>
      adjustStockBatch(
        env,
        validateAdjustStockBatch({
          reason: 'rusak',
          rows: [{ stickerId: sticker.id, locationId: A, delta: -4, clientId: ID1 }],
        }),
        admin,
      ),
    );
    expect(asAdjust.code).toBe('CONFLICT');
    expect(await qtyAt(sticker.id, A)).toBe(16);
    expect(await entryCount()).toBe(2);
  });

  test('tanpa clientId perilaku lama: kiriman ulang menambah lagi', async () => {
    const sticker = await newSticker();
    const input = recordBatch('in', '', [{ stickerId: sticker.id, locationId: A, quantity: 5 }]);
    await recordStockBatch(env, input, admin);
    await recordStockBatch(env, input, admin);
    expect(await qtyAt(sticker.id, A)).toBe(10);
  });

  test('validator: clientId harus UUID huruf kecil dan tak boleh kembar dalam satu permintaan', () => {
    const base = { stickerId: 's1', locationId: A, quantity: 1 };
    expect(
      captureAppError(() =>
        validateRecordStockBatch({
          kind: 'in',
          reason: '',
          rows: [{ ...base, clientId: 'bukan-uuid' }],
        }),
      ).code,
    ).toBe('VALIDATION');
    expect(
      captureAppError(() =>
        validateRecordStockBatch({
          kind: 'in',
          reason: '',
          rows: [
            { ...base, clientId: ID1 },
            { ...base, stickerId: 's2', clientId: ID1 },
          ],
        }),
      ).code,
    ).toBe('VALIDATION');
    expect(
      validateRecordStockBatch({ kind: 'in', reason: '', rows: [{ ...base, clientId: ID1 }] })
        .rows[0]?.clientId,
    ).toBe(ID1);
  });
});
