import { beforeEach, describe, expect, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppError, captureAppErrorAsync } from '@server-test/errors';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { StickerTypeDto } from '@shared/contract';
import { listStickers, listStickerTypes, saveSticker, saveStickerType } from './service';
import { getStickerSettings, saveStickerSettings } from './settings';
import { listStickerStock, recordStockBatch } from './stock-service';
import { validateRecordStockBatch, validateSaveSticker, validateSaveStickerType } from './validate';

let env: TestEnv;
let admin: UserContext;
let editorWithStock: UserContext;
let editorNoStock: UserContext;
let none: StickerTypeDto;

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

const stickerInput = (overrides: Record<string, unknown> = {}) =>
  validateSaveSticker({
    typeId: none.id,
    name: 'Stiker Baru',
    alias: '',
    fileId: null,
    businessUnitIds: [],
    ...overrides,
  });

async function userOf(email: string): Promise<UserContext> {
  const user = await loadUserContext(env, email);
  if (!user) throw new Error(`${email} hilang`);
  return user;
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-25T00:00:00.000Z'));
  await seedLocation(env, { id: 'loc1', code: 'L1' });
  admin = await userOf('admin@gmail.com');
  await seedRole(env, {
    id: 'r-edit-stock',
    name: 'Edit stiker + stok',
    permissions: { sticker: 'edit', stickerstock: 'edit' },
  });
  await seedRole(env, { id: 'r-edit', name: 'Edit stiker', permissions: { sticker: 'edit' } });
  await seedUser(env, { id: 'u-es', email: 'es@gmail.com', roleIds: ['r-edit-stock'] });
  await seedUser(env, { id: 'u-e', email: 'e@gmail.com', roleIds: ['r-edit'] });
  editorWithStock = await userOf('es@gmail.com');
  editorNoStock = await userOf('e@gmail.com');
  none = await saveStickerType(env, { name: 'Umum', rule: 'none' }, admin);
});

describe('minimum bawaan jenis pada stiker baru', () => {
  test('minQty tidak dikirim saat membuat = default_min_qty jenisnya', async () => {
    const type = await saveStickerType(
      env,
      validateSaveStickerType({ name: 'Dengan Default', rule: 'none', defaultMinQty: 12 }),
      admin,
    );
    expect(type.defaultMinQty).toBe(12);
    const saved = await saveSticker(env, stickerInput({ typeId: type.id }), admin);
    expect(saved.minQty).toBe(12);
  });

  test('minQty yang dikirim (termasuk 0) menang atas default jenis', async () => {
    const type = await saveStickerType(
      env,
      validateSaveStickerType({ name: 'Dengan Default', rule: 'none', defaultMinQty: 12 }),
      admin,
    );
    const saved = await saveSticker(env, stickerInput({ typeId: type.id, minQty: 0 }), admin);
    expect(saved.minQty).toBe(0);
  });

  test('mengubah stiker tetap mewajibkan minQty', () => {
    const error = captureAppError(() => stickerInput({ id: 's1', expectedUpdatedAt: 'x' }));
    expect(error.fields?.minQty).toBeDefined();
  });
});

