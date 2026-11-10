import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbStatement } from '@server/core/db';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { listBrands } from '@server/modules/brand/repo';
import { uploadFile } from '@server/modules/files/service';
import { seedBusinessUnit } from '@server-test/access-fixtures';
import { bytesOfBase64 } from '@server-test/bytes';
import { captureAppErrorAsync } from '@server-test/errors';
import { brandIdOf, DEFAULT_TEST_BU_ID, seedBrand, seedItem } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { SaveItemInput } from '@shared/contract';
import { hashText } from '@shared/items';
import { findItem } from './repo';
import { getItemDto, listItemPage, planItemWrite, saveItem, setItemStatus } from './service';

const PNG = 'iVBORw0KGgoAAAANSUhEUg==';

let env: TestEnv;
let admin: UserContext;

const baseInput: SaveItemInput = {
  brandId: brandIdOf('Ubiquiti'),
  businessUnitIds: [DEFAULT_TEST_BU_ID],
  model: 'ES 24 250W',
  isCountryLock: false,
  aliases: [],
  stickerPhotos: [],
  accessories: [],
  attachments: [],
  detail: '',
};

const newFile = async () =>
  (
    await uploadFile(
      env,
      { mime: 'image/png', bytes: bytesOfBase64(PNG), width: 1, height: 1 },
      admin,
    )
  ).id;

async function lastAudit() {
  const row = await env.DB.prepare(
    'SELECT action, target, `before` AS bf, `after` AS af FROM audit_log ORDER BY id DESC LIMIT 1',
  ).first<{ action: string; target: string; bf: string; af: string }>();
  if (!row) throw new Error('audit kosong');
  return {
    action: row.action,
    target: row.target,
    before: JSON.parse(row.bf) as Record<string, unknown> | null,
    after: JSON.parse(row.af) as Record<string, unknown> | null,
  };
}

const auditActions = async () =>
  (
    await env.DB.prepare('SELECT action FROM audit_log ORDER BY id').all<{ action: string }>()
  ).results.map((r) => r.action);

const itemCount = async () =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first<{ n: number }>())?.n;

