import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { isGuardFailure } from '@server/core/cas';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { seedLocation } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { StickerDto, StickerTypeDto } from '@shared/contract';
import { saveSticker, saveStickerType } from './service';
import { serialDeductStmts } from './stock-repo';
import { opnameStock, recordStock, stockHistory } from './stock-service';
import { validateOpname, validateRecordStock } from './validate';

setDefaultTimeout(60_000);

const A = 'loc-a';

let env: TestEnv;
let admin: UserContext;
let type: StickerTypeDto;
let counter = 0;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T00:00:00.000Z'));
  const ctx = await loadUserContext(env, 'admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
  await seedLocation(env, { id: A, code: 'A' });
  type = await saveStickerType(env, { name: 'Umum', rule: 'none' }, admin);
});

async function newSticker(): Promise<StickerDto> {
  counter += 1;
  return saveSticker(
    env,
    {
      typeId: type.id,
      name: `Stiker SN ${counter}`,
      alias: '',
      fileId: null,
      minQty: 0,
      businessUnitIds: [],
    } as never,
    admin,
  );
}

const stockIn = (stickerId: string, quantity: number) =>
  recordStock(
    env,
    validateRecordStock({ locationId: A, stickerId, kind: 'in', quantity, reason: 'uji' }),
    admin,
  );

async function qtyAt(stickerId: string): Promise<number | null> {
  const row = await env.DB.prepare(
    'SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = ?',
  )
    .bind(stickerId, A)
    .first<{ qty: number | string }>();
  return row ? Number(row.qty) : null;
}

const deduct = (
  picks: { stickerId: string; qty: number }[],
  ids: { serialId: string; eventId: string } = { serialId: 'sn-1', eventId: 'ev-1' },
) =>
  env.DB.batch(
    serialDeductStmts(env.DB, {
      ...ids,
      locationId: A,
      picks,
      actor: 'admin@gmail.com',
      now: '2026-11-12T00:00:00.000Z',
    }),
  );

describe('serialDeductStmts: rejectInactive (kenaikan stiker pada cek ulang)', () => {
  const deductRaise = (picks: { stickerId: string; qty: number }[]) =>
    env.DB.batch(
      serialDeductStmts(env.DB, {
        serialId: 'sn-1',
        eventId: 'ev-r',
        locationId: A,
        picks,
        actor: 'admin@gmail.com',
        now: '2026-11-12T00:00:00.000Z',
        rejectInactive: true,
      }),
    );

  test('stiker inactive: seluruh batch batal (guard CAS), stok dan riwayat tak berubah, termasuk stiker lain di batch', async () => {
    const off = await newSticker();
    const ok = await newSticker();
    await stockIn(off.id, 5);
    await stockIn(ok.id, 5);
    await env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = ?").bind(off.id).run();
    let failure: unknown;
    try {
      await deductRaise([
        { stickerId: ok.id, qty: 1 },
        { stickerId: off.id, qty: 1 },
      ]);
    } catch (error) {
      failure = error;
    }
    expect(isGuardFailure(failure)).toBe(true);
    expect(await qtyAt(off.id)).toBe(5);
    expect(await qtyAt(ok.id)).toBe(5);
    const entries = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM sticker_stock_entries WHERE kind = 'serial'",
    ).first<{ n: number | string }>();
    expect(Number(entries?.n)).toBe(0);
  });

  test('stiker active dan deprecated lolos dan terpotong; tanpa flag, inactive tetap dipotong (pencatatan baru)', async () => {
    const active = await newSticker();
    const dep = await newSticker();
    const off = await newSticker();
    for (const sticker of [active, dep, off]) await stockIn(sticker.id, 5);
    await env.DB.prepare("UPDATE stickers SET status = 'deprecated' WHERE id = ?")
      .bind(dep.id)
      .run();
    await deductRaise([
      { stickerId: active.id, qty: 2 },
      { stickerId: dep.id, qty: 2 },
    ]);
    expect(await qtyAt(active.id)).toBe(3);
    expect(await qtyAt(dep.id)).toBe(3);
    await env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = ?").bind(off.id).run();
    await deduct([{ stickerId: off.id, qty: 1 }], { serialId: 'sn-2', eventId: 'ev-2' });
    expect(await qtyAt(off.id)).toBe(4);
  });
});

