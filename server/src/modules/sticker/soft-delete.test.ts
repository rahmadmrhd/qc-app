import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { buildDesktopCatalog, resetDesktopCatalogCache } from '@server/modules/desktop/catalog';
import { assertInstructionRefs } from '@server/modules/item/service';
import { applicableStickersOf } from '@server/modules/serial/applicable';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { withoutOldIndex } from '@server-test/soft-delete';
import {
  seedGuideImage,
  seedManualBookVersion,
  seedSticker,
  seedStickerType,
} from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { ItemStickerPhotoInput, SaveItemInput } from '@shared/contract';
import { manualBookStickerName } from '@shared/stickers';
import { stockDigestRows } from './digest';
import { hasInstructionsOf, replaceItemInstructionStmts } from './instruction-repo';
import { buildInstructionViews } from './instruction-service';
import { ensurePostelType } from './postel';
import {
  getStickerDto,
  getStickerTypeDto,
  listStickers,
  listStickerTypes,
  removeSticker,
  removeStickerBatch,
  removeStickerType,
  removeStickerTypeBatch,
  restoreSticker,
  restoreStickerBatch,
  restoreStickerType,
  restoreStickerTypeBatch,
  setStickerStatusBatch,
  setStickerTypeStatus,
  setStickerTypeStatusBatch,
} from './service';
import { listStickerStock } from './stock-service';

// Soft delete Stiker dan Jenis Stiker (redesain fase 4a, spek soft delete §4.3/§5 dan putusan T1, T2, T9, T10): batch
// status, hapus, pulihkan, penyaringan semua pembaca, rujukan tersimpan, dan penjaga serentak.

setDefaultTimeout(90_000);

let env: TestEnv;
let admin: UserContext;

async function ctxOf(email: string): Promise<UserContext> {
  const ctx = await loadUserContext(env, email);
  if (!ctx) throw new Error(`konteks ${email} tidak ada`);
  return ctx;
}

const NOT_INACTIVE = 'Nonaktifkan stiker dulu sebelum dihapus';
const TYPE_NOT_INACTIVE = 'Nonaktifkan jenis stiker dulu sebelum dihapus';
const SYSTEM_STICKER =
  'Stiker Manual Book dan Postel mengikuti konfigurasinya, jadi tidak bisa dihapus di sini';
const SYSTEM_TYPE = 'Jenis stiker sistem tidak bisa diubah statusnya atau dihapus';

const auditCount = async (action: string): Promise<number> =>
  Number(
    (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?')
        .bind(action)
        .first<{ n: number | string }>()
    )?.n,
  );

const stickerRow = (id: string) =>
  env.DB.prepare('SELECT status, deleted_at, deleted_by FROM stickers WHERE id = ?')
    .bind(id)
    .first<{ status: string; deleted_at: string; deleted_by: string }>();

const typeRow = (id: string) =>
  env.DB.prepare('SELECT status, deleted_at, deleted_by FROM sticker_types WHERE id = ?')
    .bind(id)
    .first<{ status: string; deleted_at: string; deleted_by: string }>();

/** Menandai stiker/jenis terhapus langsung di basis data (mensimulasikan keadaan sesudah hapus). */
const markDeleted = (
  table: 'stickers' | 'sticker_types',
  id: string,
  at = '2026-11-19T00:00:00.000Z',
) =>
  env.DB.prepare(`UPDATE ${table} SET deleted_at = ?, deleted_by = 'seed' WHERE id = ?`)
    .bind(at, id)
    .run();

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-20T00:00:00.000Z'));
  admin = await ctxOf('admin@gmail.com');
  await seedRole(env, { id: 'r-st-view', name: 'Lihat Stiker', permissions: { sticker: 'view' } });
  await seedRole(env, { id: 'r-st-mg', name: 'Kelola Stiker', permissions: { sticker: 'manage' } });
  await seedUser(env, { id: 'u-st-v', email: 'lihat-stiker@gmail.com', roleIds: ['r-st-view'] });
  await seedUser(env, { id: 'u-st-m', email: 'kelola-stiker@gmail.com', roleIds: ['r-st-mg'] });
  await seedStickerType(env, { id: 't1', name: 'Umum', rule: 'none' });
});

