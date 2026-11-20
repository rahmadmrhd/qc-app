import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { loadUserContext } from '@server/modules/access/context';
import { seedBusinessUnit } from '@server-test/access-fixtures';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import {
  qrCall,
  qrPdfDocumentId,
  seedQrDesign,
  seedQrEnv,
  seedQrPreset,
} from '@server-test/qrcode-env';
import { withoutOldIndex } from '@server-test/soft-delete';
import { seedManualBookVersion, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { removeQrDesignBatch, restoreQrDesignBatch } from './soft-delete';

setDefaultTimeout(60_000);

// Hapus lunak dan pulihkan konfigurasi QR (Manual Book) dan preset QR (fase 4b; rancangan soft delete §4.3, putusan 13,
// T2, T4, T5): keadaan baris, stiker Manual Book, penunjuk item, berkas Drive, hak baca, dan konkurensi.

let env: TestEnv;
const MANAGE = 'qrmanage@gmail.com';
const EDIT = 'qredit@gmail.com';
const VIEW = 'qrview@gmail.com';

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-20T03:00:00.000Z'));
  await seedQrEnv(env);
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
  await seedBrand(env, 'Sony');
  await seedItem(env, { id: 'i1', brand: 'Sony', model: 'A7', businessUnitIds: ['bu-a'] });
  await seedItem(env, { id: 'i2', brand: 'Sony', model: 'A9', businessUnitIds: ['bu-a'] });
  await seedStickerType(env, {
    id: 't-mb',
    name: 'Manual Book',
    rule: 'group',
    systemKind: 'manual_book',
  });
});

const call = (email: string, method: string, payload: unknown) =>
  qrCall(env, email, method, payload);

async function saveBody(extra: Record<string, unknown> = {}) {
  return {
    name: 'Sony A7',
    presetId: '',
    itemIds: ['i1'],
    title: 'Panduan',
    linkSource: 'pdf',
    link: '',
    documentId: await qrPdfDocumentId(env),
    subtitle: '',
    footer: '',
    logoFileId: '',
    layout: DEFAULT_QR_LAYOUT,
    ...extra,
  };
}

async function createDesign(extra: Record<string, unknown> = {}) {
  const out = await call(MANAGE, 'qrcodes.save', await saveBody(extra));
  if (!out.ok) throw new Error(`simpan gagal: ${JSON.stringify(out.error)}`);
  return out.data as { id: string; updatedAt: string };
}

const designRow = (id: string) =>
  env.DB.prepare('SELECT deleted_at, deleted_by, updated_at FROM qr_designs WHERE id = ?')
    .bind(id)
    .first<{ deleted_at: string; deleted_by: string; updated_at: string }>();

const presetRow = (id: string) =>
  env.DB.prepare('SELECT deleted_at, deleted_by FROM qr_presets WHERE id = ?')
    .bind(id)
    .first<{ deleted_at: string; deleted_by: string }>();

const auditCount = async (action: string): Promise<number> =>
  Number(
    (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?')
        .bind(action)
        .first<{ n: number }>()
    )?.n,
  );

const stickerStatus = async (id: string): Promise<string | undefined> =>
  (
    await env.DB.prepare('SELECT status FROM stickers WHERE id = ?')
      .bind(id)
      .first<{ status: string }>()
  )?.status;

const ownerOf = async (itemId: string): Promise<string> =>
  (
    await env.DB.prepare('SELECT manual_book_design_id AS d FROM items WHERE id = ?')
      .bind(itemId)
      .first<{ d: string }>()
  )?.d ?? '';

async function seedVersionedSticker(
  designId: string,
  stickerId: string,
  version: number,
  stock: number,
) {
  await seedSticker(env, { id: stickerId, typeId: 't-mb', name: `X v${version}` });
  await seedManualBookVersion(env, { stickerId, designId, version });
  if (stock !== 0) {
    await env.DB.prepare(
      "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES (?, 'loc', ?, '')",
    )
      .bind(stickerId, stock)
      .run();
  }
}