describe('serialDeductStmts', () => {
  test('stok 1, potong 3 -> -2; satu entri kind serial dengan serial_id dan serial_event_id', async () => {
    const sticker = await newSticker();
    await stockIn(sticker.id, 1);
    await deduct([{ stickerId: sticker.id, qty: 3 }]);
    expect(await qtyAt(sticker.id)).toBe(-2);
    const rows = await env.DB.prepare(
      "SELECT kind, delta, qty_after, serial_id, serial_event_id FROM sticker_stock_entries WHERE sticker_id = ? AND kind = 'serial'",
    )
      .bind(sticker.id)
      .all<{
        kind: string;
        delta: number | string;
        qty_after: number | string;
        serial_id: string;
        serial_event_id: string;
      }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      kind: 'serial',
      serial_id: 'sn-1',
      serial_event_id: 'ev-1',
    });
    expect(Number(rows.results[0]?.delta)).toBe(-3);
    expect(Number(rows.results[0]?.qty_after)).toBe(-2);
  });

  test('stok belum punya baris: baris dibuat dengan nilai negatif', async () => {
    const sticker = await newSticker();
    await deduct([{ stickerId: sticker.id, qty: 2 }]);
    expect(await qtyAt(sticker.id)).toBe(-2);
  });

  test('dua pemotongan serentak atas pasangan stiker yang sama (urutan masukan terbalik): total benar, tanpa galat', async () => {
    const s1 = await newSticker();
    const s2 = await newSticker();
    await stockIn(s1.id, 10);
    await stockIn(s2.id, 10);
    await Promise.all([
      deduct(
        [
          { stickerId: s1.id, qty: 1 },
          { stickerId: s2.id, qty: 2 },
        ],
        { serialId: 'sn-a', eventId: 'ev-a' },
      ),
      deduct(
        [
          { stickerId: s2.id, qty: 3 },
          { stickerId: s1.id, qty: 4 },
        ],
        { serialId: 'sn-b', eventId: 'ev-b' },
      ),
    ]);
    expect(await qtyAt(s1.id)).toBe(5);
    expect(await qtyAt(s2.id)).toBe(5);
  });

  test('stiker deprecated dengan total -1 sesudah pemotongan menjadi inactive', async () => {
    const sticker = await newSticker();
    await stockIn(sticker.id, 2);
    await env.DB.prepare("UPDATE stickers SET status = 'deprecated' WHERE id = ?")
      .bind(sticker.id)
      .run();
    await deduct([{ stickerId: sticker.id, qty: 3 }]);
    const row = await env.DB.prepare('SELECT status FROM stickers WHERE id = ?')
      .bind(sticker.id)
      .first<{ status: string }>();
    expect(row?.status).toBe('inactive');
  });
});

describe('stok negatif dan jalur stok lain', () => {
  test('stok keluar manual pada baris negatif ditolak; stok masuk +5 pada -2 menghasilkan 3', async () => {
    const sticker = await newSticker();
    await stockIn(sticker.id, 1);
    await deduct([{ stickerId: sticker.id, qty: 3 }]);
    const error = await captureAppErrorAsync(() =>
      recordStock(
        env,
        validateRecordStock({
          locationId: A,
          stickerId: sticker.id,
          kind: 'out',
          quantity: 1,
          reason: 'uji',
        }),
        admin,
      ),
    );
    expect(error.code).toBe('VALIDATION');
    expect(await qtyAt(sticker.id)).toBe(-2);
    const entry = await stockIn(sticker.id, 5);
    expect(entry.qtyAfter).toBe(3);
    expect(await qtyAt(sticker.id)).toBe(3);
  });

  test('opname dengan expectedQty -2 diterima dan menyetel nilai baru', async () => {
    const sticker = await newSticker();
    await stockIn(sticker.id, 1);
    await deduct([{ stickerId: sticker.id, qty: 3 }]);
    const out = await opnameStock(
      env,
      validateOpname({
        rows: [
          {
            stickerId: sticker.id,
            locationId: A,
            expectedQty: -2,
            count: { rows: [{ sheets: 1, perSheet: 4 }], loose: 0 },
          },
        ],
      }),
      admin,
    );
    expect(out[0]).toMatchObject({ kind: 'opname', delta: 6, qtyAfter: 4 });
    expect(await qtyAt(sticker.id)).toBe(4);
  });

  test('riwayat mengembalikan kind serial tanpa serialId di DTO', async () => {
    const sticker = await newSticker();
    await deduct([{ stickerId: sticker.id, qty: 1 }]);
    const page = await stockHistory(env, { stickerId: sticker.id } as never, [A]);
    expect(page.entries[0]?.kind).toBe('serial');
    expect(Object.keys(page.entries[0] ?? {})).not.toContain('serialId');
    expect(Object.keys(page.entries[0] ?? {})).not.toContain('serialEventId');
  });
});