describe('minimum bawaan di form Jenis (satu kolom, dua pintu)', () => {
  test('mengubah default lewat stickerTypes.save butuh sticker: manage', async () => {
    const error = await captureAppErrorAsync(() =>
      saveStickerType(
        env,
        validateSaveStickerType({
          id: none.id,
          expectedUpdatedAt: none.updatedAt,
          name: none.name,
          rule: none.rule,
          defaultMinQty: 5,
        }),
        editorNoStock,
      ),
    );
    expect(error.code).toBe('FORBIDDEN');
    const created = await captureAppErrorAsync(() =>
      saveStickerType(
        env,
        validateSaveStickerType({ name: 'Baru', rule: 'none', defaultMinQty: 3 }),
        editorNoStock,
      ),
    );
    expect(created.code).toBe('FORBIDDEN');
  });

  test('editor tanpa manage tetap boleh mengubah nama bila default tak berubah', async () => {
    const saved = await saveStickerType(
      env,
      validateSaveStickerType({
        id: none.id,
        expectedUpdatedAt: none.updatedAt,
        name: 'Umum 2',
        rule: none.rule,
        defaultMinQty: 0,
      }),
      editorNoStock,
    );
    expect(saved.name).toBe('Umum 2');
  });

  test('pemegang manage menyimpan default; halaman Konfigurasi membacanya dan sebaliknya', async () => {
    const saved = await saveStickerType(
      env,
      validateSaveStickerType({
        id: none.id,
        expectedUpdatedAt: none.updatedAt,
        name: none.name,
        rule: none.rule,
        defaultMinQty: 7,
      }),
      admin,
    );
    expect(saved.defaultMinQty).toBe(7);
    const settings = await getStickerSettings(env);
    expect(settings.types.find((type) => type.id === none.id)?.defaultMinQty).toBe(7);

    await saveStickerSettings(
      env,
      {
        expectedUpdatedAt: settings.updatedAt,
        alert: settings.alert,
        defaults: [{ typeId: none.id, defaultMinQty: 9 }],
      },
      admin,
    );
    const types = await listStickerTypes(env);
    expect(types.find((type) => type.id === none.id)?.defaultMinQty).toBe(9);
  });

  test('form Jenis yang dibuka sebelum perubahan dari Konfigurasi menjadi usang, bukan menimpa', async () => {
    const settings = await getStickerSettings(env);
    env.clock.set(Date.parse('2026-11-25T01:00:00.000Z'));
    await saveStickerSettings(
      env,
      {
        expectedUpdatedAt: settings.updatedAt,
        alert: settings.alert,
        defaults: [{ typeId: none.id, defaultMinQty: 9 }],
      },
      admin,
    );
    const error = await captureAppErrorAsync(() =>
      saveStickerType(
        env,
        validateSaveStickerType({
          id: none.id,
          expectedUpdatedAt: none.updatedAt,
          name: none.name,
          rule: none.rule,
          defaultMinQty: 0,
        }),
        admin,
      ),
    );
    expect(error.code).toBe('CONFLICT');
  });

  test('jenis sistem: hanya minimum bawaan yang boleh diubah (nama dan aturan terkunci)', async () => {
    const { ensureSystemStickerTypes } = await import('./system-types');
    await ensureSystemStickerTypes(env);
    const postel = (await listStickerTypes(env)).find((type) => type.systemKind === 'postel');
    if (!postel) throw new Error('jenis Postel hilang');
    const save = (overrides: Record<string, unknown>, actor: UserContext) =>
      saveStickerType(
        env,
        validateSaveStickerType({
          id: postel.id,
          expectedUpdatedAt: postel.updatedAt,
          name: postel.name,
          rule: postel.rule,
          defaultMinQty: 4,
          ...overrides,
        }),
        actor,
      );
    const saved = await save({}, admin);
    expect(saved.defaultMinQty).toBe(4);
    expect(saved.name).toBe(postel.name);
    expect(saved.status).toBe('active');
    const renamed = await captureAppErrorAsync(() =>
      save({ name: 'Postel 2', expectedUpdatedAt: saved.updatedAt }, admin),
    );
    expect(renamed.code).toBe('VALIDATION');
    const noManage = await captureAppErrorAsync(() =>
      save({ defaultMinQty: 9, expectedUpdatedAt: saved.updatedAt }, editorNoStock),
    );
    expect(noManage.code).toBe('FORBIDDEN');
  });

  test('aturan group hanya untuk jenis sistem: jenis biasa baru atau diubah ke group ditolak', async () => {
    const created = await captureAppErrorAsync(() =>
      saveStickerType(env, validateSaveStickerType({ name: 'Baru', rule: 'group' }), admin),
    );
    expect(created.code).toBe('VALIDATION');
    const changed = await captureAppErrorAsync(() =>
      saveStickerType(
        env,
        validateSaveStickerType({
          id: none.id,
          expectedUpdatedAt: none.updatedAt,
          name: none.name,
          rule: 'group',
        }),
        admin,
      ),
    );
    expect(changed.code).toBe('VALIDATION');
  });

  test('default di luar rentang ditolak validator', () => {
    const error = captureAppError(() =>
      validateSaveStickerType({ name: 'X', rule: 'none', defaultMinQty: -1 }),
    );
    expect(error.fields?.defaultMinQty).toBeDefined();
  });
});

