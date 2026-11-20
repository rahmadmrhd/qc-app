import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import {
  qrCall,
  qrPdfDocumentId,
  seedQrDesign,
  seedQrEnv,
  seedQrPreset,
} from '@server-test/qrcode-env';
import { seedManualBookVersion, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { DEFAULT_QR_LAYOUT, qrContentHash } from '@shared/qrcode';
import { claimItemsStmts } from './items';

setDefaultTimeout(60_000);

// Pemilihan item pada konfigurasi QR (Manual Book, spek 4a): penghubung `items.manual_book_design_id`, nama, preset,
// penyaringan BU, dan penjagaan kepemilikan serentak.

let env: TestEnv;
const FULL = 'qfull@gmail.com'; // qrcode edit + item view (semua BU)
const LIMITED = 'qlim@gmail.com'; // qrcode edit + item view hanya bu-a

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-10T03:00:00.000Z'));
  await seedQrEnv(env);
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
  await seedRole(env, {
    id: 'r-qi',
    name: 'QR + item',
    permissions: { qrcode: 'edit', item: 'view' },
  });
  await seedUser(env, { id: 'u-full', email: FULL, roleIds: ['r-qi'] });
  await seedUser(env, {
    id: 'u-lim',
    email: LIMITED,
    assignments: [{ locationId: null, roleIds: ['r-qi'] }],
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-qi'] }],
  });
  await seedBrand(env, 'Sony');
  await seedItem(env, { id: 'i1', brand: 'Sony', model: 'A7', businessUnitIds: ['bu-a'] });
  await seedItem(env, { id: 'i2', brand: 'Sony', model: 'A9', businessUnitIds: ['bu-a'] });
  await seedItem(env, { id: 'i3', brand: 'Sony', model: 'ZV1', businessUnitIds: ['bu-b'] });
  await seedItem(env, {
    id: 'i4',
    brand: 'Sony',
    model: 'Lama',
    businessUnitIds: ['bu-a'],
    status: 'inactive',
  });
});

const call = (email: string, method: string, payload: unknown) =>
  qrCall(env, email, method, payload);