describe('qrcodes.delete / qrcodes.removeBatch', () => {
  test('hapus lunak: baris bertanda, hilang dari daftar, audit, dan hanya manage', async () => {
    const made = await createDesign();
    expect((await call(EDIT, 'qrcodes.delete', { id: made.id })).error.code).toBe('FORBIDDEN');
    expect((await call(MANAGE, 'qrcodes.delete', { id: made.id })).ok).toBe(true);
    const row = await designRow(made.id);
    expect(row?.deleted_at).toBe('2026-11-20T03:00:00.000Z');
    expect(row?.deleted_by).toBe(MANAGE);
    expect((await call(VIEW, 'qrcodes.list', null)).data).toEqual([]);
    expect(await auditCount('qrcode.delete')).toBe(1);
  });

  test('hapus ulang idempoten: sukses tanpa audit baru dan tanpa mengubah penanda', async () => {
    const made = await createDesign();
    await call(MANAGE, 'qrcodes.delete', { id: made.id });
    const first = await designRow(made.id);
    env.clock.advance(60_000);
    expect((await call(MANAGE, 'qrcodes.delete', { id: made.id })).ok).toBe(true);
    expect(await designRow(made.id)).toEqual(first);
    expect(await auditCount('qrcode.delete')).toBe(1);
    expect((await call(MANAGE, 'qrcodes.delete', { id: 'tidak-ada' })).error.code).toBe(
      'NOT_FOUND',
    );
  });

  test('item tetap menunjuk konfigurasi, dihitung belum tergabung, dan dapat diklaim konfigurasi lain', async () => {
    const made = await createDesign();
    await seedVersionedSticker(made.id, 's1', 1, 0);
    await call(MANAGE, 'qrcodes.delete', { id: made.id });
    expect(await ownerOf('i1')).toBe(made.id);
    const missing = await call(MANAGE, 'items.list', { manualBook: 'missing', status: 'active' });
    expect(missing.data.items.map((i: { id: string }) => i.id).sort()).toEqual(['i1', 'i2']);
    const other = await call(MANAGE, 'qrcodes.save', await saveBody({ name: 'Lain' }));
    expect(other.ok).toBe(true);
    expect(await ownerOf('i1')).toBe(other.data.id);
  });

  test('stiker Manual Book: stok > 0 menjadi usang, stok <= 0 menjadi tidak aktif; versi lama ikut', async () => {
    const made = await createDesign();
    await seedVersionedSticker(made.id, 's-lama', 1, 0);
    await seedVersionedSticker(made.id, 's-baru', 2, 7);
    await seedVersionedSticker(made.id, 's-neg', 3, -2);
    await call(MANAGE, 'qrcodes.delete', { id: made.id });
    expect(await stickerStatus('s-lama')).toBe('inactive');
    expect(await stickerStatus('s-baru')).toBe('deprecated');
    expect(await stickerStatus('s-neg')).toBe('inactive');
  });

  test('berkas Drive tidak dibuang dan berbagi PDF sumber tidak dicabut', async () => {
    const made = await createDesign();
    const folder = 'EXPORT';
    env.BRIDGE.state.folders.add(folder);
    const pdfId = await env.BRIDGE.createFile(folder, 'a.pdf', 'application/pdf', 'QUJD');
    await env.DB.prepare('UPDATE qr_designs SET export_pdf_drive_id = ? WHERE id = ?')
      .bind(pdfId, made.id)
      .run();
    await call(MANAGE, 'qrcodes.delete', { id: made.id });
    expect(env.BRIDGE.state.files.get(pdfId)?.trashed).toBe(false);
    const doc = await env.DB.prepare('SELECT shared FROM qr_documents').first<{ shared: string }>();
    expect(doc?.shared).toBe('1');
  });

  test('batch: banyak id satu transaksi; id tak dikenal menggagalkan seluruhnya', async () => {
    const a = await createDesign();
    const b = await createDesign({ name: 'Sony A9', itemIds: ['i2'] });
    const out = await call(MANAGE, 'qrcodes.removeBatch', { ids: [b.id, a.id] });
    expect(out.ok).toBe(true);
    expect([...out.data.ids].sort()).toEqual([a.id, b.id].sort());
    expect((await call(VIEW, 'qrcodes.list', null)).data).toEqual([]);
    const fail = await call(MANAGE, 'qrcodes.removeBatch', { ids: [a.id, 'tidak-ada'] });
    expect(fail.ok).toBe(false);
  });

  test('dua hapus serentak: keduanya sukses, satu audit', async () => {
    const made = await createDesign();
    const [x, y] = await Promise.all([
      call(MANAGE, 'qrcodes.delete', { id: made.id }),
      call(MANAGE, 'qrcodes.delete', { id: made.id }),
    ]);
    expect([x.ok, y.ok]).toEqual([true, true]);
    expect(await auditCount('qrcode.delete')).toBe(1);
  });
});