describe('stickers.setStatusBatch', () => {
  test('mengubah banyak stiker; audit per stiker; status sama = tanpa audit', async () => {
    for (const id of ['a', 'b', 'c']) await seedSticker(env, { id, typeId: 't1' });
    const result = await setStickerStatusBatch(
      env,
      { ids: ['c', 'a', 'b'], status: 'inactive' },
      admin,
    );
    expect(result.items.map((sticker) => [sticker.id, sticker.status])).toEqual([
      ['c', 'inactive'],
      ['a', 'inactive'],
      ['b', 'inactive'],
    ]);
    expect(await auditCount('sticker.status')).toBe(3);
    const again = await setStickerStatusBatch(env, { ids: ['a', 'b'], status: 'inactive' }, admin);
    expect(again.items.map((sticker) => sticker.status)).toEqual(['inactive', 'inactive']);
    expect(await auditCount('sticker.status')).toBe(3);
  });

  test('satu deprecated -> active menolak SELURUH batch; tak ada yang berubah', async () => {
    await seedSticker(env, { id: 'a', typeId: 't1', status: 'inactive' });
    await seedSticker(env, { id: 'b', typeId: 't1', status: 'deprecated' });
    const error = await captureAppErrorAsync(() =>
      setStickerStatusBatch(env, { ids: ['a', 'b'], status: 'active' }, admin),
    );
    expect(error.code).toBe('VALIDATION');
    expect((await stickerRow('a'))?.status).toBe('inactive');
    expect((await stickerRow('b'))?.status).toBe('deprecated');
    expect(await auditCount('sticker.status')).toBe(0);
  });

  test('stiker terhapus dan id tak dikenal = NOT_FOUND (seluruh batch batal)', async () => {
    await seedSticker(env, { id: 'a', typeId: 't1' });
    await seedSticker(env, { id: 'b', typeId: 't1', status: 'inactive' });
    await markDeleted('stickers', 'b');
    const deleted = await captureAppErrorAsync(() =>
      setStickerStatusBatch(env, { ids: ['a', 'b'], status: 'inactive' }, admin),
    );
    expect(deleted.code).toBe('NOT_FOUND');
    expect((await stickerRow('a'))?.status).toBe('active');
    const unknown = await captureAppErrorAsync(() =>
      setStickerStatusBatch(env, { ids: ['a', 'hilang'], status: 'inactive' }, admin),
    );
    expect(unknown.code).toBe('NOT_FOUND');
  });
});