describe('stok awal saat membuat stiker', () => {
  test('mencatat stok masuk "Stok awal" bersama stiker (atomik) dan stok per lokasi', async () => {
    const saved = await saveSticker(
      env,
      stickerInput({
        minQty: 5,
        openingStocks: [{ locationId: 'loc1', quantity: 20, clientId: UUID_A }],
      }),
      editorWithStock,
    );
    expect(saved.low).toBe(false);
    const rows = await listStickerStock(env, ['loc1']);
    expect(rows.find((row) => row.stickerId === saved.id)?.total).toBe(20);
    const entry = await env.DB.prepare(
      'SELECT kind, delta, qty_after, reason, actor FROM sticker_stock_entries WHERE sticker_id = ?',
    )
      .bind(saved.id)
      .first<{ kind: string; delta: number; qty_after: number; reason: string; actor: string }>();
    expect(entry).toMatchObject({
      kind: 'in',
      delta: 20,
      qty_after: 20,
      reason: 'Stok awal',
      actor: 'es@gmail.com',
    });
  });

  test('tanpa izin stok di lokasi itu = FORBIDDEN dan stiker tidak dibuat', async () => {
    const error = await captureAppErrorAsync(() =>
      saveSticker(
        env,
        stickerInput({ openingStocks: [{ locationId: 'loc1', quantity: 3, clientId: UUID_A }] }),
        editorNoStock,
      ),
    );
    expect(error.code).toBe('FORBIDDEN');
    expect(await listStickers(env)).toEqual([]);
  });

  test('lokasi tak dikenal ditolak', async () => {
    const error = await captureAppErrorAsync(() =>
      saveSticker(
        env,
        stickerInput({ openingStocks: [{ locationId: 'nihil', quantity: 3, clientId: UUID_A }] }),
        admin,
      ),
    );
    expect(error.code).toBe('FORBIDDEN');
  });

  test('kegagalan pembuatan (nama kembar) tidak meninggalkan stok yatim', async () => {
    await saveSticker(env, stickerInput(), admin);
    const error = await captureAppErrorAsync(() =>
      saveSticker(
        env,
        stickerInput({ openingStocks: [{ locationId: 'loc1', quantity: 4, clientId: UUID_A }] }),
        admin,
      ),
    );
    expect(error.code).toBe('CONFLICT');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM sticker_stock_entries').first<{
      n: number | string;
    }>();
    expect(Number(count?.n)).toBe(0);
  });

  test('clientId sama dikirim ulang mengembalikan stiker yang sama tanpa menggandakan stok', async () => {
    const input = stickerInput({
      openingStocks: [{ locationId: 'loc1', quantity: 8, clientId: UUID_A }],
    });
    const first = await saveSticker(env, input, editorWithStock);
    const again = await saveSticker(env, input, editorWithStock);
    expect(again.id).toBe(first.id);
    const stock = await listStickerStock(env, ['loc1']);
    expect(stock.find((row) => row.stickerId === first.id)?.total).toBe(8);
    const entries = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM sticker_stock_entries WHERE sticker_id = ?',
    )
      .bind(first.id)
      .first<{ n: number | string }>();
    expect(Number(entries?.n)).toBe(1);
  });

  test('clientId milik pelaku lain = CONFLICT generik', async () => {
    const input = stickerInput({
      openingStocks: [{ locationId: 'loc1', quantity: 8, clientId: UUID_A }],
    });
    await saveSticker(env, input, admin);
    const error = await captureAppErrorAsync(() => saveSticker(env, input, editorWithStock));
    expect(error.code).toBe('CONFLICT');
  });

  test('clientId sama tetapi jumlah berbeda = CONFLICT generik (bukan replay)', async () => {
    await saveSticker(
      env,
      stickerInput({ openingStocks: [{ locationId: 'loc1', quantity: 8, clientId: UUID_A }] }),
      editorWithStock,
    );
    const error = await captureAppErrorAsync(() =>
      saveSticker(
        env,
        stickerInput({
          name: 'Stiker Lain',
          openingStocks: [{ locationId: 'loc1', quantity: 9, clientId: UUID_A }],
        }),
        editorWithStock,
      ),
    );
    expect(error.code).toBe('CONFLICT');
  });

  test('clientId milik entri stok non-"Stok awal" = CONFLICT, bukan replay', async () => {
    const other = await saveSticker(env, stickerInput({ name: 'Stiker Biasa' }), admin);
    await recordStockBatch(
      env,
      validateRecordStockBatch({
        kind: 'in',
        reason: 'kiriman gudang',
        rows: [{ stickerId: other.id, locationId: 'loc1', quantity: 8, clientId: UUID_A }],
      }),
      admin,
    );
    const error = await captureAppErrorAsync(() =>
      saveSticker(
        env,
        stickerInput({ openingStocks: [{ locationId: 'loc1', quantity: 8, clientId: UUID_A }] }),
        admin,
      ),
    );
    expect(error.code).toBe('CONFLICT');
  });

  test('replay yang menunjuk stiker terhapus = CONFLICT generik, bukan DTO terhapus', async () => {
    const input = stickerInput({
      openingStocks: [{ locationId: 'loc1', quantity: 8, clientId: UUID_A }],
    });
    const first = await saveSticker(env, input, editorWithStock);
    await env.DB.prepare("UPDATE stickers SET deleted_at = '2026-11-25T01:00:00.000Z' WHERE id = ?")
      .bind(first.id)
      .run();
    const error = await captureAppErrorAsync(() => saveSticker(env, input, editorWithStock));
    expect(error.code).toBe('CONFLICT');
  });

  test('dua kiriman serentak ber-clientId sama: satu stiker, satu entri stok, keduanya sukses', async () => {
    const input = stickerInput({
      openingStocks: [{ locationId: 'loc1', quantity: 8, clientId: UUID_A }],
    });
    const [a, b] = await Promise.all([
      saveSticker(env, input, editorWithStock),
      saveSticker(env, input, editorWithStock),
    ]);
    expect(a.id).toBe(b.id);
    const entries = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM sticker_stock_entries WHERE client_id = ?',
    )
      .bind(UUID_A)
      .first<{ n: number | string }>();
    expect(Number(entries?.n)).toBe(1);
  });

  test('validator: hanya saat membuat, jumlah bulat >= 1', () => {
    expect(
      captureAppError(() =>
        stickerInput({
          id: 's1',
          expectedUpdatedAt: 'x',
          minQty: 0,
          openingStocks: [{ locationId: 'loc1', quantity: 1, clientId: UUID_A }],
        }),
      ).fields?.openingStock,
    ).toBeDefined();
    for (const quantity of [0, -2, 1.5, '3']) {
      expect(
        captureAppError(() =>
          stickerInput({ openingStocks: [{ locationId: 'loc1', quantity, clientId: UUID_A }] }),
        ).fields?.openingStock,
      ).toBeDefined();
    }
  });

  describe('banyak lokasi', () => {
    let onlyLoc1: UserContext;
    const two = [
      { locationId: 'loc1', quantity: 8, clientId: UUID_A },
      { locationId: 'loc2', quantity: 5, clientId: UUID_B },
    ];

    beforeEach(async () => {
      await seedLocation(env, { id: 'loc2', code: 'L2' });
      await seedUser(env, {
        id: 'u-l1',
        email: 'l1@gmail.com',
        assignments: [{ locationId: 'loc1', roleIds: ['r-edit-stock'] }],
        buAssignments: [{ buId: null, roleIds: ['r-edit-stock'] }],
      });
      onlyLoc1 = await userOf('l1@gmail.com');
      // Muat ulang: hak lokasi dihitung saat konteks dimuat, sedangkan loc2 baru dibuat.
      editorWithStock = await userOf('es@gmail.com');
    });

    const countEntries = async () =>
      Number(
        (
          await env.DB.prepare('SELECT COUNT(*) AS n FROM sticker_stock_entries').first<{
            n: number | string;
          }>()
        )?.n,
      );

    test('dua lokasi tertulis atomik bersama stiker', async () => {
      const saved = await saveSticker(env, stickerInput({ openingStocks: two }), editorWithStock);
      const rows = await listStickerStock(env, ['loc1', 'loc2']);
      const mine = rows.find((row) => row.stickerId === saved.id);
      expect(mine?.total).toBe(13);
      expect(mine?.byLocation).toEqual([
        { locationId: 'loc1', qty: 8 },
        { locationId: 'loc2', qty: 5 },
      ]);
      expect(await countEntries()).toBe(2);
    });

    test('audit sticker.create merinci stok awal per lokasi, urut menurut nama lokasi', async () => {
      await env.DB.prepare("UPDATE locations SET name = 'Toko' WHERE id = 'loc1'").run();
      await env.DB.prepare("UPDATE locations SET name = 'Gudang' WHERE id = 'loc2'").run();
      await saveSticker(env, stickerInput({ openingStocks: two }), editorWithStock);
      const audit = await env.DB.prepare(
        "SELECT `after` FROM audit_log WHERE action = 'sticker.create'",
      ).first<{ after: string }>();
      const after = JSON.parse(audit?.after ?? '{}');
      expect(after.openingStock).toBe(13);
      expect(after.openingStocks).toBe('Gudang (L2): 5; Toko (L1): 8');
      expect(after.openingStockLocation).toBeUndefined();
    });

    test('audit sticker.create dengan satu lokasi', async () => {
      await saveSticker(env, stickerInput({ openingStocks: [two[0]] }), editorWithStock);
      const audit = await env.DB.prepare(
        "SELECT `after` FROM audit_log WHERE action = 'sticker.create'",
      ).first<{ after: string }>();
      const after = JSON.parse(audit?.after ?? '{}');
      expect(after.openingStock).toBe(8);
      expect(after.openingStocks).toBe('L1 (L1): 8');
    });

    test('satu lokasi tanpa hak menggagalkan seluruh permintaan', async () => {
      const error = await captureAppErrorAsync(() =>
        saveSticker(env, stickerInput({ openingStocks: two }), onlyLoc1),
      );
      expect(error.code).toBe('FORBIDDEN');
      expect(await listStickers(env)).toEqual([]);
      expect(await countEntries()).toBe(0);
    });

    test('lokasi ganda dan clientId ganda ditolak validator', () => {
      expect(
        captureAppError(() =>
          stickerInput({
            openingStocks: [
              { locationId: 'loc1', quantity: 1, clientId: UUID_A },
              { locationId: 'loc1', quantity: 2, clientId: UUID_B },
            ],
          }),
        ).fields?.openingStock,
      ).toBeDefined();
      expect(
        captureAppError(() =>
          stickerInput({
            openingStocks: [
              { locationId: 'loc1', quantity: 1, clientId: UUID_A },
              { locationId: 'loc2', quantity: 2, clientId: UUID_A },
            ],
          }),
        ).fields?.openingStock,
      ).toBeDefined();
      expect(
        captureAppError(() => stickerInput({ openingStocks: 'x' })).fields?.openingStock,
      ).toBeDefined();
    });

    test('kiriman ulang multi-baris = replay idempoten', async () => {
      const input = stickerInput({ openingStocks: two });
      const first = await saveSticker(env, input, editorWithStock);
      const again = await saveSticker(env, input, editorWithStock);
      expect(again.id).toBe(first.id);
      expect(await countEntries()).toBe(2);
    });

    test('replay dengan satu baris berbeda = CONFLICT', async () => {
      await saveSticker(env, stickerInput({ openingStocks: two }), editorWithStock);
      const error = await captureAppErrorAsync(() =>
        saveSticker(
          env,
          stickerInput({
            name: 'Lain',
            openingStocks: [two[0], { ...two[1], quantity: 6 }],
          }),
          editorWithStock,
        ),
      );
      expect(error.code).toBe('CONFLICT');
    });

    test('daftar kosong = tanpa stok awal', async () => {
      const saved = await saveSticker(env, stickerInput({ openingStocks: [] }), admin);
      expect(saved.id).toBeDefined();
      expect(await countEntries()).toBe(0);
    });
  });
});