const linkCount = async () =>
  Number(
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM item_business_units').first<{ n: number }>())
      ?.n,
  );

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-09T00:00:00.000Z'));
  // BU bawaan fixture dibuat SEBELUM konteks admin dimuat (konteks super admin memuat BU yang ada saat itu).
  await seedBusinessUnit(env, { id: DEFAULT_TEST_BU_ID, code: 'DEF', name: 'BU Bawaan Tes' });
  await seedBrand(env, 'Ubiquiti');
  const ctx = await loadUserContext(env, 'admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

describe('simpan', () => {
  test('membuat item: aktif, kolom sinkron kosong, audit create tanpa teks Markdown penuh', async () => {
    const detail = '## Spesifikasi\n'.repeat(200);
    const saved = await saveItem(
      env,
      {
        ...baseInput,
        detail,
        aliases: ['ES24'],
        accessories: [{ name: 'Kabel daya', qty: 2 }],
      },
      admin,
    );
    expect(saved).toMatchObject({
      brand: 'Ubiquiti',
      model: 'ES 24 250W',
      status: 'active',
      isCountryLock: false,
      imageCount: 0,
      updatedBy: 'admin@gmail.com',
      createdAt: '2026-10-09T00:00:00.000Z',
    });
    expect(saved.detail).toBe(detail);
    expect(saved.businessUnits).toEqual([
      { id: DEFAULT_TEST_BU_ID, code: 'DEF', name: 'BU Bawaan Tes' },
    ]);
    const audit = await lastAudit();
    expect(audit).toMatchObject({
      action: 'item.create',
      target: 'Ubiquiti ES 24 250W',
      before: null,
      after: {
        brand: 'Ubiquiti',
        businessUnits: ['DEF'],
        model: 'ES 24 250W',
        isCountryLock: false,
        status: 'active',
        aliases: ['ES24'],
        stickerPhotos: { photos: 0, marks: 0 },
        accessories: ['Kabel daya ×2'],
        attachments: [],
        detailLength: detail.length,
        detailHash: hashText(detail),
      },
    });
    expect(JSON.stringify(audit.after)).not.toContain('Spesifikasi');
  });

  test('merk+tipe unik walau beda huruf besar, tanda baca, dan spasi; pesan di field tipe', async () => {
    await saveItem(env, baseInput, admin);
    for (const variant of ['es-24 250w', 'ES_24  250W', '(ES) 24, 250W']) {
      const error = await captureAppErrorAsync(() =>
        saveItem(env, { ...baseInput, model: variant }, admin),
      );
      expect(error).toMatchObject({
        code: 'CONFLICT',
        fields: { model: 'Merk dan tipe sudah dipakai item lain' },
      });
    }
    expect(await itemCount()).toBe(1);
  });

  test('mengubah item sendiri dengan merk+tipe yang sama tidak dianggap duplikat', async () => {
    const first = await saveItem(env, baseInput, admin);
    const again = await saveItem(env, { ...baseInput, id: first.id, isCountryLock: true }, admin);
    expect(again.id).toBe(first.id);
    expect(again.isCountryLock).toBe(true);
    expect(await itemCount()).toBe(1);
  });

  test('dua penyimpanan serentak dengan merk+tipe sama: satu berhasil, satu CONFLICT (indeks unik)', async () => {
    const results = await Promise.allSettled([
      saveItem(env, baseInput, admin),
      saveItem(env, baseInput, admin),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as { code: string }).code).toBe('CONFLICT');
    expect(await itemCount()).toBe(1);
    expect((await auditActions()).filter((a) => a === 'item.create')).toHaveLength(1);
    expect(await listBrands(env)).toHaveLength(1);
  });

  test('nama lain: tidak boleh sama dengan merk+tipe sendiri, merk+tipe item lain, atau nama lain item lain', async () => {
    await saveItem(env, { ...baseInput, aliases: ['AirSwitch', 'Ubiquiti ES24'] }, admin);
    const other = { ...baseInput, brandId: await seedBrand(env, 'Mikrotik'), model: 'CRS' };
    expect(
      await captureAppErrorAsync(() =>
        saveItem(env, { ...other, aliases: ['mikrotik-crs'] }, admin),
      ),
    ).toMatchObject({
      code: 'VALIDATION',
      fields: { aliases: 'Nama lain tidak boleh sama dengan merk dan tipe item ini' },
    });
    expect(
      (
        await captureAppErrorAsync(() =>
          saveItem(env, { ...other, aliases: ['ubiquiti es 24 250w'] }, admin),
        )
      ).fields?.aliases,
    ).toBe('Nama lain "ubiquiti es 24 250w" sudah dipakai item lain');
    expect(
      (
        await captureAppErrorAsync(() =>
          saveItem(env, { ...other, aliases: ['air-switch', 'airswitch'] }, admin),
        )
      ).code,
    ).toBe('CONFLICT');
    expect(
      (await captureAppErrorAsync(() => saveItem(env, { ...other, aliases: ['AIRSWITCH'] }, admin)))
        .fields?.aliases,
    ).toBe('Nama lain "AIRSWITCH" sudah dipakai item lain');
    const holder = await captureAppErrorAsync(() =>
      saveItem(env, { ...baseInput, model: 'ES24' }, admin),
    );
    expect(holder).toMatchObject({
      code: 'CONFLICT',
      message: 'Merk dan tipe sama dengan nama lain item lain',
      fields: { model: 'Merk dan tipe sama dengan nama lain item lain' },
    });
    // tidak membocorkan merk/tipe item pemegang (hanya ketikan user sendiri yang boleh muncul)
    expect(JSON.stringify([holder.message, holder.fields])).not.toMatch(/ubiquiti|250w/i);
    expect(await itemCount()).toBe(1);
  });

  test('gambar galeri dan Markdown ditautkan ke item dalam satu batch', async () => {
    const [gallery, inText] = [await newFile(), await newFile()];
    const saved = await saveItem(
      env,
      {
        ...baseInput,
        attachments: [gallery],
        detail: `Teks ![x](qcfile:${inText}) dan ![lagi](qcfile:${gallery})`,
      },
      admin,
    );
    const owned = (
      await env.DB.prepare('SELECT id, owner_type, owner_id FROM files').all<{
        id: string;
        owner_type: string;
        owner_id: string;
      }>()
    ).results.map((f) => [f.id, f.owner_type, f.owner_id]);
    expect(owned.sort()).toEqual([gallery, inText].map((id) => [id, 'item', saved.id]).sort());
    expect(saved.imageCount).toBe(1);
  });

  test('rujukan berkas yang gagal membatalkan seluruh simpan: tidak ada item, pemilik tak berubah, tak ada baris BU yatim', async () => {
    const [free, taken] = [await newFile(), await newFile()];
    await saveItem(env, { ...baseInput, model: 'Item', attachments: [taken] }, admin);
    const filesBefore = JSON.stringify(
      (await env.DB.prepare('SELECT * FROM files ORDER BY id').all()).results,
    );
    expect(
      (
        await captureAppErrorAsync(() =>
          saveItem(env, { ...baseInput, model: 'Baru', attachments: [free, 'hilang'] }, admin),
        )
      ).code,
    ).toBe('VALIDATION');
    expect(
      (
        await captureAppErrorAsync(() =>
          saveItem(
            env,
            { ...baseInput, attachments: [free], detail: `![x](qcfile:${taken})` },
            admin,
          ),
        )
      ).code,
    ).toBe('CONFLICT');
    expect(
      JSON.stringify((await env.DB.prepare('SELECT * FROM files ORDER BY id').all()).results),
    ).toBe(filesBefore);
    expect(await itemCount()).toBe(1);
    expect(await linkCount()).toBe(1);
  });

  test('rujukan berkas bermasalah dilaporkan di field yang sesuai', async () => {
    const ghost = 'tidak-ada';
    const att = await captureAppErrorAsync(() =>
      saveItem(env, { ...baseInput, attachments: [ghost] }, admin),
    );
    expect(att).toMatchObject({
      code: 'VALIDATION',
      fields: { attachments: expect.stringContaining('tidak dikenal') },
    });
    const det = await captureAppErrorAsync(() =>
      saveItem(env, { ...baseInput, detail: `![x](qcfile:${ghost})` }, admin),
    );
    expect(det.fields).toHaveProperty('detail');
    const taken = await newFile();
    await saveItem(env, { ...baseInput, model: 'Pemilik', attachments: [taken] }, admin);
    const dup = await captureAppErrorAsync(() =>
      saveItem(env, { ...baseInput, model: 'Lain', attachments: [taken] }, admin),
    );
    expect(dup).toMatchObject({
      code: 'CONFLICT',
      fields: { attachments: expect.stringContaining('sudah dipakai') },
    });
    expect(await itemCount()).toBe(1);
  });

  test('mengubah item mempertahankan waktu dibuat', async () => {
    await seedItem(env, { id: 'i1', brand: 'Ubiquiti', model: 'ES 24 250W' });
    await env.DB.prepare("UPDATE items SET created_at = '2026-01-01T00:00:00.000Z'").run();
    const saved = await saveItem(env, { ...baseInput, id: 'i1', isCountryLock: true }, admin);
    expect(saved).toMatchObject({
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-10-09T00:00:00.000Z',
    });
  });

  test('mengubah item mencatat snapshot sebelum dan sesudah; id tak dikenal NOT_FOUND', async () => {
    const first = await saveItem(
      env,
      { ...baseInput, accessories: [{ name: 'Kabel', qty: 1 }] },
      admin,
    );
    env.clock.advance(1000);
    await saveItem(
      env,
      {
        ...baseInput,
        id: first.id,
        accessories: [
          { name: 'Kabel', qty: 2 },
          { name: 'Adaptor', qty: 1 },
        ],
        detail: 'baru',
      },
      admin,
    );
    expect(await lastAudit()).toMatchObject({
      action: 'item.update',
      before: { accessories: ['Kabel ×1'], detailLength: 0 },
      after: {
        accessories: ['Kabel ×2', 'Adaptor ×1'],
        detailLength: 4,
        detailHash: hashText('baru'),
      },
    });
    expect(
      (await captureAppErrorAsync(() => saveItem(env, { ...baseInput, id: 'tidak-ada' }, admin)))
        .code,
    ).toBe('NOT_FOUND');
  });

  test('merk dipilih lewat brandId: nama dari tabel merk, tidak ada merk dibuat dari simpan item; brandId tak dikenal VALIDATION', async () => {
    const first = await saveItem(env, baseInput, admin);
    expect(first.brandId).toBe(brandIdOf('Ubiquiti'));
    expect(first.brand).toBe('Ubiquiti');
    expect(await auditActions()).toEqual(['item.create']);
    expect(await listBrands(env)).toHaveLength(1);
    const error = await captureAppErrorAsync(() =>
      saveItem(env, { ...baseInput, brandId: 'tidak-ada', model: 'AF' }, admin),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fields: { brandId: 'Merk tidak ditemukan' },
    });
    expect(await listBrands(env)).toHaveLength(1);
    expect(await itemCount()).toBe(1);
  });

  test('merk nonaktif tidak bisa dipakai item baru, tetapi item lama merk itu tetap dapat disimpan', async () => {
    const lama = await seedBrand(env, 'Lama', { status: 'inactive' });
    expect(
      (await captureAppErrorAsync(() => saveItem(env, { ...baseInput, brandId: lama }, admin)))
        .fields,
    ).toEqual({ brandId: 'Merk dinonaktifkan; aktifkan dulu di halaman Merk' });
    expect(await itemCount()).toBe(0);
    await seedItem(env, { id: 'i1', brand: 'Lama', model: 'X' });
    expect(
      (
        await saveItem(
          env,
          { ...baseInput, id: 'i1', brandId: lama, model: 'X', isCountryLock: true },
          admin,
        )
      ).isCountryLock,
    ).toBe(true);
  });

  test('galat validasi tidak meninggalkan apa pun: tanpa item, baris BU, atau audit tambahan', async () => {
    await saveItem(env, { ...baseInput, model: 'B' }, admin);
    const audits = (await auditActions()).length;
    expect(
      (
        await captureAppErrorAsync(() =>
          saveItem(env, { ...baseInput, model: 'x', attachments: ['hantu'] }, admin),
        )
      ).code,
    ).toBe('VALIDATION');
    expect(await itemCount()).toBe(1);
    expect(await linkCount()).toBe(1);
    expect((await auditActions()).length).toBe(audits);
  });
});