describe('stickers.remove, removeBatch, restore, restoreBatch', () => {
  test('hapus stiker Aktif = CONFLICT pesan persis; deprecated langsung boleh', async () => {
    await seedSticker(env, { id: 'a', typeId: 't1' });
    await seedSticker(env, { id: 'd', typeId: 't1', status: 'deprecated' });
    const refused = await captureAppErrorAsync(() => removeSticker(env, { id: 'a' }, admin));
    expect(refused.code).toBe('CONFLICT');
    expect(refused.message).toBe(NOT_INACTIVE);
    expect((await stickerRow('a'))?.deleted_at).toBe('');
    const removed = await removeSticker(env, { id: 'd' }, admin);
    expect(removed).toEqual({ id: 'd' });
    expect(await stickerRow('d')).toMatchObject({
      status: 'deprecated',
      deleted_at: '2026-11-20T00:00:00.000Z',
      deleted_by: 'admin@gmail.com',
    });
    expect(await auditCount('sticker.delete')).toBe(1);
  });

  test('batch berisi stiker Aktif atau jenis sistem menolak SELURUH batch', async () => {
    await seedStickerType(env, {
      id: 't-mb',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
    });
    await seedSticker(env, { id: 'ok', typeId: 't1', status: 'inactive' });
    await seedSticker(env, { id: 'on', typeId: 't1' });
    await seedSticker(env, { id: 'mb', typeId: 't-mb', status: 'inactive' });
    const active = await captureAppErrorAsync(() =>
      removeStickerBatch(env, { ids: ['ok', 'on'] }, admin),
    );
    expect(active.code).toBe('CONFLICT');
    const system = await captureAppErrorAsync(() =>
      removeStickerBatch(env, { ids: ['ok', 'mb'] }, admin),
    );
    expect(system.code).toBe('VALIDATION');
    expect(system.message).toBe(SYSTEM_STICKER);
    expect((await stickerRow('ok'))?.deleted_at).toBe('');
    expect(await auditCount('sticker.delete')).toBe(0);
  });

  test('hapus ulang = sukses tanpa audit baru dan deleted_at asli utuh; pulihkan = inactive', async () => {
    await seedSticker(env, { id: 'a', typeId: 't1', status: 'inactive' });
    await removeStickerBatch(env, { ids: ['a'] }, admin);
    const first = await stickerRow('a');
    env.clock.advance(60_000);
    const again = await removeStickerBatch(env, { ids: ['a'] }, admin);
    expect(again.ids).toEqual(['a']);
    expect(await stickerRow('a')).toEqual(first);
    expect(await auditCount('sticker.delete')).toBe(1);
    env.clock.advance(60_000);
    const restored = await restoreSticker(env, { id: 'a' }, admin);
    expect(restored).toMatchObject({ id: 'a', status: 'inactive' });
    expect(restored.deleted).toBeUndefined();
    expect(await stickerRow('a')).toMatchObject({ status: 'inactive', deleted_at: '' });
    expect(await auditCount('sticker.restore')).toBe(1);
    // pulihkan yang sudah hidup = sukses tanpa audit
    await restoreStickerBatch(env, { ids: ['a'] }, admin);
    expect(await auditCount('sticker.restore')).toBe(1);
  });

  test('stiker jenis sistem tidak dipulihkan di sini (mengikuti konfigurasinya)', async () => {
    await seedStickerType(env, {
      id: 't-pl',
      name: 'Postel',
      rule: 'group',
      systemKind: 'postel',
    });
    await seedSticker(env, { id: 'pl', typeId: 't-pl', status: 'inactive' });
    await markDeleted('stickers', 'pl');
    const error = await captureAppErrorAsync(() => restoreSticker(env, { id: 'pl' }, admin));
    expect(error.code).toBe('VALIDATION');
    expect((await stickerRow('pl'))?.deleted_at).not.toBe('');
  });

  test('dua stiker berkunci sama dihapus dengan jam digeser tidak bentrok (indeks _live); pulihkan yang bentrok = CONFLICT', async () => {
    await withoutOldIndex(
      env,
      'stickers',
      'stickers_type_name_unique',
      '`type_id`, `name_key`',
      async () => {
        await seedSticker(env, { id: 'a', typeId: 't1', name: 'Kembar', status: 'inactive' });
        await removeSticker(env, { id: 'a' }, admin);
        env.clock.advance(1000);
        await seedSticker(env, { id: 'b', typeId: 't1', name: 'Kembar', status: 'inactive' });
        await removeSticker(env, { id: 'b' }, admin);
        expect((await stickerRow('a'))?.deleted_at).not.toBe((await stickerRow('b'))?.deleted_at);
        // pulihkan salah satu: sukses; pulihkan yang lain: nama kini dipakai stiker hidup
        await restoreSticker(env, { id: 'a' }, admin);
        const clash = await captureAppErrorAsync(() => restoreSticker(env, { id: 'b' }, admin));
        expect(clash.code).toBe('CONFLICT');
        expect((await stickerRow('b'))?.deleted_at).not.toBe('');
        // dua yang terhapus dipulihkan sekaligus: saling bentrok walau tak ada yang hidup
        await removeSticker(env, { id: 'a' }, admin);
        const both = await captureAppErrorAsync(() =>
          restoreStickerBatch(env, { ids: ['a', 'b'] }, admin),
        );
        expect(both.code).toBe('CONFLICT');
      },
    );
  });

  test('konkurensi: hapus dan aktifkan serentak tidak membuat stiker terhapus sekaligus aktif', async () => {
    await seedSticker(env, { id: 'a', typeId: 't1', status: 'inactive' });
    const settled = await Promise.allSettled([
      removeStickerBatch(env, { ids: ['a'] }, admin),
      setStickerStatusBatch(env, { ids: ['a'], status: 'active' }, admin),
    ]);
    expect(settled.some((entry) => entry.status === 'fulfilled')).toBe(true);
    const row = await stickerRow('a');
    expect(row?.deleted_at !== '' && row?.status === 'active').toBe(false);
  });
});