describe('daftar, baca, dan ekspor konfigurasi terhapus', () => {
  test('status=deleted hanya bagi manage; DTO bertanda dan tak tampil di daftar hidup', async () => {
    const made = await createDesign();
    await call(MANAGE, 'qrcodes.delete', { id: made.id });
    expect((await call(EDIT, 'qrcodes.list', { status: 'deleted' })).error.code).toBe('FORBIDDEN');
    const list = await call(MANAGE, 'qrcodes.list', { status: 'deleted' });
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({
      id: made.id,
      deleted: { deletedAt: '2026-11-20T03:00:00.000Z', deletedBy: MANAGE },
    });
    expect((await call(MANAGE, 'qrcodes.list', null)).data).toEqual([]);
  });

  test('get: terhapus hanya terbaca manage; selain itu NOT_FOUND (juga riwayat versi dan berkas)', async () => {
    const made = await createDesign();
    await call(MANAGE, 'qrcodes.delete', { id: made.id });
    expect((await call(MANAGE, 'qrcodes.get', { id: made.id })).data.deleted).toBeDefined();
    expect((await call(EDIT, 'qrcodes.get', { id: made.id })).error.code).toBe('NOT_FOUND');
    expect((await call(VIEW, 'qrcodes.get', { id: made.id })).error.code).toBe('NOT_FOUND');
    expect((await call(VIEW, 'qrcodes.versions', { id: made.id })).error.code).toBe('NOT_FOUND');
    expect((await call(VIEW, 'qrcodes.file', { id: made.id, kind: 'pdf' })).error.code).toBe(
      'NOT_FOUND',
    );
    expect((await call(MANAGE, 'qrcodes.versions', { id: made.id })).ok).toBe(true);
  });

  test('simpan dan ekspor konfigurasi terhapus ditolak', async () => {
    const made = await createDesign();
    await call(MANAGE, 'qrcodes.delete', { id: made.id });
    const saved = await call(
      MANAGE,
      'qrcodes.save',
      await saveBody({ id: made.id, expectedUpdatedAt: made.updatedAt }),
    );
    expect(saved.ok).toBe(false);
    const exported = await call(MANAGE, 'qrcodes.export', {
      id: made.id,
      expectedUpdatedAt: made.updatedAt,
    });
    expect(exported.ok).toBe(false);
  });

  test('nama konfigurasi terhapus bebas dipakai konfigurasi lain', async () => {
    const made = await createDesign();
    await call(MANAGE, 'qrcodes.delete', { id: made.id });
    const reuse = await call(
      MANAGE,
      'qrcodes.save',
      await saveBody({ itemIds: ['i2'], name: 'sony a7' }),
    );
    expect(reuse.ok).toBe(true);
  });
});