describe('batch penulisan item', () => {
  test('INSERT dan UPDATE pada merk yang sudah ada: pernyataan pertama adalah penjaga merk (I1), baris tersimpan', async () => {
    const plan = await planItemWrite(env, baseInput, { id: 'baru-1', actor: admin });
    await env.DB.batch(plan.statements);
    expect(await itemCount()).toBe(1);
    env.clock.advance(1000);
    const existing = await findItem(env, 'baru-1');
    if (!existing) throw new Error('item hilang');
    const update = await planItemWrite(
      env,
      { ...baseInput, id: 'baru-1', detail: 'berubah', expectedUpdatedAt: existing.updatedAt },
      {
        id: 'baru-1',
        actor: admin,
        existing,
      },
    );
    const updated = await env.DB.batch(update.statements);
    // merk sudah ada: pernyataan pertama batch adalah penjaga merk (I1)
    expect(updated[0]?.results[0]).toEqual({ guard_ok: 1 });
    expect((await getItemDto(env, { id: 'baru-1' }, admin)).detail).toBe('berubah');
  });
});

describe('teks Unicode (emoji, 4 byte UTF-8)', () => {
  test('detail Markdown dan nama lain berisi emoji tersimpan dan terbaca utuh (utf8mb4)', async () => {
    const detail = '# Panduan 😀\n\n- paket 📦 lengkap\n- 𝒳 dan 👨‍👩‍👧‍👦';
    const saved = await saveItem(
      env,
      { ...baseInput, model: 'Emoji 😀', aliases: ['Mantap 😀', 'Nama 👍'], detail },
      admin,
    );
    const got = await getItemDto(env, { id: saved.id }, admin);
    expect(got.detail).toBe(detail);
    expect(got.model).toBe('Emoji 😀');
    expect(got.aliases).toEqual(['Mantap 😀', 'Nama 👍']);
    // kolom mentah dan indeks nama lain juga utuh
    const row = await env.DB.prepare('SELECT detail_md, alias_keys FROM items WHERE id = ?')
      .bind(saved.id)
      .first<{ detail_md: string; alias_keys: string }>();
    expect(row?.detail_md).toBe(detail);
    // kunci pencarian dinormalisasi (emoji dibuang), teks aslinya tetap utuh di kolom aliases
    expect(row?.alias_keys).toBe('|mantap|nama|');
    const keys = (
      await env.DB.prepare('SELECT `key` FROM item_alias_keys WHERE item_id = ? ORDER BY `key`')
        .bind(saved.id)
        .all<{ key: string }>()
    ).results.map((r) => r.key);
    expect(keys).toEqual(['mantap', 'nama']);
    // pencarian lewat nama lain bernama emoji; menyimpan ulang tidak merusak
    expect((await listItemPage(env, { query: 'mantap' }, admin)).items.map((i) => i.id)).toEqual([
      saved.id,
    ]);
    env.clock.advance(1000);
    await saveItem(
      env,
      { ...baseInput, id: saved.id, model: 'Emoji 😀', aliases: ['Mantap 😀'], detail },
      admin,
    );
    expect((await getItemDto(env, { id: saved.id }, admin)).detail).toBe(detail);
  });
});