describe('penyaringan stiker terhapus', () => {
  test('daftar bawaan tanpa stiker terhapus; status=deleted hanya sticker:manage; detail terhapus NOT_FOUND bagi view', async () => {
    await seedSticker(env, { id: 'a', typeId: 't1' });
    await seedSticker(env, { id: 'b', typeId: 't1', status: 'inactive' });
    await removeSticker(env, { id: 'b' }, admin);
    const manager = await ctxOf('kelola-stiker@gmail.com');
    const viewer = await ctxOf('lihat-stiker@gmail.com');
    expect((await listStickers(env, null, viewer)).map((sticker) => sticker.id)).toEqual(['a']);
    expect(
      (await listStickers(env, { status: 'all' }, manager)).map((sticker) => sticker.id),
    ).toEqual(['a']);
    const deleted = await listStickers(env, { status: 'deleted' }, manager);
    expect(deleted.map((sticker) => sticker.id)).toEqual(['b']);
    expect(deleted[0]?.deleted).toEqual({
      deletedAt: '2026-11-20T00:00:00.000Z',
      deletedBy: 'admin@gmail.com',
    });
    const forbidden = await captureAppErrorAsync(() =>
      listStickers(env, { status: 'deleted' }, viewer),
    );
    expect(forbidden.code).toBe('FORBIDDEN');
    const hidden = await captureAppErrorAsync(() => getStickerDto(env, { id: 'b' }, viewer));
    expect(hidden.code).toBe('NOT_FOUND');
    expect((await getStickerDto(env, { id: 'b' }, manager)).deleted).toBeDefined();
    expect((await getStickerDto(env, { id: 'a' }, viewer)).id).toBe('a');
  });

  test('status=inactive memuat stiker bukan Aktif (nonaktif dan digantikan)', async () => {
    await seedSticker(env, { id: 'a', typeId: 't1' });
    await seedSticker(env, { id: 'b', typeId: 't1', status: 'inactive' });
    await seedSticker(env, { id: 'c', typeId: 't1', status: 'deprecated' });
    const inactive = await listStickers(env, { status: 'inactive' }, admin);
    expect(inactive.map((sticker) => sticker.id).sort()).toEqual(['b', 'c']);
    const active = await listStickers(env, { status: 'active' }, admin);
    expect(active.map((sticker) => sticker.id)).toEqual(['a']);
  });

  test('stok: stiker dan jenis terhapus tak tampil di stickerStock.list', async () => {
    await seedLocation(env, { id: 'loc-1', code: 'L1' });
    await seedSticker(env, { id: 'gone', typeId: 't1', status: 'deprecated' });
    await seedSticker(env, { id: 'stay', typeId: 't1' });
    await seedStickerType(env, { id: 't-off', name: 'Lama', rule: 'none', status: 'inactive' });
    await seedSticker(env, { id: 'under-off', typeId: 't-off', status: 'deprecated' });
    await env.DB.prepare(
      "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('gone', 'loc-1', 5, ''), ('under-off', 'loc-1', 5, '')",
    ).run();
    expect((await listStickerStock(env, ['loc-1'])).map((row) => row.stickerId).sort()).toEqual([
      'gone',
      'stay',
      'under-off',
    ]);
    await markDeleted('stickers', 'gone');
    await markDeleted('sticker_types', 't-off');
    expect((await listStickerStock(env, ['loc-1'])).map((row) => row.stickerId)).toEqual(['stay']);
  });

  test('stok: tulis stok pada stiker terhapus = NOT_FOUND', async () => {
    await seedLocation(env, { id: 'loc-1', code: 'L1' });
    await seedSticker(env, { id: 'gone', typeId: 't1', status: 'inactive' });
    await markDeleted('stickers', 'gone');
    const out = await restCall(env, 'admin@gmail.com', 'stickerStock.adjust', {
      stickerId: 'gone',
      locationId: 'loc-1',
      delta: 1,
      reason: 'koreksi',
    });
    expect(out.ok).toBe(false);
    expect((out as { error?: { code?: string } }).error?.code).toBe('NOT_FOUND');
  });

  test('ringkasan surel: stiker atau jenis terhapus tak dihitung', async () => {
    await seedSticker(env, { id: 'habis', typeId: 't1', name: 'Habis' });
    await seedSticker(env, { id: 'habis-hapus', typeId: 't1', name: 'Habis Hapus' });
    await seedStickerType(env, { id: 't-off', name: 'Lama', rule: 'none', status: 'inactive' });
    await seedSticker(env, { id: 'di-jenis', typeId: 't-off', name: 'Di Jenis' });
    expect((await stockDigestRows(env)).out.map((row) => row.name).sort()).toEqual([
      'Di Jenis',
      'Habis',
      'Habis Hapus',
    ]);
    await markDeleted('stickers', 'habis-hapus');
    await markDeleted('sticker_types', 't-off');
    expect((await stockDigestRows(env)).out.map((row) => row.name)).toEqual(['Habis']);
  });

  test('katalog desktop: stiker terhapus tak ikut; penempatan ke jenisnya tak menghasilkan stiker', async () => {
    resetDesktopCatalogCache();
    await seedBrand(env, 'Acme');
    await seedItem(env, { id: 'i1', brand: 'Acme', model: 'AP-1' });
    await env.DB.prepare("UPDATE items SET is_country_lock = 'true' WHERE id = 'i1'").run();
    await seedGuideImage(env, { id: 'g1' });
    await seedSticker(env, { id: 's-live', typeId: 't1', name: 'Hidup' });
    await seedSticker(env, { id: 's-gone', typeId: 't1', name: 'Hapus', status: 'inactive' });
    await env.DB.batch(
      replaceItemInstructionStmts(
        env.DB,
        'i1',
        [
          {
            guideId: 'g1',
            caption: '',
            buId: null,
            marks: [
              { x: 1, y: 1, target: { kind: 'type', typeId: 't1' }, note: '' },
              { x: 2, y: 2, target: { kind: 'sticker', stickerId: 's-gone' }, note: '' },
            ],
          },
        ],
        true,
      ),
    );
    const before = await buildDesktopCatalog(env);
    expect(before.stickers.map((sticker) => sticker.id)).toEqual(['s-live']);
    await markDeleted('stickers', 's-gone');
    resetDesktopCatalogCache();
    const catalog = await buildDesktopCatalog(env);
    expect(catalog.stickers.map((sticker) => sticker.id)).toEqual(['s-live']);
    expect(catalog.items[0]?.stickerIds).toEqual(['s-live']);
    const marks = catalog.items[0]?.stickerPhotos[0]?.marks ?? [];
    expect(marks[1]).toMatchObject({ resolved: [], unresolved: true });
    expect(JSON.stringify(marks)).not.toContain('s-gone');
  });
});

