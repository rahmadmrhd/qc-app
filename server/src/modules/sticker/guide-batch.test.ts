import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { seedGuideImage } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { GuideUsageDto, StickerGuidePageDto } from '@shared/contract';
import { listGuides, listGuideUsages, removeGuide, removeGuideBatch } from './guide-service';

// Hapus massal gambar pustaka (redesain fase 4a, Task 2): atomik, dijaga pemakaian item HIDUP, penempatan item terhapus
// dibuang, dan hitungan pemakaian hanya menghitung item hidup.

setDefaultTimeout(90_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const IN_USE = 'Gambar masih dipakai';

async function ctxOf(email: string): Promise<UserContext> {
  const ctx = await loadUserContext(env, email);
  if (!ctx) throw new Error(`konteks ${email} tidak ada`);
  return ctx;
}

/** Gambar pustaka milik `email` (pengunggah) lewat fixture bersama. */
async function seedGuide(id: string, email = 'ie@gmail.com'): Promise<void> {
  await seedGuideImage(env, { id, name: id });
  await env.DB.prepare('UPDATE files SET created_by = ? WHERE id = ?').bind(email, id).run();
}

const place = (itemId: string, guideId: string, position = 0) =>
  env.DB.batch([
    env.DB.prepare(
      "INSERT INTO item_sticker_photos (item_id, guide_id, caption, bu_id, `position`) VALUES (?, ?, '', '', ?)",
    ).bind(itemId, guideId, position),
    env.DB.prepare(
      "INSERT INTO item_sticker_marks (item_id, guide_id, `position`, x, y, sticker_id, type_id, note) VALUES (?, ?, 0, 10, 10, '', 't1', '')",
    ).bind(itemId, guideId),
  ]);

const markItemDeleted = (itemId: string) =>
  env.DB.prepare(
    "UPDATE items SET deleted_at = '2026-11-19T00:00:00.000Z', deleted_by = 'seed' WHERE id = ?",
  )
    .bind(itemId)
    .run();

const countOf = async (sql: string, ...binds: unknown[]): Promise<number> =>
  Number(
    (
      await env.DB.prepare(sql)
        .bind(...binds)
        .first<{ n: number | string }>()
    )?.n,
  );

const guideCount = () => countOf('SELECT COUNT(*) AS n FROM sticker_guide_images');
const photoCount = (guideId: string) =>
  countOf('SELECT COUNT(*) AS n FROM item_sticker_photos WHERE guide_id = ?', guideId);
const markCount = (guideId: string) =>
  countOf('SELECT COUNT(*) AS n FROM item_sticker_marks WHERE guide_id = ?', guideId);
const auditCount = () =>
  countOf("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'stickerGuide.remove'");

const fileStatus = async (id: string): Promise<string | undefined> =>
  (
    await env.DB.prepare('SELECT status FROM files WHERE id = ?')
      .bind(id)
      .first<{ status: string }>()
  )?.status;

let editor: UserContext;
let manager: UserContext;
let other: UserContext;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-20T00:00:00.000Z'));
  rest = restClient(env);
  await seedBusinessUnit(env, { id: 'bu-p', code: 'P' });
  await seedBrand(env, 'Sony');
  await seedRole(env, { id: 'r-item-edit', name: 'Edit Item', permissions: { item: 'edit' } });
  await seedRole(env, {
    id: 'r-item-manage',
    name: 'Kelola Item',
    permissions: { item: 'manage' },
  });
  await seedUser(env, { id: 'u-ie', email: 'ie@gmail.com', roleIds: ['r-item-edit'] });
  await seedUser(env, { id: 'u-ie2', email: 'ie2@gmail.com', roleIds: ['r-item-edit'] });
  await seedUser(env, { id: 'u-im', email: 'im@gmail.com', roleIds: ['r-item-manage'] });
  editor = await ctxOf('ie@gmail.com');
  other = await ctxOf('ie2@gmail.com');
  manager = await ctxOf('im@gmail.com');
  await seedItem(env, { id: 'i-live', brand: 'Sony', model: 'Hidup', businessUnitIds: ['bu-p'] });
  await seedItem(env, { id: 'i-gone', brand: 'Sony', model: 'Hapus', businessUnitIds: ['bu-p'] });
});