describe('konkurensi optimistis', () => {
  test('expectedUpdatedAt basi -> CONFLICT dan item tidak berubah; cocok atau kosong -> tersimpan', async () => {
    const first = await saveItem(env, { ...baseInput, detail: 'awal' }, admin);
    env.clock.advance(1000);
    const stale = await captureAppErrorAsync(() =>
      saveItem(
        env,
        {
          ...baseInput,
          id: first.id,
          detail: 'timpa',
          expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
        },
        admin,
      ),
    );
    expect(stale.code).toBe('CONFLICT');
    expect(stale.message).toContain('diubah orang lain');
    expect(stale.stale).toBe(true);
    expect((await getItemDto(env, { id: first.id }, admin)).detail).toBe('awal');
    const ok = await saveItem(
      env,
      { ...baseInput, id: first.id, detail: 'cocok', expectedUpdatedAt: first.updatedAt },
      admin,
    );
    expect(ok.detail).toBe('cocok');
    env.clock.advance(1000);
    expect(
      (await saveItem(env, { ...baseInput, id: first.id, detail: 'tanpa' }, admin)).detail,
    ).toBe('tanpa');
  });

  test('dua penyimpanan serentak dari versi yang sama: satu menang, satu CONFLICT, tanpa audit ganda', async () => {
    const first = await saveItem(env, { ...baseInput, detail: 'awal' }, admin);
    env.clock.advance(1000);
    const edit = (detail: string) =>
      saveItem(
        env,
        { ...baseInput, id: first.id, detail, expectedUpdatedAt: first.updatedAt },
        admin,
      );
    const results = await Promise.allSettled([edit('A'), edit('B')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as { code: string }).code).toBe('CONFLICT');
    expect((await auditActions()).filter((a) => a === 'item.update')).toHaveLength(1);
    // yang kalah dibatalkan utuh: isi tersimpan = milik pemenang
    expect(['A', 'B']).toContain((await getItemDto(env, { id: first.id }, admin)).detail);
  });
});

