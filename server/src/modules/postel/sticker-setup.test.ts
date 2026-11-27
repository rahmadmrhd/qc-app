import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { recordStockBatch } from '@server/modules/sticker/stock-service';
import { validateRecordStockBatch } from '@server/modules/sticker/validate';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppError, captureAppErrorAsync } from '@server-test/errors';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { savePostel } from './service';
import { validateSavePostel } from './validate';

// Postel dibuat langsung dari form stiker (keputusan pemilik 2026-11-25): pengaturan stiker (alias, minimum, stok awal)
// ikut `postels.save` dan ditulis di batch yang sama dengan catatan dan stikernya.

setDefaultTimeout(60_000);

let env: TestEnv;
let editor: UserContext;
let editorNoStock: UserContext;

const CLIENT_ID = '33333333-3333-4333-8333-333333333333';

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Json = any;

const body = (extra: Record<string, unknown> = {}) =>
  validateSavePostel({
    note: '',
    itemIds: ['i1'],
    numbers: [{ number: 'A-1', expiresOn: '2027-03-01', link: '' }],
    attachmentIds: [],
    ...extra,
  });

async function rows(sql: string, ...binds: unknown[]): Promise<Json[]> {
  return (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<Json>()
  ).results;
}

async function userOf(email: string): Promise<UserContext> {
  const user = await loadUserContext(env, email);
  if (!user) throw new Error(`${email} hilang`);
  return user;
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-25T03:00:00.000Z'));
  await seedBusinessUnit(env, { id: 'bu-umum', code: 'UMUM' });
  await seedLocation(env, { id: 'loc1', code: 'L1' });
  await seedRole(env, {
    id: 'r-edit',
    name: 'Edit stiker',
    permissions: { sticker: 'edit', item: 'view' },
  });
  await seedRole(env, {
    id: 'r-edit-stock',
    name: 'Edit stiker + stok',
    permissions: { sticker: 'edit', stickerstock: 'edit', item: 'view' },
  });
  await seedUser(env, { id: 'u-es', email: 'es@gmail.com', roleIds: ['r-edit-stock'] });
  await seedUser(env, { id: 'u-e', email: 'e@gmail.com', roleIds: ['r-edit'] });
  editor = await userOf('es@gmail.com');
  editorNoStock = await userOf('e@gmail.com');
  await seedBrand(env, 'PBE');
  await seedItem(env, { id: 'i1', brand: 'PBE', model: 'M5-400' });
});