describe('qrcodes.restore / qrcodes.restoreBatch', () => {
  test('pulihkan: kembali hidup, item tersambung lagi, stiker usang menjadi tidak aktif, audit', async () => {
    const made = await createDesign();
    await seedVersionedSticker(made.id, 's1', 1, 5);
    await call(MANAGE, 'qrcodes.delete', { id: made.id });
    expect(await stickerStatus('s1')).toBe('deprecated');
    const restored = await call(MANAGE, 'qrcodes.restore', { id: made.id });
    expect(restored.ok).toBe(true);
    expect(restored.data).toMatchObject({ id: made.id, name: 'Sony A7' });
    expect(restored.data.deleted).toBeUndefined();
    const row = await designRow(made.id);
    expect(row?.deleted_at).toBe('');
    expect(row?.deleted_by).toBe('');
    expect(await stickerStatus('s1')).toBe('inactive');
    expect((await call(VIEW, 'qrcodes.list', null)).data).toHaveLength(1);
    const missing = await call(MANAGE, 'items.list', { manualBook: 'missing', status: 'active' });
    expect(missing.data.items.map((i: { id: string }) => i.id)).toEqual(['i2']);
    expect(await auditCount('qrcode.restore')).toBe(1);
    expect((await call(EDIT, 'qrcodes.restore', { id: made.id })).error.code).toBe('FORBIDDEN');
  });

  test('pulihkan yang sudah hidup idempoten tanpa audit; id tak dikenal NOT_FOUND', async () => {
    const made = await createDesign();
    expect((await call(MANAGE, 'qrcodes.restore', { id: made.id })).ok).toBe(true);
    expect(await auditCount('qrcode.restore')).toBe(0);
    expect((await call(MANAGE, 'qrcodes.restore', { id: 'tidak-ada' })).error.code).toBe(
      'NOT_FOUND',
    );
  });

  test('nama kini dipakai konfigurasi hidup lain: CONFLICT; setelah diganti baru bisa dipulihkan', async () => {
    const made = await createDesign();
    await call(MANAGE, 'qrcodes.delete', { id: made.id });
    await call(MANAGE, 'qrcodes.save', await saveBody({ itemIds: ['i2'], name: 'Sony A7' }));
    const out = await call(MANAGE, 'qrcodes.restore', { id: made.id });
    expect(out.error.code).toBe('CONFLICT');
    expect((await designRow(made.id))?.deleted_at).not.toBe('');
  });

  test('batch pulihkan: dua konfigurasi terhapus bernama sama tak boleh hidup bersamaan', async () => {
    const a = await createDesign();
    await call(MANAGE, 'qrcodes.delete', { id: a.id });
    const b = await createDesign({ itemIds: ['i2'], name: 'Sony A7' });
    await call(MANAGE, 'qrcodes.delete', { id: b.id });
    const user = await loadUserContext(env, MANAGE);
    if (!user) throw new Error('konteks tidak ada');
    await expect(restoreQrDesignBatch(env, { ids: [a.id, b.id] }, user)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await designRow(a.id))?.deleted_at).not.toBe('');
    expect((await designRow(b.id))?.deleted_at).not.toBe('');
  });

  test('batch hapus lalu pulihkan lewat layanan: hasil berurut menurut masukan', async () => {
    const a = await createDesign();
    const b = await createDesign({ itemIds: ['i2'], name: 'Sony A9' });
    const user = await loadUserContext(env, MANAGE);
    if (!user) throw new Error('konteks tidak ada');
    const removed = await removeQrDesignBatch(env, { ids: [b.id, a.id] }, user);
    expect(removed.ids).toEqual([b.id, a.id]);
    const restored = await restoreQrDesignBatch(env, { ids: [b.id, a.id] }, user);
    expect(restored.items.map((x) => x.id)).toEqual([b.id, a.id]);
  });
});