describe('instruksi stiker item dengan stiker/jenis terhapus', () => {
  const photoOf = (marks: ItemStickerPhotoInput['marks']): ItemStickerPhotoInput[] => [
    { guideId: 'g1', caption: '', buId: null, marks },
  ];

  beforeEach(async () => {
    await seedBrand(env, 'Acme');
    await seedItem(env, { id: 'i1', brand: 'Acme', model: 'AP-1' });
    await seedGuideImage(env, { id: 'g1' });
    await seedSticker(env, { id: 's-live', typeId: 't1', name: 'Hidup' });
    await seedSticker(env, { id: 's-gone', typeId: 't1', name: 'Hapus', status: 'inactive' });
  });

  const viewsOf = async () => {
    const stored = await env.DB.prepare(
      'SELECT guide_id, caption, bu_id, `position` FROM item_sticker_photos WHERE item_id = ?',
    )
      .bind('i1')
      .all();
    expect(stored.results.length).toBeGreaterThan(0);
    return buildInstructionViews(
      env,
      'i1',
      ['bu-umum'],
      [
        {
          guideId: 'g1',
          caption: '',
          buId: null,
          position: 0,
          marks: (
            await env.DB.prepare(
              'SELECT x, y, sticker_id, type_id, note FROM item_sticker_marks WHERE item_id = ? ORDER BY `position`',
            )
              .bind('i1')
              .all<{ x: number; y: number; sticker_id: string; type_id: string; note: string }>()
          ).results.map((row) => ({
            x: Number(row.x),
            y: Number(row.y),
            target:
              row.sticker_id !== ''
                ? { kind: 'sticker' as const, stickerId: row.sticker_id }
                : { kind: 'type' as const, typeId: row.type_id },
            note: row.note,
          })),
        },
      ],
    );
  };

  test('penempatan ke stiker terhapus tetap menampilkan namanya + deleted; penanda jenis tak memilih stiker terhapus', async () => {
    await env.DB.batch(
      replaceItemInstructionStmts(
        env.DB,
        'i1',
        photoOf([
          { x: 1, y: 1, target: { kind: 'sticker', stickerId: 's-gone' }, note: '' },
          { x: 2, y: 2, target: { kind: 'type', typeId: 't1' }, note: '' },
        ]),
        true,
      ),
    );
    await markDeleted('stickers', 's-gone');
    const [photo] = await viewsOf();
    const direct = photo?.marks[0];
    expect(direct).toMatchObject({
      targetName: 's-gone' === direct?.targetName ? 's-gone' : 'Hapus',
      unresolved: false,
      targetDeleted: true,
    });
    expect(direct?.resolved[0]).toMatchObject({
      id: 's-gone',
      name: 'Hapus',
      inactive: true,
      deleted: true,
    });
    // penanda jenis: stiker terhapus bukan kandidat; hanya yang hidup
    expect(photo?.marks[1]?.resolved.map((sticker) => sticker.id)).toEqual(['s-live']);
    expect(photo?.marks[1]?.targetDeleted).toBeUndefined();
  });

  test('penanda ke jenis terhapus: nama tampil, tanpa stiker, targetDeleted', async () => {
    await seedStickerType(env, {
      id: 't-gone',
      name: 'Jenis Hapus',
      rule: 'none',
      status: 'inactive',
    });
    await seedSticker(env, { id: 's-in-gone', typeId: 't-gone' });
    await env.DB.batch(
      replaceItemInstructionStmts(
        env.DB,
        'i1',
        photoOf([{ x: 1, y: 1, target: { kind: 'type', typeId: 't-gone' }, note: '' }]),
        true,
      ),
    );
    await markDeleted('sticker_types', 't-gone');
    const [photo] = await viewsOf();
    expect(photo?.marks[0]).toMatchObject({
      targetName: 'Jenis Hapus',
      resolved: [],
      unresolved: true,
      targetDeleted: true,
    });
  });

  test('hasInstructions: penanda ke stiker/jenis terhapus tak dihitung; yang hidup dihitung', async () => {
    await env.DB.batch(
      replaceItemInstructionStmts(
        env.DB,
        'i1',
        photoOf([{ x: 1, y: 1, target: { kind: 'sticker', stickerId: 's-gone' }, note: '' }]),
        true,
      ),
    );
    expect((await hasInstructionsOf(env.DB, ['i1'])).has('i1')).toBe(true);
    await markDeleted('stickers', 's-gone');
    expect((await hasInstructionsOf(env.DB, ['i1'])).has('i1')).toBe(false);
    await env.DB.batch(
      replaceItemInstructionStmts(
        env.DB,
        'i1',
        photoOf([
          { x: 1, y: 1, target: { kind: 'sticker', stickerId: 's-gone' }, note: '' },
          { x: 2, y: 2, target: { kind: 'sticker', stickerId: 's-live' }, note: '' },
        ]),
        false,
      ),
    );
    expect((await hasInstructionsOf(env.DB, ['i1'])).has('i1')).toBe(true);
  });

  test('rujukan tersimpan (T1): penempatan ke stiker terhapus yang tidak berubah lolos; yang baru VALIDATION', async () => {
    await seedStickerType(env, {
      id: 't-gone',
      name: 'Jenis Hapus',
      rule: 'none',
      status: 'inactive',
    });
    await env.DB.batch(
      replaceItemInstructionStmts(
        env.DB,
        'i1',
        photoOf([
          { x: 1, y: 1, target: { kind: 'sticker', stickerId: 's-gone' }, note: '' },
          { x: 2, y: 2, target: { kind: 'type', typeId: 't-gone' }, note: '' },
        ]),
        true,
      ),
    );
    await markDeleted('stickers', 's-gone');
    await markDeleted('sticker_types', 't-gone');
    const input = (stickerPhotos: ItemStickerPhotoInput[], over: Partial<SaveItemInput> = {}) =>
      ({
        brandId: 'brand-acme',
        businessUnitIds: ['bu-umum'],
        model: 'AP-1',
        isCountryLock: false,
        aliases: [],
        stickerPhotos,
        accessories: [],
        attachments: [],
        detail: '',
        ...over,
      }) as SaveItemInput;
    // tidak berubah (item yang sama): lolos
    await assertInstructionRefs(
      env,
      input(
        photoOf([
          { x: 9, y: 9, target: { kind: 'type', typeId: 't-gone' }, note: 'geser' },
          { x: 1, y: 1, target: { kind: 'sticker', stickerId: 's-gone' }, note: '' },
        ]),
        { id: 'i1' },
      ),
    );
    // penempatan BARU ke stiker/jenis terhapus pada item lain: VALIDATION
    await seedItem(env, { id: 'i2', brand: 'Acme', model: 'AP-2' });
    const sticker = await captureAppErrorAsync(() =>
      assertInstructionRefs(
        env,
        input(
          photoOf([{ x: 1, y: 1, target: { kind: 'sticker', stickerId: 's-gone' }, note: '' }]),
          { id: 'i2' },
        ),
      ),
    );
    expect(sticker.code).toBe('VALIDATION');
    const type = await captureAppErrorAsync(() =>
      assertInstructionRefs(
        env,
        input(photoOf([{ x: 1, y: 1, target: { kind: 'type', typeId: 't-gone' }, note: '' }]), {
          id: 'i2',
        }),
      ),
    );
    expect(type.code).toBe('VALIDATION');
  });
});