describe('stickerGuides.removeBatch', () => {
  test('menghapus banyak gambar milik sendiri dalam satu transaksi; hasil urut masukan; audit per gambar', async () => {
    await seedGuide('g1');
    await seedGuide('g2');
    await seedGuide('g3');
    const result = await removeGuideBatch(env, { ids: ['g3', 'g1', 'g2'] }, editor);
    expect(result).toEqual({ ids: ['g3', 'g1', 'g2'] });
    expect(await guideCount()).toBe(0);
    expect(await auditCount()).toBe(3);
    for (const id of ['g1', 'g2', 'g3']) expect(await fileStatus(id)).not.toBe('active');
  });

  test('satu gambar dipakai item hidup menolak SELURUH batch (CONFLICT generik); tak ada yang berubah', async () => {
    await seedGuide('g1');
    await seedGuide('g2');
    await place('i-live', 'g2');
    const error = await captureAppErrorAsync(() =>
      removeGuideBatch(env, { ids: ['g1', 'g2'] }, editor),
    );
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe(IN_USE);
    expect(error.message).not.toContain('Hidup');
    expect(await guideCount()).toBe(2);
    expect(await auditCount()).toBe(0);
    expect(await fileStatus('g1')).toBe('active');
    expect(await photoCount('g2')).toBe(1);
  });

  test('item nonaktif tetap menahan (hanya item TERHAPUS yang tak dihitung)', async () => {
    await seedGuide('g1');
    await env.DB.prepare("UPDATE items SET status = 'inactive' WHERE id = 'i-live'").run();
    await place('i-live', 'g1');
    const error = await captureAppErrorAsync(() => removeGuideBatch(env, { ids: ['g1'] }, editor));
    expect(error.code).toBe('CONFLICT');
  });

  test('penempatan milik item TERHAPUS tak menahan dan ikut dibuang (foto dan penanda); item hidup tak tersentuh', async () => {
    await seedGuide('g1');
    await seedGuide('g2');
    await place('i-gone', 'g1');
    await place('i-gone', 'g2');
    await place('i-live', 'g2');
    await markItemDeleted('i-gone');
    // g2 juga dipakai item hidup: seluruh batch ditolak dan penempatan item terhapus TIDAK disentuh
    const refused = await captureAppErrorAsync(() =>
      removeGuideBatch(env, { ids: ['g1', 'g2'] }, editor),
    );
    expect(refused.code).toBe('CONFLICT');
    expect(await photoCount('g1')).toBe(1);
    expect(await photoCount('g2')).toBe(2);
    // lepas pemakaian hidup: kedua gambar dapat dihapus
    await env.DB.prepare("DELETE FROM item_sticker_photos WHERE item_id = 'i-live'").run();
    const result = await removeGuideBatch(env, { ids: ['g1', 'g2'] }, editor);
    expect(result.ids).toEqual(['g1', 'g2']);
    expect(await guideCount()).toBe(0);
    expect(await photoCount('g1')).toBe(0);
    expect(await markCount('g1')).toBe(0);
    expect(await photoCount('g2')).toBe(0);
  });

  test('item terhapus lalu dipulihkan SEBELUM hapus: kembali menahan', async () => {
    await seedGuide('g1');
    await place('i-gone', 'g1');
    await markItemDeleted('i-gone');
    await env.DB.prepare(
      "UPDATE items SET deleted_at = '', deleted_by = '' WHERE id = 'i-gone'",
    ).run();
    const error = await captureAppErrorAsync(() => removeGuideBatch(env, { ids: ['g1'] }, editor));
    expect(error.code).toBe('CONFLICT');
  });

  test('gambar milik orang lain: batch ditolak NOT_FOUND seragam (tak membocorkan keberadaan); pemegang manage boleh', async () => {
    await seedGuide('g1', 'ie@gmail.com');
    await seedGuide('g2', 'ie2@gmail.com');
    const foreign = await captureAppErrorAsync(() =>
      removeGuideBatch(env, { ids: ['g1', 'g2'] }, editor),
    );
    expect(foreign.code).toBe('NOT_FOUND');
    const missing = await captureAppErrorAsync(() =>
      removeGuideBatch(env, { ids: ['g1', 'tidak-ada'] }, editor),
    );
    expect(missing.code).toBe('NOT_FOUND');
    expect(foreign.message).toBe(missing.message);
    expect(await guideCount()).toBe(2);
    expect(await auditCount()).toBe(0);
    expect((await removeGuideBatch(env, { ids: ['g1', 'g2'] }, manager)).ids).toEqual(['g1', 'g2']);
    expect(await guideCount()).toBe(0);
  });

  test('hapus ulang gambar yang sudah hilang = NOT_FOUND (hapus permanen, tanpa daftar Terhapus)', async () => {
    await seedGuide('g1');
    await removeGuideBatch(env, { ids: ['g1'] }, editor);
    const error = await captureAppErrorAsync(() => removeGuideBatch(env, { ids: ['g1'] }, editor));
    expect(error.code).toBe('NOT_FOUND');
  });

  test('rute tunggal memakai perencana yang sama: tetap FORBIDDEN untuk milik orang lain, ikut membuang penempatan item terhapus', async () => {
    await seedGuide('g1', 'ie2@gmail.com');
    const forbidden = await captureAppErrorAsync(() => removeGuide(env, { id: 'g1' }, editor));
    expect(forbidden.code).toBe('FORBIDDEN');
    await seedGuide('g2');
    await place('i-gone', 'g2');
    await markItemDeleted('i-gone');
    expect(await removeGuide(env, { id: 'g2' }, editor)).toEqual({ id: 'g2' });
    expect(await photoCount('g2')).toBe(0);
    expect(await markCount('g2')).toBe(0);
    await place('i-live', 'g1');
    const inUse = await captureAppErrorAsync(() => removeGuide(env, { id: 'g1' }, other));
    expect(inUse.code).toBe('CONFLICT');
  });

  test('balapan: hapus dan pulihkan item serentak tidak pernah menyisakan penempatan hidup tanpa gambar', async () => {
    for (let round = 0; round < 3; round++) {
      const guide = `gr${round}`;
      const item = `ir${round}`;
      await seedItem(env, {
        id: item,
        brand: 'Sony',
        model: `Balap ${round}`,
        businessUnitIds: ['bu-p'],
      });
      await seedGuide(guide);
      await place(item, guide);
      await markItemDeleted(item);
      const settled = await Promise.allSettled([
        removeGuideBatch(env, { ids: [guide] }, editor),
        env.DB.prepare("UPDATE items SET deleted_at = '', deleted_by = '' WHERE id = ?")
          .bind(item)
          .run(),
      ]);
      expect(settled[1]?.status).toBe('fulfilled');
      // salah satu menang: gambar terhapus (penempatan ikut hilang) atau ditolak karena item hidup lagi (utuh)
      if (settled[0]?.status === 'fulfilled') {
        expect(
          await countOf('SELECT COUNT(*) AS n FROM sticker_guide_images WHERE id = ?', guide),
        ).toBe(0);
        expect(await photoCount(guide)).toBe(0);
      } else {
        const reason = (settled[0] as PromiseRejectedResult).reason as { code?: string };
        expect(reason.code).toBe('CONFLICT');
        expect(
          await countOf('SELECT COUNT(*) AS n FROM sticker_guide_images WHERE id = ?', guide),
        ).toBe(1);
        expect(await photoCount(guide)).toBe(1);
      }
    }
  });
});