describe('pengaturan stiker pada postels.save', () => {
  test('alias, minimum, dan stok awal ikut batch pembuatan catatan', async () => {
    const saved = await savePostel(
      env,
      body({
        sticker: {
          alias: 'Postel M5',
          minQty: 7,
          openingStocks: [{ locationId: 'loc1', quantity: 20, clientId: CLIENT_ID }],
        },
      }),
      editor,
    );
    const sticker = (
      await rows(
        'SELECT s.alias, s.min_qty FROM postels p JOIN stickers s ON s.id = p.sticker_id WHERE p.id = ?',
        saved.id,
      )
    )[0];
    expect(sticker).toMatchObject({ alias: 'Postel M5', min_qty: 7 });
    const stock = await rows('SELECT qty FROM sticker_stock');
    expect(Number(stock[0].qty)).toBe(20);
    const entries = await rows('SELECT reason, delta FROM sticker_stock_entries');
    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe('Stok awal');
  });

  test('tanpa pengaturan: stiker bawaan (tanpa stok)', async () => {
    await savePostel(env, body(), editor);
    expect(await rows('SELECT qty FROM sticker_stock')).toHaveLength(0);
  });

  test('kiriman ulang dengan clientId yang sama mengembalikan catatan yang sama tanpa menggandakan', async () => {
    const input = body({
      sticker: { openingStocks: [{ locationId: 'loc1', quantity: 5, clientId: CLIENT_ID }] },
    });
    const first = await savePostel(env, input, editor);
    const second = await savePostel(env, input, editor);
    expect(second.id).toBe(first.id);
    expect(await rows('SELECT id FROM postels')).toHaveLength(1);
    expect(Number((await rows('SELECT qty FROM sticker_stock'))[0].qty)).toBe(5);
  });

  test('clientId sama dengan jumlah berbeda = CONFLICT, bukan replay', async () => {
    await savePostel(
      env,
      body({
        sticker: { openingStocks: [{ locationId: 'loc1', quantity: 5, clientId: CLIENT_ID }] },
      }),
      editor,
    );
    const error = await captureAppErrorAsync(() =>
      savePostel(
        env,
        body({
          itemIds: ['i1'],
          numbers: [{ number: 'A-2', expiresOn: '2027-03-01', link: '' }],
          sticker: { openingStocks: [{ locationId: 'loc1', quantity: 6, clientId: CLIENT_ID }] },
        }),
        editor,
      ),
    );
    expect(error.code).toBe('CONFLICT');
    expect(await rows('SELECT id FROM postels')).toHaveLength(1);
  });

  test('clientId milik entri stok non-"Stok awal" (stiker biasa) = CONFLICT', async () => {
    await seedStickerType(env, { id: 't-plain', name: 'Biasa', rule: 'none' });
    await seedSticker(env, { id: 's-plain', typeId: 't-plain', name: 'Biasa 1' });
    await recordStockBatch(
      env,
      validateRecordStockBatch({
        kind: 'in',
        reason: 'kiriman gudang',
        rows: [{ stickerId: 's-plain', locationId: 'loc1', quantity: 5, clientId: CLIENT_ID }],
      }),
      editor,
    );
    const error = await captureAppErrorAsync(() =>
      savePostel(
        env,
        body({
          sticker: { openingStocks: [{ locationId: 'loc1', quantity: 5, clientId: CLIENT_ID }] },
        }),
        editor,
      ),
    );
    expect(error.code).toBe('CONFLICT');
    expect(await rows('SELECT id FROM postels')).toHaveLength(0);
  });

  test('replay yang menunjuk catatan terhapus = CONFLICT, bukan DTO terhapus', async () => {
    const input = body({
      sticker: { openingStocks: [{ locationId: 'loc1', quantity: 5, clientId: CLIENT_ID }] },
    });
    const first = await savePostel(env, input, editor);
    await env.DB.prepare("UPDATE postels SET deleted_at = '2026-11-25T04:00:00.000Z' WHERE id = ?")
      .bind(first.id)
      .run();
    const error = await captureAppErrorAsync(() => savePostel(env, input, editor));
    expect(error.code).toBe('CONFLICT');
  });

  test('dua kiriman serentak ber-clientId sama: satu catatan, satu entri stok, keduanya sukses', async () => {
    const input = body({
      sticker: { openingStocks: [{ locationId: 'loc1', quantity: 5, clientId: CLIENT_ID }] },
    });
    const [a, b] = await Promise.all([
      savePostel(env, input, editor),
      savePostel(env, input, editor),
    ]);
    expect(a.id).toBe(b.id);
    expect(await rows('SELECT id FROM postels')).toHaveLength(1);
    expect(await rows('SELECT id FROM sticker_stock_entries')).toHaveLength(1);
  });

  test('audit postel.create memuat isian stiker dan stok awal', async () => {
    await savePostel(
      env,
      body({
        sticker: {
          alias: 'Postel M5',
          minQty: 7,
          openingStocks: [{ locationId: 'loc1', quantity: 20, clientId: CLIENT_ID }],
        },
      }),
      editor,
    );
    const audit = await rows("SELECT `after` FROM audit_log WHERE action = 'postel.create'");
    const after = JSON.parse(audit[0].after);
    expect(after).toMatchObject({
      alias: 'Postel M5',
      minQty: 7,
      openingStock: 20,
      openingStocks: 'L1 (L1): 20',
    });
    expect(after.openingStockLocation).toBeUndefined();
  });

  test('stok awal tanpa izin stok pada lokasi itu = FORBIDDEN dan tak ada yang tertulis', async () => {
    const error = await captureAppErrorAsync(() =>
      savePostel(
        env,
        body({
          sticker: { openingStocks: [{ locationId: 'loc1', quantity: 5, clientId: CLIENT_ID }] },
        }),
        editorNoStock,
      ),
    );
    expect(error.code).toBe('FORBIDDEN');
    expect(await rows('SELECT id FROM postels')).toHaveLength(0);
  });

  test('pengaturan stiker ditolak saat mengubah catatan', () => {
    const error = captureAppError(() =>
      body({ id: 'p1', expectedUpdatedAt: 'x', sticker: { alias: 'x' } }),
    );
    expect(error.fields?.sticker).toBeDefined();
  });
});