describe('stickerTypes: status, hapus, pulihkan', () => {
  test('jenis sistem ditolak untuk status dan hapus (batch juga)', async () => {
    await seedStickerType(env, {
      id: 't-mb',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
    });
    const status = await captureAppErrorAsync(() =>
      setStickerTypeStatus(env, { id: 't-mb', status: 'inactive' }, admin),
    );
    expect(status.message).toBe(SYSTEM_TYPE);
    const remove = await captureAppErrorAsync(() => removeStickerType(env, { id: 't-mb' }, admin));
    expect(remove.message).toBe(SYSTEM_TYPE);
    await seedStickerType(env, { id: 't-in', name: 'Biasa', status: 'inactive' });
    const batch = await captureAppErrorAsync(() =>
      removeStickerTypeBatch(env, { ids: ['t-in', 't-mb'] }, admin),
    );
    expect(batch.message).toBe(SYSTEM_TYPE);
    expect((await typeRow('t-in'))?.deleted_at).toBe('');
  });

  test('hapus jenis Aktif = CONFLICT; Nonaktif berstiker terhapus dan stikernya tetap dengan typeDeleted', async () => {
    await seedStickerType(env, { id: 't-x', name: 'Jenis X', rule: 'none' });
    await seedSticker(env, { id: 'sx', typeId: 't-x', name: 'Stiker X' });
    const active = await captureAppErrorAsync(() => removeStickerType(env, { id: 't-x' }, admin));
    expect(active.code).toBe('CONFLICT');
    expect(active.message).toBe(TYPE_NOT_INACTIVE);
    await setStickerTypeStatusBatch(env, { ids: ['t-x'], status: 'inactive' }, admin);
    await removeStickerTypeBatch(env, { ids: ['t-x'] }, admin);
    expect(await typeRow('t-x')).toMatchObject({ deleted_by: 'admin@gmail.com' });
    expect(await auditCount('stickerType.delete')).toBe(1);
    const stickers = await listStickers(env, null, admin);
    expect(stickers.find((sticker) => sticker.id === 'sx')).toMatchObject({
      typeName: 'Jenis X',
      typeDeleted: true,
    });
    expect((await listStickerTypes(env, null, admin)).map((type) => type.id)).not.toContain('t-x');
    const manager = await ctxOf('kelola-stiker@gmail.com');
    const deleted = await listStickerTypes(env, { status: 'deleted' }, manager);
    expect(deleted.map((type) => type.id)).toEqual(['t-x']);
    expect(deleted[0]?.deleted).toBeDefined();
    expect(deleted[0]?.stickerCount).toBe(1);
  });

  test('stickerTypes.get terhapus: NOT_FOUND bagi sticker:view, ada bagi manage; status=deleted FORBIDDEN bagi view', async () => {
    await seedStickerType(env, { id: 't-x', name: 'Jenis X', status: 'inactive' });
    await removeStickerType(env, { id: 't-x' }, admin);
    const viewer = await ctxOf('lihat-stiker@gmail.com');
    const manager = await ctxOf('kelola-stiker@gmail.com');
    const hidden = await captureAppErrorAsync(() => getStickerTypeDto(env, { id: 't-x' }, viewer));
    expect(hidden.code).toBe('NOT_FOUND');
    expect((await getStickerTypeDto(env, { id: 't-x' }, manager)).deleted).toBeDefined();
    const forbidden = await captureAppErrorAsync(() =>
      listStickerTypes(env, { status: 'deleted' }, viewer),
    );
    expect(forbidden.code).toBe('FORBIDDEN');
  });

  test('pulihkan jenis = Nonaktif; nama kini dipakai jenis hidup = CONFLICT; hapus ulang tanpa audit', async () => {
    await withoutOldIndex(
      env,
      'sticker_types',
      'sticker_types_name_unique',
      '`name_key`',
      async () => {
        await seedStickerType(env, { id: 't-a', name: 'Kembar', status: 'inactive' });
        await removeStickerType(env, { id: 't-a' }, admin);
        await removeStickerTypeBatch(env, { ids: ['t-a'] }, admin);
        expect(await auditCount('stickerType.delete')).toBe(1);
        env.clock.advance(1000);
        await seedStickerType(env, { id: 't-b', name: 'Kembar', status: 'inactive' });
        const clash = await captureAppErrorAsync(() =>
          restoreStickerType(env, { id: 't-a' }, admin),
        );
        expect(clash.code).toBe('CONFLICT');
        await removeStickerType(env, { id: 't-b' }, admin);
        const restored = await restoreStickerType(env, { id: 't-a' }, admin);
        expect(restored.status).toBe('inactive');
        expect(await auditCount('stickerType.restore')).toBe(1);
        const both = await captureAppErrorAsync(() =>
          restoreStickerTypeBatch(env, { ids: ['t-a', 't-b'] }, admin),
        );
        expect(both.code).toBe('CONFLICT');
      },
    );
  });

  test('adopsi Postel: jenis bernama "Postel" yang terhapus tidak diadopsi ensurePostelType', async () => {
    await withoutOldIndex(
      env,
      'sticker_types',
      'sticker_types_name_unique',
      '`name_key`',
      async () => {
        await seedStickerType(env, {
          id: 't-pl-old',
          name: 'Postel',
          rule: 'none',
          status: 'inactive',
        });
        await removeStickerType(env, { id: 't-pl-old' }, admin);
        const type = await ensurePostelType(env, admin);
        expect(type.id).not.toBe('t-pl-old');
        expect(type.systemKind).toBe('postel');
        expect(await typeRow('t-pl-old')).toMatchObject({ status: 'inactive' });
        expect((await typeRow('t-pl-old'))?.deleted_at).not.toBe('');
        const kinds = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM sticker_types WHERE system_kind = 'postel'",
        ).first<{ n: number | string }>();
        expect(Number(kinds?.n)).toBe(1);
        // memulihkan yang lama bertabrakan dengan jenis sistem bernama sama: CONFLICT
        const clash = await captureAppErrorAsync(() =>
          restoreStickerType(env, { id: 't-pl-old' }, admin),
        );
        expect(clash.code).toBe('CONFLICT');
      },
    );
  });
});