describe('CAS digabung ke UPDATE (konkurensi)', () => {
  test('ubah status dan simpan serentak dari versi yang sama: yang kalah dibatalkan utuh, tanpa audit ganda', async () => {
    const first = await saveItem(env, { ...baseInput, detail: 'awal' }, admin);
    env.clock.advance(1000);
    const [saved, status] = await Promise.allSettled([
      saveItem(
        env,
        { ...baseInput, id: first.id, detail: 'baru', expectedUpdatedAt: first.updatedAt },
        admin,
      ),
      setItemStatus(env, { id: first.id, status: 'inactive' }, admin),
    ]);
    // setItemStatus tak membawa versi dan dibungkus runCas (memuat ulang lalu mengulang), jadi SELALU berhasil. Dua hasil
    // sah: status menang dulu lalu simpan basi = CONFLICT (1 berhasil), atau simpan menang dulu lalu status mengulang (2).
    expect(status.status).toBe('fulfilled');
    const fulfilled = [saved, status].filter((r) => r.status === 'fulfilled').length;
    if (saved.status === 'rejected') {
      expect((saved.reason as { code: string }).code).toBe('CONFLICT');
      expect(fulfilled).toBe(1);
    } else {
      expect(fulfilled).toBe(2);
    }
    // Apa pun urutannya: tepat satu audit per tulis yang berhasil (batch yang kalah dibatalkan utuh), dan keadaan akhir
    // = hasil tulis yang berhasil (simpan yang kalah tidak meninggalkan perubahan sebagian).
    expect(
      (await auditActions()).filter((a) => a.startsWith('item.') && a !== 'item.create'),
    ).toHaveLength(fulfilled);
    const final = await getItemDto(env, { id: first.id }, admin);
    expect(final.status).toBe('inactive');
    expect(final.detail).toBe(saved.status === 'fulfilled' ? 'baru' : 'awal');
  });

  test('item dengan nama lain: CAS basi membatalkan juga perubahan baris nama lain', async () => {
    const first = await saveItem(env, { ...baseInput, aliases: ['Lama'] }, admin);
    env.clock.advance(1000);
    await saveItem(env, { ...baseInput, id: first.id, aliases: ['Lama', 'Tengah'] }, admin);
    env.clock.advance(1000);
    await expect(
      saveItem(
        env,
        {
          ...baseInput,
          id: first.id,
          aliases: ['Baru'],
          expectedUpdatedAt: first.updatedAt,
        },
        admin,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const keys = (
      await env.DB.prepare('SELECT `key` FROM item_alias_keys WHERE item_id = ? ORDER BY `key`')
        .bind(first.id)
        .all<{ key: string }>()
    ).results.map((r) => r.key);
    expect(keys).toEqual(['lama', 'tengah']);
  });
});

describe('status', () => {
  test('nonaktifkan dan aktifkan dicatat; status sama tidak mencatat apa pun', async () => {
    const saved = await saveItem(env, baseInput, admin);
    env.clock.advance(1000);
    expect((await setItemStatus(env, { id: saved.id, status: 'inactive' }, admin)).status).toBe(
      'inactive',
    );
    expect(await lastAudit()).toMatchObject({
      action: 'item.deactivate',
      target: 'Ubiquiti ES 24 250W',
      before: { status: 'active' },
      after: { status: 'inactive' },
    });
    const count = (await auditActions()).length;
    await setItemStatus(env, { id: saved.id, status: 'inactive' }, admin);
    expect(await auditActions()).toHaveLength(count);
    env.clock.advance(1000);
    expect((await setItemStatus(env, { id: saved.id, status: 'active' }, admin)).status).toBe(
      'active',
    );
    expect((await lastAudit()).action).toBe('item.activate');
    expect(
      (await captureAppErrorAsync(() => setItemStatus(env, { id: 'x', status: 'active' }, admin)))
        .code,
    ).toBe('NOT_FOUND');
  });

  test('item nonaktif dapat diubah dan tetap nonaktif', async () => {
    const saved = await saveItem(env, baseInput, admin);
    env.clock.advance(1000);
    await setItemStatus(env, { id: saved.id, status: 'inactive' }, admin);
    env.clock.advance(1000);
    const edited = await saveItem(env, { ...baseInput, id: saved.id, isCountryLock: true }, admin);
    expect(edited.status).toBe('inactive');
  });
});

describe('daftar berkursor dan get', () => {
  test('urut menurut kunci merk+tipe, memuat nonaktif, tanpa detail Markdown', async () => {
    await seedItem(env, { id: 'i2', brand: 'Ubiquiti', model: 'B' });
    await env.DB.prepare(
      "UPDATE items SET detail_md = 'RAHASIA', attachments = '[\"f1\",\"f2\"]' WHERE id = 'i2'",
    ).run();
    await seedItem(env, { id: 'i1', brand: 'Mikrotik', model: 'Z', status: 'inactive' });
    await seedItem(env, { id: 'i3', brand: 'Ubiquiti', model: 'A' });
    await seedBrand(env, 'Mikrotik');
    const page = await listItemPage(env, {}, admin);
    expect(page.items.map((i) => `${i.brand} ${i.model}`)).toEqual([
      'Mikrotik Z',
      'Ubiquiti A',
      'Ubiquiti B',
    ]);
    expect(page.items.find((i) => i.id === 'i2')?.imageCount).toBe(2);
    expect(page.items.find((i) => i.id === 'i1')?.status).toBe('inactive');
    expect(JSON.stringify(page)).not.toContain('RAHASIA');
    expect('detail' in (page.items[0] ?? {})).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  test('halaman berkursor tanpa duplikat/lompatan; batas default 20; filter status dan kueri', async () => {
    await seedBrand(env, 'Merk');
    for (let i = 0; i < 45; i++) {
      await seedItem(env, {
        id: `i${i}`,
        brand: 'Merk',
        model: `M${String(i).padStart(2, '0')}`,
        brandId: 'brand-merk',
        status: i % 5 === 0 ? 'inactive' : 'active',
        aliases: i === 7 ? ['Tujuh'] : [],
      });
    }
    expect((await listItemPage(env, {}, admin)).items).toHaveLength(20);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listItemPage(env, { limit: 20, ...(cursor ? { cursor } : {}) }, admin);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(45);
    expect(seen[0]).toBe('i0');
    const inactive = await listItemPage(env, { status: 'inactive', limit: 50 }, admin);
    expect(inactive.items).toHaveLength(9);
    expect((await listItemPage(env, { query: 'm12' }, admin)).items.map((i) => i.id)).toEqual([
      'i12',
    ]);
    expect((await listItemPage(env, { query: 'tujuh' }, admin)).items.map((i) => i.id)).toEqual([
      'i7',
    ]);
    expect((await listItemPage(env, { query: 'tidak ada' }, admin)).items).toHaveLength(0);
  });

  test('daftar tidak menyentuh kolom JSON besar (stiker, kelengkapan, detail)', async () => {
    await seedItem(env, { id: 'i1', brand: 'A', model: 'B' });
    await env.DB.prepare(
      "UPDATE items SET stickers = '{rusak', accessories = '{rusak', detail_md = 'xxxxxxxxxx'",
    ).run();
    const page = await listItemPage(env, {}, admin);
    expect(page.items).toHaveLength(1);
    // lampiran rusak = 0 gambar, bukan galat
    await env.DB.prepare("UPDATE items SET attachments = '{rusak'").run();
    expect((await listItemPage(env, {}, admin)).items[0]?.imageCount).toBe(0);
  });

  test('getItemDto memuat detail lengkap; id tak dikenal NOT_FOUND', async () => {
    await seedItem(env, { id: 'i1', brand: 'A', model: 'B' });
    await env.DB.prepare(
      'UPDATE items SET detail_md = \'# isi\', accessories = \'[{"name":"x","qty":1}]\'',
    ).run();
    expect(await getItemDto(env, { id: 'i1' }, admin)).toMatchObject({
      detail: '# isi',
      accessories: [{ name: 'x', qty: 1 }],
    });
    expect(
      (await captureAppErrorAsync(() => getItemDto(env, { id: 'tidak-ada' }, admin))).code,
    ).toBe('NOT_FOUND');
  });
});

describe('indeks nama lain dan penghitung item per merk (migrasi 0009)', () => {
  const aliasRows = async () =>
    (
      await env.DB.prepare('SELECT `key`, item_id FROM item_alias_keys ORDER BY `key`').all<{
        key: string;
        item_id: string;
      }>()
    ).results;
  const brandCount = async (name: string) =>
    (
      await env.DB.prepare('SELECT item_count AS n FROM brands WHERE name = ?')
        .bind(name)
        .first<{ n: number }>()
    )?.n;

  test('membuat item menulis satu baris per kunci nama lain dan menaikkan item_count merk', async () => {
    const saved = await saveItem(
      env,
      { ...baseInput, aliases: ['ES-24', 'es 24', 'Switch Ubnt'] },
      admin,
    );
    // 'ES-24' dan 'es 24' berkunci sama: satu baris
    expect(await aliasRows()).toEqual([
      { key: 'es 24', item_id: saved.id },
      { key: 'switch ubnt', item_id: saved.id },
    ]);
    expect(await brandCount('Ubiquiti')).toBe(1);
    await saveItem(env, { ...baseInput, model: 'ES 48' }, admin);
    expect(await brandCount('Ubiquiti')).toBe(2);
  });

  test('mengubah nama lain: hanya selisih ditulis; menghapus semua mengosongkan baris item itu', async () => {
    const saved = await saveItem(env, { ...baseInput, aliases: ['A1', 'B2'] }, admin);
    const other = await saveItem(env, { ...baseInput, model: 'Lain', aliases: ['Z9'] }, admin);
    await saveItem(env, { ...baseInput, id: saved.id, aliases: ['B2', 'C3'] }, admin);
    expect(await aliasRows()).toEqual([
      { key: 'b2', item_id: saved.id },
      { key: 'c3', item_id: saved.id },
      { key: 'z9', item_id: other.id },
    ]);
    await saveItem(env, { ...baseInput, id: saved.id, aliases: [] }, admin);
    expect(await aliasRows()).toEqual([{ key: 'z9', item_id: other.id }]);
    // nama lain yang dilepas dapat dipakai item lain
    await saveItem(
      env,
      { ...baseInput, id: other.id, model: 'Lain', aliases: ['Z9', 'A1'] },
      admin,
    );
    expect((await aliasRows()).map((row) => row.key)).toEqual(['a1', 'z9']);
  });

  test('pindah merk memindahkan penghitung; status tidak mengubahnya', async () => {
    const saved = await saveItem(env, baseInput, admin);
    expect(await brandCount('Ubiquiti')).toBe(1);
    const mikrotik = await seedBrand(env, 'Mikrotik');
    await saveItem(env, { ...baseInput, id: saved.id, brandId: mikrotik }, admin);
    expect(await brandCount('Ubiquiti')).toBe(0);
    expect(await brandCount('Mikrotik')).toBe(1);
    await setItemStatus(env, { id: saved.id, status: 'inactive' }, admin);
    expect(await brandCount('Mikrotik')).toBe(1);
  });

  test('bentrok nama lain dilaporkan dari indeks; rebutan di basis data tetap CONFLICT (PRIMARY KEY)', async () => {
    const first = await saveItem(env, { ...baseInput, aliases: ['Samaan'] }, admin);
    const error = await captureAppErrorAsync(() =>
      saveItem(env, { ...baseInput, model: 'Kedua', aliases: ['SAMAAN'] }, admin),
    );
    expect(error.code).toBe('CONFLICT');
    expect(error.fields?.aliases).toContain('sudah dipakai');
    // item lain merebut kunci setelah pemeriksaan aplikasi: PRIMARY KEY menolak, tanpa item setengah jadi
    const second = await saveItem(env, { ...baseInput, model: 'Ketiga' }, admin);
    const racing = await captureAppErrorAsync(async () => {
      const original = env.DB.batch.bind(env.DB);
      let calls = 0;
      env.DB.batch = (async (statements: DbStatement[]) => {
        // panggilan pertama = pemeriksaan nama (lolos); sebelum batch tulis, item lain merebut kuncinya
        if (++calls === 2) {
          await env.DB.prepare('INSERT INTO item_alias_keys (`key`, item_id) VALUES (?, ?)')
            .bind('rebutan', first.id)
            .run();
          env.DB.batch = original;
        }
        return original(statements);
      }) as typeof env.DB.batch;
      await saveItem(
        env,
        { ...baseInput, id: second.id, model: 'Ketiga', aliases: ['Rebutan'] },
        admin,
      );
    });
    expect(racing.code).toBe('CONFLICT');
    expect(racing.fields?.aliases).toBeDefined();
    expect((await getItemDto(env, { id: second.id }, admin)).aliases).toEqual([]);
  });

  test('nama lain sama dengan merk+tipe item lain tetap ditolak (kunci item vs nama lain)', async () => {
    await saveItem(env, { ...baseInput, model: 'Ada' }, admin);
    const error = await captureAppErrorAsync(() =>
      saveItem(env, { ...baseInput, model: 'Baru', aliases: ['Ubiquiti Ada'] }, admin),
    );
    expect(error.code).toBe('CONFLICT');
  });
});