describe('POST /sticker-guides/batch/delete (REST)', () => {
  const post = (body: unknown, email = 'ie@gmail.com') =>
    rest.post('/sticker-guides/batch/delete', { email, body });

  test('200 {ids}; item:view/tanpa sesi ditolak 403/401; batch kosong atau ganda 422', async () => {
    await seedGuide('g1');
    await seedGuide('g2');
    await seedRole(env, { id: 'r-item-view', name: 'Lihat Item', permissions: { item: 'view' } });
    await seedUser(env, { id: 'u-iv', email: 'iv@gmail.com', roleIds: ['r-item-view'] });
    expect((await post({ ids: ['g1'] }, 'iv@gmail.com')).status).toBe(403);
    expect(
      (await rest.post('/sticker-guides/batch/delete', { email: null, body: { ids: ['g1'] } }))
        .status,
    ).toBe(401);
    for (const body of [{ ids: [] }, { ids: ['g1', 'g1'] }, { ids: 'g1' }, {}]) {
      const response = await post(body);
      expect(response.status).toBe(422);
      expect(await jsonOf(response)).toMatchObject({ code: 'VALIDATION' });
    }
    expect(await guideCount()).toBe(2);
    const ok = await post({ ids: ['g2', 'g1'] });
    expect(ok.status).toBe(200);
    expect(await jsonOf(ok)).toEqual({ ids: ['g2', 'g1'] });
    expect(await guideCount()).toBe(0);
  });

  test('gambar dipakai = 409 dan milik orang lain = 404, tanpa menghapus apa pun', async () => {
    await seedGuide('g1');
    await seedGuide('g2', 'ie2@gmail.com');
    await place('i-live', 'g1');
    const inUse = await post({ ids: ['g1'] });
    expect(inUse.status).toBe(409);
    expect(await jsonOf(inUse)).toMatchObject({ code: 'CONFLICT', detail: IN_USE });
    expect((await post({ ids: ['g2'] })).status).toBe(404);
    expect(await guideCount()).toBe(2);
  });
});

describe('hitungan dan daftar pemakaian hanya item hidup', () => {
  test('usageCount, filter unused, dan stickerGuides.usages tidak menghitung item terhapus', async () => {
    await seedGuide('g1');
    await seedGuide('g2');
    await place('i-live', 'g1');
    await place('i-gone', 'g1');
    await place('i-gone', 'g2');
    const usageOf = async () =>
      Object.fromEntries(
        ((await listGuides(env, {}, editor)) as StickerGuidePageDto).items.map((item) => [
          item.id,
          item.usageCount,
        ]),
      );
    expect(await usageOf()).toEqual({ g1: 2, g2: 1 });
    await markItemDeleted('i-gone');
    expect(await usageOf()).toEqual({ g1: 1, g2: 0 });
    const unused = await listGuides(env, { unused: true }, editor);
    expect(unused.items.map((item) => item.id)).toEqual(['g2']);
    const usages: GuideUsageDto[] = await listGuideUsages(env, { id: 'g1' }, manager);
    expect(usages.map((usage) => usage.itemId)).toEqual(['i-live']);
    expect(await listGuideUsages(env, { id: 'g2' }, manager)).toEqual([]);
  });
});