describe('stiker dan Serial', () => {
  beforeEach(async () => {
    await seedSerialWorld(env);
    await env.DB.prepare(
      "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, ''), ('s2', 'loc-sby', 10, '')",
    ).run();
  });

  test('applicableStickersOf (serials.stickerOptions) tak memuat stiker terhapus', async () => {
    expect((await applicableStickersOf(env, 'i-a1', 'bu-a')).map((s) => s.id)).toEqual([
      's1',
      's2',
    ]);
    await markDeleted('stickers', 's2');
    expect((await applicableStickersOf(env, 'i-a1', 'bu-a')).map((s) => s.id)).toEqual(['s1']);
  });

  test('Cek ulang (T9): recheck dengan stikerIds berisi stiker terhapus ditolak seperti nonaktif', async () => {
    await seedSerial(env, {
      id: 'sn1',
      serial: 'AB12',
      stickers: [
        { stickerId: 's1', qty: 1 },
        { stickerId: 's2', qty: 1 },
      ],
    });
    // `deprecated` normalnya boleh dicentang; terhapus tidak
    await env.DB.prepare(
      "UPDATE stickers SET status = 'deprecated', deleted_at = '2026-11-19T00:00:00.000Z', deleted_by = 'seed' WHERE id = 's1'",
    ).run();
    const rejected = (await restCall(env, SERIAL_USERS.writer, 'serials.act', {
      id: 'sn1',
      expectedUpdatedAt: '2026-11-12T00:00:00.000Z',
      action: 'recheck',
      occurredOn: '2026-11-12',
      message: '',
      stickerIds: ['s1'],
    })) as { ok: boolean; error?: { code?: string; fields?: Record<string, string> } };
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBe('VALIDATION');
    expect(Object.keys(rejected.error?.fields ?? {})).toContain('stickerIds');
    const stock = await env.DB.prepare(
      "SELECT qty FROM sticker_stock WHERE sticker_id = 's1' AND location_id = 'loc-sby'",
    ).first<{ qty: number | string }>();
    expect(Number(stock?.qty)).toBe(10);
    // stiker lain yang hidup tetap dapat dicentang
    const accepted = (await restCall(env, SERIAL_USERS.writer, 'serials.act', {
      id: 'sn1',
      expectedUpdatedAt: '2026-11-12T00:00:00.000Z',
      action: 'recheck',
      occurredOn: '2026-11-12',
      message: '',
      stickerIds: ['s2'],
    })) as { ok: boolean };
    expect(accepted.ok).toBe(true);
  });
});

describe('nama stiker Manual Book historis', () => {
  test('stiker Manual Book terhapus tak lagi memblokir nama konfigurasi lain', async () => {
    await seedStickerType(env, {
      id: 't-mb',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
    });
    await seedSticker(env, {
      id: 'mb-old',
      typeId: 't-mb',
      name: manualBookStickerName('Konfigurasi X', 1),
      status: 'inactive',
    });
    await seedManualBookVersion(env, { stickerId: 'mb-old', designId: 'q-lama', version: 1 });
    const { assertManualBookStickerNameFree } = await import('@server/modules/qrcode/service');
    const blocked = await captureAppErrorAsync(() =>
      assertManualBookStickerNameFree(env, 'q-baru', 'Konfigurasi X'),
    );
    expect(blocked.code).toBe('VALIDATION');
    await markDeleted('stickers', 'mb-old');
    await assertManualBookStickerNameFree(env, 'q-baru', 'Konfigurasi X');
  });
});