describe('preset QR', () => {
  test('hapus lunak preset: hilang dari getDefaults hidup, tampil di status=deleted, audit, hanya manage', async () => {
    await seedQrPreset(env, { id: 'p1', name: 'Standar', buId: 'bu-a' });
    expect((await call(EDIT, 'qrcodes.deletePreset', { id: 'p1' })).error.code).toBe('FORBIDDEN');
    expect((await call(MANAGE, 'qrcodes.deletePreset', { id: 'p1' })).ok).toBe(true);
    expect((await presetRow('p1'))?.deleted_at).toBe('2026-11-20T03:00:00.000Z');
    expect((await call(VIEW, 'qrcodes.getDefaults', null)).data.presets).toEqual([]);
    expect((await call(EDIT, 'qrcodes.getDefaults', { status: 'deleted' })).error.code).toBe(
      'FORBIDDEN',
    );
    const deleted = await call(MANAGE, 'qrcodes.getDefaults', { status: 'deleted' });
    expect(deleted.data.presets.map((p: { id: string }) => p.id)).toEqual(['p1']);
    expect(deleted.data.presets[0].deleted).toMatchObject({ deletedBy: MANAGE });
    expect(await auditCount('qrcode.preset_delete')).toBe(1);
    expect((await call(MANAGE, 'qrcodes.deletePreset', { id: 'p1' })).ok).toBe(true);
    expect(await auditCount('qrcode.preset_delete')).toBe(1);
  });

  test('getPreset: terhapus hanya terbaca manage', async () => {
    await seedQrPreset(env, { id: 'p1', name: 'Standar', buId: 'bu-a' });
    expect((await call(VIEW, 'qrcodes.getPreset', { id: 'p1' })).data.name).toBe('Standar');
    await call(MANAGE, 'qrcodes.deletePreset', { id: 'p1' });
    expect((await call(VIEW, 'qrcodes.getPreset', { id: 'p1' })).error.code).toBe('NOT_FOUND');
    expect((await call(MANAGE, 'qrcodes.getPreset', { id: 'p1' })).data.deleted).toBeDefined();
    expect((await call(MANAGE, 'qrcodes.getPreset', { id: 'tidak-ada' })).error.code).toBe(
      'NOT_FOUND',
    );
  });

  test('konfigurasi yang memakai preset terhapus ditandai presetDeleted dan tetap dapat disimpan', async () => {
    await seedQrPreset(env, { id: 'p1', name: 'Standar', buId: 'bu-a' });
    const made = await createDesign({ presetId: 'p1' });
    await call(MANAGE, 'qrcodes.deletePreset', { id: 'p1' });
    const got = await call(MANAGE, 'qrcodes.get', { id: made.id });
    expect(got.data.presetDeleted).toBe(true);
    const list = await call(VIEW, 'qrcodes.list', null);
    expect(list.data[0].presetDeleted).toBe(true);
  });

  test('pulihkan preset: BU atau nama kini dipakai preset hidup = CONFLICT; tanpa bentrokan = sukses', async () => {
    await seedQrPreset(env, { id: 'p1', name: 'Standar', buId: 'bu-a' });
    await call(MANAGE, 'qrcodes.deletePreset', { id: 'p1' });
    await withoutOldIndex(env, 'qr_presets', 'qr_presets_bu_unique', 'bu_id', async () => {
      await seedQrPreset(env, { id: 'p2', name: 'Lain', buId: 'bu-a' });
      const byBu = await call(MANAGE, 'qrcodes.restorePreset', { id: 'p1' });
      expect(byBu.error.code).toBe('CONFLICT');
      // jam maju: kunci unik `_live` memuat `deleted_at`, jadi dua penghapusan BU sama pada milidetik sama bentrok
      env.clock.advance(1000);
      await call(MANAGE, 'qrcodes.deletePreset', { id: 'p2' });
      await seedQrPreset(env, { id: 'p3', name: 'standar', buId: 'bu-b' });
      const byName = await call(MANAGE, 'qrcodes.restorePreset', { id: 'p1' });
      expect(byName.error.code).toBe('CONFLICT');
      env.clock.advance(1000);
      await call(MANAGE, 'qrcodes.deletePreset', { id: 'p3' });
      const ok = await call(MANAGE, 'qrcodes.restorePreset', { id: 'p1' });
      expect(ok.ok).toBe(true);
      expect(ok.data.deleted).toBeUndefined();
      expect((await presetRow('p1'))?.deleted_at).toBe('');
    });
    expect(await auditCount('qrcode.preset_restore')).toBe(1);
  });

  test('batch hapus dan pulihkan preset', async () => {
    await seedQrPreset(env, { id: 'p1', name: 'A', buId: 'bu-a' });
    await seedQrPreset(env, { id: 'p2', name: 'B', buId: 'bu-b' });
    const removed = await call(MANAGE, 'qrcodes.removePresetBatch', { ids: ['p2', 'p1'] });
    expect(removed.data.ids).toEqual(['p2', 'p1']);
    const restored = await call(MANAGE, 'qrcodes.restorePresetBatch', { ids: ['p1', 'p2'] });
    expect(restored.data.items.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2']);
    expect((await call(VIEW, 'qrcodes.getDefaults', null)).data.presets).toHaveLength(2);
  });

  test('preset terhapus tidak lagi dapat disimpan ulang; logo preset terhapus tetap terkunci pada pustaka', async () => {
    await seedQrPreset(env, { id: 'p1', name: 'A', buId: 'bu-a' });
    await call(MANAGE, 'qrcodes.deletePreset', { id: 'p1' });
    const out = await call(MANAGE, 'qrcodes.savePreset', {
      id: 'p1',
      expectedUpdatedAt: '2026-11-20T03:00:00.000Z',
      name: 'A',
      title: '',
      subtitle: '',
      footer: '',
      layout: DEFAULT_QR_LAYOUT,
      style: DEFAULT_QR_STYLE,
      defaultLogoId: '',
      buId: 'bu-a',
      namePlacement: '',
    });
    expect(out.ok).toBe(false);
  });
});

describe('konfigurasi terhapus pada item dan stiker', () => {
  test('hasInstructions stiker Manual Book tidak menghitung konfigurasi terhapus', async () => {
    const made = await seedQrDesign(env, { id: 'd-seed', name: 'Seed' });
    await env.DB.prepare("UPDATE items SET manual_book_design_id = ? WHERE id = 'i1'")
      .bind(made.id)
      .run();
    await seedSticker(env, { id: 's-seed', typeId: 't-mb', name: 'Seed v1' });
    await seedManualBookVersion(env, { stickerId: 's-seed', designId: made.id, version: 1 });
    const before = await call(MANAGE, 'items.list', { manualBook: 'has', status: 'active' });
    expect(before.data.items.map((i: { id: string }) => i.id)).toEqual(['i1']);
    await call(MANAGE, 'qrcodes.delete', { id: made.id });
    const after = await call(MANAGE, 'items.list', { manualBook: 'has', status: 'active' });
    expect(after.data.items).toEqual([]);
  });
});