async function body(extra: Record<string, unknown> = {}) {
  return {
    name: 'Sony A7/A9',
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

const save = async (extra: Record<string, unknown> = {}, email = FULL) =>
  call(email, 'qrcodes.save', await body(extra));

async function ownerOf(itemId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT manual_book_design_id AS d FROM items WHERE id = ?')
    .bind(itemId)
    .first<{ d: string }>();
  return (row?.d ?? '').trim();
}

describe('simpan konfigurasi dengan item', () => {
  test('konfigurasi baru wajib punya item dan nama', async () => {
    const noItems = await save({ itemIds: [] });
    expect(noItems.error.code).toBe('VALIDATION');
    expect(noItems.error.fields.itemIds).toBeDefined();
    const noName = await save({ name: '  ' });
    expect(noName.error.code).toBe('VALIDATION');
    expect(noName.error.fields.name).toBeDefined();
    expect((await call('qrview@gmail.com', 'qrcodes.list', null)).data).toEqual([]);
  });

  test('dengan item: kolom penunjuk item terisi dan DTO memuat item serta nama', async () => {
    const made = await save({ itemIds: ['i1', 'i2'] });
    expect(made.ok).toBe(true);
    expect(await ownerOf('i1')).toBe(made.data.id);
    expect(await ownerOf('i2')).toBe(made.data.id);
    expect(await ownerOf('i3')).toBe('');
    expect(made.data.name).toBe('Sony A7/A9');
    expect(made.data.items.map((i: { model: string }) => i.model)).toEqual(['A7', 'A9']);
    expect(made.data.items[0]).toMatchObject({ id: 'i1', brand: 'Sony' });
    expect(made.data.hiddenItemCount).toBe(0);
    expect(made.data).toMatchObject({ stickerVersion: 0, stickerStatus: '' });
    const listed = (await call(FULL, 'qrcodes.list', null)).data;
    expect(listed[0].items).toHaveLength(2);
    // penunjuk tidak menyentuh updated_at item
    const item = await env.DB.prepare('SELECT updated_at FROM items WHERE id = ?')
      .bind('i1')
      .first<{ updated_at: string }>();
    expect(item?.updated_at).toBe('2026-01-01T00:00:00.000Z');
  });

  test('item tak dikenal, di luar BU penyimpan, atau nonaktif ditolak pada field itemIds', async () => {
    for (const ids of [['tidak-ada'], ['i3'], ['i4']]) {
      const out = await save({ itemIds: ids }, LIMITED);
      expect(out.error.code).toBe('VALIDATION');
      expect(out.error.fields.itemIds).toBeDefined();
    }
    expect((await save({ itemIds: ['i4'] })).error.code).toBe('VALIDATION');
  });

  test('item milik konfigurasi lain ditolak dengan pesan yang menyebut nama Manual Book itu', async () => {
    const first = await save({ itemIds: ['i1'], name: 'PBE Pertama' });
    expect(first.ok).toBe(true);
    const out = await save({ itemIds: ['i1', 'i2'], name: 'PBE Kedua' });
    expect(out.error.code).toBe('CONFLICT');
    expect(out.error.message).toContain('PBE Pertama');
    expect(await ownerOf('i1')).toBe(first.data.id);
    expect(await ownerOf('i2')).toBe('');
    expect((await call(FULL, 'qrcodes.list', null)).data).toHaveLength(1);
  });

  test('dua simpanan serentak dengan item yang sama: tepat satu berhasil, item punya satu pemilik', async () => {
    const [a, b] = await Promise.all([
      save({ itemIds: ['i1', 'i2'], name: 'A' }),
      save({ itemIds: ['i2', 'i3'], name: 'B' }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const loser = a.ok ? b : a;
    expect(loser.error.code).toBe('CONFLICT');
    const winner = a.ok ? a : b;
    expect(await ownerOf('i2')).toBe(winner.data.id);
    const designs = (await call(FULL, 'qrcodes.list', null)).data;
    expect(designs).toHaveLength(1);
    // item kalah tidak terpasang ke siapa pun
    const claimed = [await ownerOf('i1'), await ownerOf('i2'), await ownerOf('i3')].filter(Boolean);
    expect(new Set(claimed)).toEqual(new Set([winner.data.id]));
  });

  test('penempatan nama disalin dari preset saat dibuat dan memaksa bagian label sama dengan nama', async () => {
    await seedQrPreset(env, {
      id: 'p1',
      name: 'Preset A',
      buId: 'bu-a',
      namePlacement: 'subtitle',
    });
    const made = await save({ presetId: 'p1', subtitle: 'akan ditimpa' });
    expect(made.ok).toBe(true);
    expect(made.data).toMatchObject({
      presetId: 'p1',
      namePlacement: 'subtitle',
      subtitle: 'Sony A7/A9',
    });
    // menyimpan ulang dengan nama baru tetap memaksa bagian terkunci; penempatan tak berubah
    const again = await call(
      FULL,
      'qrcodes.save',
      await body({
        id: made.data.id,
        expectedUpdatedAt: made.data.updatedAt,
        presetId: 'p1',
        name: 'Nama Baru',
        subtitle: 'lain',
        documentId: made.data.documentId,
      }),
    );
    expect(again.ok).toBe(true);
    expect(again.data).toMatchObject({ namePlacement: 'subtitle', subtitle: 'Nama Baru' });
    expect((await save({ presetId: 'tidak-ada' })).error.fields.presetId).toBeDefined();
  });

  test('mengubah daftar item saja menaikkan updatedAt tetapi exportStatus tetap current', async () => {
    env.clock.set(Date.parse('2026-11-10T03:00:00.000Z'));
    const doc = await qrPdfDocumentId(env);
    const documentLink = (
      await env.DB.prepare('SELECT drive_id FROM qr_documents WHERE id = ?')
        .bind(doc)
        .first<{ drive_id: string }>()
    )?.drive_id;
    expect(documentLink).toBeTruthy();
    const made = await call(FULL, 'qrcodes.save', await body({ documentId: doc }));
    expect(made.ok).toBe(true);
    // tandai sudah diekspor dengan hash isi saat ini
    const hash = qrContentHash({
      linkSource: 'pdf',
      link: made.data.link,
      title: made.data.title,
      subtitle: made.data.subtitle,
      footer: made.data.footer,
      logoFileId: made.data.logoFileId,
      layout: made.data.layout,
      style: made.data.style,
    });
    await env.DB.prepare(
      "UPDATE qr_designs SET exported_hash = ?, exported_at = ?, exported_by = 'x', export_pdf_drive_id = 'd1', export_png_drive_id = 'd2' WHERE id = ?",
    )
      .bind(hash, '2026-11-10T03:00:00.000Z', made.data.id)
      .run();
    const before = (await call(FULL, 'qrcodes.get', { id: made.data.id })).data;
    expect(before.exportStatus).toBe('current');
    env.clock.advance(60_000);
    const changed = await call(
      FULL,
      'qrcodes.save',
      await body({
        id: made.data.id,
        expectedUpdatedAt: before.updatedAt,
        documentId: doc,
        itemIds: ['i1', 'i2'],
      }),
    );
    expect(changed.ok).toBe(true);
    expect(changed.data.updatedAt).not.toBe(before.updatedAt);
    expect(changed.data.exportStatus).toBe('current');
    expect(changed.data.items).toHaveLength(2);
    expect(await ownerOf('i2')).toBe(made.data.id);
  });

  test('melepas item dari daftar mengosongkan penunjuknya; konfigurasi berstiker tak boleh kehilangan semua item', async () => {
    const made = await save({ itemIds: ['i1', 'i2'] });
    env.clock.advance(1000);
    const less = await call(
      FULL,
      'qrcodes.save',
      await body({
        id: made.data.id,
        expectedUpdatedAt: made.data.updatedAt,
        documentId: made.data.documentId,
        itemIds: ['i2'],
      }),
    );
    expect(less.ok).toBe(true);
    expect(await ownerOf('i1')).toBe('');
    expect(await ownerOf('i2')).toBe(made.data.id);
    // sekarang berstiker: tanpa item ditolak
    await seedStickerType(env, {
      id: 't-mb',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
    });
    await seedSticker(env, { id: 's-mb', typeId: 't-mb', name: 'Sony v1' });
    await seedManualBookVersion(env, { stickerId: 's-mb', designId: made.data.id, version: 1 });
    env.clock.advance(1000);
    const none = await call(
      FULL,
      'qrcodes.save',
      await body({
        id: made.data.id,
        expectedUpdatedAt: less.data.updatedAt,
        documentId: made.data.documentId,
        itemIds: [],
      }),
    );
    expect(none.error.code).toBe('VALIDATION');
    expect(none.error.fields.itemIds).toBeDefined();
    expect(await ownerOf('i2')).toBe(made.data.id);
  });
});

describe('penyaringan BU pada konfigurasi', () => {
  async function mixedDesign() {
    const doc = await qrPdfDocumentId(env);
    await seedQrDesign(env, {
      id: 'dz',
      title: 'Campur',
      name: 'Campur',
      linkSource: 'pdf',
      documentId: doc,
      link: '',
    });
    await env.DB.prepare(
      "UPDATE items SET manual_book_design_id = 'dz' WHERE id IN ('i1', 'i3')",
    ).run();
    return { id: 'dz', doc };
  }

  test('pembaca BU terbatas hanya melihat item miliknya dan jumlah item tersembunyi benar', async () => {
    await mixedDesign();
    const full = (await call(FULL, 'qrcodes.get', { id: 'dz' })).data;
    expect(full.items.map((i: { id: string }) => i.id)).toEqual(['i1', 'i3']);
    expect(full.hiddenItemCount).toBe(0);
    const limited = (await call(LIMITED, 'qrcodes.get', { id: 'dz' })).data;
    expect(limited.items.map((i: { id: string }) => i.id)).toEqual(['i1']);
    expect(limited.hiddenItemCount).toBe(1);
    const listed = (await call(LIMITED, 'qrcodes.list', null)).data;
    expect(listed[0]).toMatchObject({ hiddenItemCount: 1 });
    expect(listed[0].items).toHaveLength(1);
    // pembaca tanpa penugasan BU tidak melihat satu pun
    const none = (await call('qrview@gmail.com', 'qrcodes.get', { id: 'dz' })).data;
    expect(none.items).toEqual([]);
    expect(none.hiddenItemCount).toBe(2);
  });

  test('menyimpan oleh pengguna terbatas tidak melepas item tak terlihat', async () => {
    const { id, doc } = await mixedDesign();
    const current = (await call(LIMITED, 'qrcodes.get', { id })).data;
    const out = await call(
      LIMITED,
      'qrcodes.save',
      await body({
        id,
        expectedUpdatedAt: current.updatedAt,
        name: 'Campur',
        documentId: doc,
        itemIds: ['i2'], // mengganti i1 -> i2 di antara item yang terlihat
      }),
    );
    expect(out.ok).toBe(true);
    expect(await ownerOf('i1')).toBe('');
    expect(await ownerOf('i2')).toBe(id);
    expect(await ownerOf('i3')).toBe(id); // tak terlihat, tetap terpasang
    expect(out.data.hiddenItemCount).toBe(1);
    expect(out.data.items.map((i: { id: string }) => i.id)).toEqual(['i2']);
  });
});

describe('qrcodes.itemOptions', () => {
  test('hanya item aktif yang terlihat bagi pengguna, memuat BU dan nama Manual Book; berkursor', async () => {
    await seedBrand(env, 'Apple');
    await seedItem(env, {
      id: 'i5',
      brand: 'Apple',
      model: 'Pro',
      businessUnitIds: ['bu-a', 'bu-b'],
    });
    await seedQrDesign(env, { id: 'dz', title: 'T', name: 'Paket Sony' });
    await env.DB.prepare("UPDATE items SET manual_book_design_id = 'dz' WHERE id = 'i1'").run();
    const all = await call(FULL, 'qrcodes.itemOptions', {});
    expect(all.ok).toBe(true);
    expect(all.data.items.map((i: { id: string }) => i.id).sort()).toEqual([
      'i1',
      'i2',
      'i3',
      'i5',
    ]);
    const one = all.data.items.find((i: { id: string }) => i.id === 'i1');
    expect(one).toMatchObject({
      brand: 'Sony',
      model: 'A7',
      businessUnitIds: ['bu-a'],
      manualBookName: 'Paket Sony',
    });
    const multi = all.data.items.find((i: { id: string }) => i.id === 'i5');
    expect(multi.businessUnitIds.sort()).toEqual(['bu-a', 'bu-b']);
    const limited = await call(LIMITED, 'qrcodes.itemOptions', {});
    expect(limited.data.items.map((i: { id: string }) => i.id).sort()).toEqual(['i1', 'i2', 'i5']);
    // kursor
    const page1 = await call(FULL, 'qrcodes.itemOptions', { limit: 2 });
    expect(page1.data.items).toHaveLength(2);
    expect(page1.data.nextCursor).not.toBeNull();
    const page2 = await call(FULL, 'qrcodes.itemOptions', {
      limit: 2,
      cursor: page1.data.nextCursor,
    });
    expect(page2.data.items).toHaveLength(2);
    expect(page2.data.nextCursor).toBeNull();
    const seen = [...page1.data.items, ...page2.data.items].map((i: { id: string }) => i.id);
    expect(new Set(seen).size).toBe(4);
    // pencarian
    const found = await call(FULL, 'qrcodes.itemOptions', { query: 'zv1' });
    expect(found.data.items.map((i: { id: string }) => i.id)).toEqual(['i3']);
  });

  test('izin: qrcode edit; view saja dan tanpa modul ditolak 403; tanpa BU item = kosong', async () => {
    expect((await call('qrview@gmail.com', 'qrcodes.itemOptions', {})).error.code).toBe(
      'FORBIDDEN',
    );
    expect((await call('noqr@gmail.com', 'qrcodes.itemOptions', {})).error.code).toBe('FORBIDDEN');
    await seedRole(env, { id: 'r-qo', name: 'QR edit saja', permissions: { qrcode: 'edit' } });
    await seedUser(env, { id: 'u-qo', email: 'qronly@gmail.com', roleIds: ['r-qo'] });
    const bare = await call('qronly@gmail.com', 'qrcodes.itemOptions', {});
    expect(bare.ok).toBe(true);
    expect(bare.data).toEqual({ items: [], nextCursor: null });
  });
});

describe('hapus konfigurasi', () => {
  test('tanpa stiker: dihapus dan item dilepas', async () => {
    const made = await save({ itemIds: ['i1', 'i2'] });
    const out = await call('qrmanage@gmail.com', 'qrcodes.delete', { id: made.data.id });
    expect(out.ok).toBe(true);
    expect(await ownerOf('i1')).toBe('');
    expect(await ownerOf('i2')).toBe('');
    expect((await call(FULL, 'qrcodes.list', null)).data).toEqual([]);
  });

  test('berstiker: CONFLICT dan tak ada yang berubah', async () => {
    const made = await save({ itemIds: ['i1'] });
    await seedStickerType(env, {
      id: 't-mb',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
    });
    await seedSticker(env, { id: 's-mb', typeId: 't-mb', name: 'X v1' });
    await seedManualBookVersion(env, { stickerId: 's-mb', designId: made.data.id, version: 1 });
    const out = await call('qrmanage@gmail.com', 'qrcodes.delete', { id: made.data.id });
    expect(out.error.code).toBe('CONFLICT');
    expect(await ownerOf('i1')).toBe(made.data.id);
    expect((await call(FULL, 'qrcodes.list', null)).data).toHaveLength(1);
  });

  test('DTO memuat versi dan status stiker terbaru', async () => {
    const made = await save({ itemIds: ['i1'] });
    await seedStickerType(env, {
      id: 't-mb',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
    });
    await seedSticker(env, { id: 's1', typeId: 't-mb', name: 'X v1', status: 'deprecated' });
    await seedSticker(env, { id: 's2', typeId: 't-mb', name: 'X v2' });
    await seedManualBookVersion(env, { stickerId: 's1', designId: made.data.id, version: 1 });
    await seedManualBookVersion(env, { stickerId: 's2', designId: made.data.id, version: 2 });
    const got = (await call(FULL, 'qrcodes.get', { id: made.data.id })).data;
    expect(got).toMatchObject({ stickerVersion: 2, stickerStatus: 'active' });
  });
});

describe('item terhapus pada konfigurasi (soft delete, penampil rujukan)', () => {
  const softDelete = (id: string) =>
    env.DB.prepare(
      "UPDATE items SET deleted_at = '2026-11-19T00:00:00.000Z', deleted_by = 'seed', status = 'inactive' WHERE id = ?",
    )
      .bind(id)
      .run();

  test('item terhapus tampil bertanda, tak dihitung ke tersembunyi; simpan mempertahankannya dan menolak pilihan baru', async () => {
    const made = await save({ itemIds: ['i1', 'i2'] });
    await softDelete('i2');
    const got = (await call(FULL, 'qrcodes.get', { id: made.data.id })).data;
    expect(got.items.map((i: { id: string }) => i.id)).toEqual(['i1', 'i2']);
    expect(got.items[1]).toMatchObject({ id: 'i2', deleted: true });
    expect(got.items[0].deleted).toBeUndefined();
    // simpan dengan item terhapus yang tetap terpilih (rujukan tersimpan) berhasil dan tetap terpasang
    const again = await call(
      FULL,
      'qrcodes.save',
      await body({ id: made.data.id, expectedUpdatedAt: got.updatedAt, itemIds: ['i1', 'i2'] }),
    );
    expect(again.ok).toBe(true);
    expect(await ownerOf('i2')).toBe(made.data.id);
    // item terhapus lain tidak dapat dipilih baru
    await softDelete('i3');
    const picked = await save({ itemIds: ['i3'], name: 'Lain' });
    expect(picked.error.code).toBe('VALIDATION');
  });

  test('konfigurasi yang sudah punya stiker: semua item terhapus tidak memenuhi "minimal satu item"', async () => {
    const made = await save({ itemIds: ['i1'] });
    await seedStickerType(env, {
      id: 't-mb',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
    });
    await seedSticker(env, { id: 's1', typeId: 't-mb', name: 'X v1' });
    await seedManualBookVersion(env, { stickerId: 's1', designId: made.data.id, version: 1 });
    await softDelete('i1');
    const got = (await call(FULL, 'qrcodes.get', { id: made.data.id })).data;
    const out = await call(
      FULL,
      'qrcodes.save',
      await body({ id: made.data.id, expectedUpdatedAt: got.updatedAt, itemIds: ['i1'] }),
    );
    expect(out.error.code).toBe('VALIDATION');
    expect(out.error.fields.itemIds).toBeDefined();
  });

  test('klaim item (balapan: dihapus atau dinonaktifkan setelah dibaca) menggagalkan batch dan tidak memasang', async () => {
    const made = await save({ itemIds: ['i1'] });
    // i2 dihapus, i1 sudah terpasang boleh tetap; i4 sudah nonaktif
    await softDelete('i2');
    for (const id of ['i2', 'i4']) {
      await expect(env.DB.batch(claimItemsStmts(env.DB, made.data.id, [id]))).rejects.toBeDefined();
      expect(await ownerOf(id)).toBe('');
    }
    // item yang sudah terpasang tetap lolos walau kemudian terhapus (rujukan tersimpan, T1)
    await softDelete('i1');
    await env.DB.batch(claimItemsStmts(env.DB, made.data.id, ['i1']));
    expect(await ownerOf('i1')).toBe(made.data.id);
  });
});
