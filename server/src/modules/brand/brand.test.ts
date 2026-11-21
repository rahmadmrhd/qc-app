import { beforeEach, describe, expect, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { getRoutes } from '@server/routes';
import { seedBusinessUnit } from '@server-test/access-fixtures';
import { captureAppError, captureAppErrorAsync } from '@server-test/errors';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { listBrands } from './repo';
import { listBrandDtos, saveBrand, setBrandStatus } from './service';
import { validateSaveBrand, validateSetBrandStatus } from './validate';

let env: TestEnv;
let admin: UserContext;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-09T00:00:00.000Z'));
  const ctx = await loadUserContext(env, 'admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

async function lastAudit() {
  const row = await env.DB.prepare(
    'SELECT action, target, `before`, `after` FROM audit_log ORDER BY id DESC LIMIT 1',
  ).first<{ action: string; target: string; before: string; after: string }>();
  if (!row) throw new Error('audit kosong');
  return {
    action: row.action,
    target: row.target,
    before: JSON.parse(row.before) as unknown,
    after: JSON.parse(row.after) as unknown,
  };
}

async function auditCount() {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{ n: number }>())?.n;
}

const brandRow = async (id: string) =>
  env.DB.prepare('SELECT name, `key` FROM brands WHERE id = ?')
    .bind(id)
    .first<{ name: string; key: string }>();

const itemRow = async (id: string) =>
  env.DB.prepare('SELECT `key` FROM items WHERE id = ?').bind(id).first<{ key: string }>();

describe('merk', () => {
  test('membuat merk: nama dirapikan, aktif, kolom id eksternal kosong, audit brand.create', async () => {
    const saved = await saveBrand(env, { name: 'Ubiquiti', businessUnitIds: [] }, admin);
    expect(saved).toMatchObject({
      name: 'Ubiquiti',
      status: 'active',
      itemCount: 0,
    });
    expect((await listBrands(env))[0]).toMatchObject({ key: 'ubiquiti' });
    expect(await lastAudit()).toMatchObject({
      action: 'brand.create',
      target: 'Ubiquiti',
      before: null,
      after: { name: 'Ubiquiti', status: 'active' },
    });
  });

  test('nama merk kembar (ternormalisasi) ditolak dengan pesan di field name', async () => {
    await saveBrand(env, { name: 'Ubiquiti', businessUnitIds: [] }, admin);
    for (const dup of ['ubiquiti', ' UBIQUITI ', 'Ubiquiti']) {
      expect(
        (
          await captureAppErrorAsync(() =>
            saveBrand(env, { name: dup, businessUnitIds: [] }, admin),
          )
        ).fields,
      ).toEqual({
        name: 'Nama merk sudah dipakai',
      });
    }
    expect(await listBrands(env)).toHaveLength(1);
  });

  test('dua pembuatan nama sama bersamaan: satu berhasil, satu CONFLICT, satu audit', async () => {
    const make = () => saveBrand(env, { name: 'Kembar', businessUnitIds: [] }, admin);
    const results = await Promise.allSettled([make(), make()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await listBrands(env)).toHaveLength(1);
    expect(await auditCount()).toBe(1);
  });

  test('mengganti nama merk: kunci semua item merk itu ikut dihitung ulang; item merk lain tak berubah', async () => {
    await seedBrand(env, 'Ubiquity');
    await seedBrand(env, 'Mikrotik');
    await seedItem(env, { id: 'i1', brand: 'Ubiquity', model: 'ES 24' });
    await seedItem(env, { id: 'i2', brand: 'Mikrotik', model: 'hAP' });
    const saved = await saveBrand(
      env,
      { id: 'brand-ubiquity', name: 'Ubiquiti', businessUnitIds: [] },
      admin,
    );
    expect(saved).toMatchObject({ name: 'Ubiquiti', itemCount: 1 });
    expect((await itemRow('i1'))?.key).toBe('ubiquiti es 24');
    expect((await itemRow('i2'))?.key).toBe('mikrotik hap');
    expect(await lastAudit()).toMatchObject({
      action: 'brand.update',
      before: { name: 'Ubiquity' },
      after: { name: 'Ubiquiti' },
    });
  });

  test('ganti nama merk besar (> 90 item): semua kunci dihitung ulang, hitungan tetap', async () => {
    await seedBrand(env, 'Lama');
    await seedBrand(env, 'Lain');
    for (let n = 1; n <= 130; n++) {
      await seedItem(env, { id: `i${n}`, brand: 'Lama', model: `M ${n}` });
    }
    await seedItem(env, { id: 'x1', brand: 'Lain', model: 'M 1' });
    const saved = await saveBrand(
      env,
      { id: 'brand-lama', name: 'Baru', businessUnitIds: [] },
      admin,
    );
    expect(saved.itemCount).toBe(130);
    const rows = (
      await env.DB.prepare('SELECT id, `key` FROM items WHERE brand_id = ? ORDER BY id')
        .bind('brand-lama')
        .all<{ id: string; key: string }>()
    ).results;
    expect(rows).toHaveLength(130);
    expect(rows.every((row) => row.key.startsWith('baru m '))).toBe(true);
    // item merk lain tak tersentuh
    expect((await itemRow('x1'))?.key).toBe('lain m 1');
    const count = await env.DB.prepare(
      "SELECT item_count AS n FROM brands WHERE id = 'brand-lama'",
    ).first<{ n: number }>();
    expect(count?.n).toBe(130);
  }, 60_000);

  test('ganti nama merk tanpa item: hanya merk dan audit yang ditulis', async () => {
    await seedBrand(env, 'Kosong');
    const saved = await saveBrand(
      env,
      { id: 'brand-kosong', name: 'Kosong 2', businessUnitIds: [] },
      admin,
    );
    expect(saved).toMatchObject({ name: 'Kosong 2', itemCount: 0 });
  });

  test('ganti nama ke merk lain ditolak; ganti kapitalisasi milik sendiri diizinkan; id tak dikenal NOT_FOUND', async () => {
    await seedBrand(env, 'A');
    await seedBrand(env, 'B');
    expect(
      (
        await captureAppErrorAsync(() =>
          saveBrand(env, { id: 'brand-a', name: 'b', businessUnitIds: [] }, admin),
        )
      ).fields,
    ).toEqual({ name: 'Nama merk sudah dipakai' });
    expect(
      (await saveBrand(env, { id: 'brand-a', name: 'a', businessUnitIds: [] }, admin)).name,
    ).toBe('a');
    expect(
      (
        await captureAppErrorAsync(() =>
          saveBrand(env, { id: 'x', name: 'Z', businessUnitIds: [] }, admin),
        )
      ).code,
    ).toBe('NOT_FOUND');
  });

  test('ganti nama yang membuat kunci merk+tipe dua item bentrok ditolak tanpa mengubah apa pun', async () => {
    await seedBrand(env, 'Ab');
    await seedBrand(env, 'A');
    await seedItem(env, { id: 'i1', brand: 'Ab', model: 'c d' });
    await seedItem(env, { id: 'i2', brand: 'A', model: 'b c d' });
    const before = await auditCount();
    const error = await captureAppErrorAsync(() =>
      saveBrand(env, { id: 'brand-ab', name: 'A b', businessUnitIds: [] }, admin),
    );
    expect(error.code).toBe('CONFLICT');
    expect(error.fields?.name).toBe('Nama baru membuat merk dan tipe dua item bentrok');
    expect((await brandRow('brand-ab'))?.name).toBe('Ab');
    expect((await itemRow('i1'))?.key).toBe('ab c d');
    expect(await auditCount()).toBe(before);
  });

  test('ganti nama yang membuat kunci item sama dengan alias item lain atau sendiri ditolak', async () => {
    await seedBrand(env, 'Ubiquity');
    await seedBrand(env, 'Mikrotik');
    await seedItem(env, { id: 'i1', brand: 'Ubiquity', model: 'ES 24' });
    await seedItem(env, { id: 'i2', brand: 'Mikrotik', model: 'X', aliases: ['Ubiquiti ES 24'] });
    const other = await captureAppErrorAsync(() =>
      saveBrand(env, { id: 'brand-ubiquity', name: 'Ubiquiti', businessUnitIds: [] }, admin),
    );
    expect(other.code).toBe('CONFLICT');
    expect(other.fields?.name).toBe('Nama baru bentrok dengan nama lain item');
    await seedItem(env, { id: 'i3', brand: 'Ubiquity', model: 'AF', aliases: ['Ubiquiti AF'] });
    expect(
      (
        await captureAppErrorAsync(() =>
          saveBrand(env, { id: 'brand-ubiquity', name: 'Ubiquiti', businessUnitIds: [] }, admin),
        )
      ).code,
    ).toBe('CONFLICT');
    expect((await brandRow('brand-ubiquity'))?.name).toBe('Ubiquity');
  });

  test('daftar merk: urut nama, memuat jumlah item (aktif dan nonaktif)', async () => {
    await seedBrand(env, 'Zebra');
    await seedBrand(env, 'Alfa');
    await seedItem(env, { id: 'i1', brand: 'Alfa', model: 'x' });
    await seedItem(env, { id: 'i2', brand: 'Alfa', model: 'y', status: 'inactive' });
    expect((await listBrandDtos(env, null, admin)).map((b) => [b.name, b.itemCount])).toEqual([
      ['Alfa', 2],
      ['Zebra', 0],
    ]);
  });

  test('menonaktifkan dan mengaktifkan merk dicatat di audit; status sama tidak menulis audit', async () => {
    await seedBrand(env, 'Alfa');
    await setBrandStatus(env, { id: 'brand-alfa', status: 'inactive' }, admin);
    expect((await lastAudit()).action).toBe('brand.deactivate');
    const before = await auditCount();
    await setBrandStatus(env, { id: 'brand-alfa', status: 'inactive' }, admin);
    expect(await auditCount()).toBe(before);
    await setBrandStatus(env, { id: 'brand-alfa', status: 'active' }, admin);
    expect((await lastAudit()).action).toBe('brand.activate');
    expect(
      (await captureAppErrorAsync(() => setBrandStatus(env, { id: 'x', status: 'active' }, admin)))
        .code,
    ).toBe('NOT_FOUND');
  });

  test('ganti nama ke nama yang persis sama tidak menulis audit', async () => {
    await seedBrand(env, 'Alfa');
    const before = await auditCount();
    expect(
      (await saveBrand(env, { id: 'brand-alfa', name: 'Alfa', businessUnitIds: [] }, admin)).name,
    ).toBe('Alfa');
    expect(await auditCount()).toBe(before);
  });
});

test('validator', () => {
  expect(validateSaveBrand({ name: '  Ubiquiti ', businessUnitIds: [] })).toEqual({
    name: 'Ubiquiti',
    businessUnitIds: [],
  });
  expect(validateSaveBrand({ id: 'b1', name: 'X', businessUnitIds: [' a ', 'a', 'b'] })).toEqual({
    id: 'b1',
    name: 'X',
    businessUnitIds: ['a', 'b'],
  });
  expect(
    captureAppError(() => validateSaveBrand({ name: '', businessUnitIds: [] })).fields,
  ).toEqual({ name: 'Wajib diisi' });
  expect(
    captureAppError(() => validateSaveBrand({ name: 'x'.repeat(61), businessUnitIds: [] })).fields,
  ).toEqual({ name: 'Maksimal 60 karakter' });
  expect(
    captureAppError(() => validateSaveBrand({ name: '--', businessUnitIds: [] })).fields,
  ).toEqual({ name: 'Nama merk harus memuat huruf atau angka' });
  for (const bad of [undefined, null, 'a', [''], [1], ['x'.repeat(101)]]) {
    expect(
      captureAppError(() => validateSaveBrand({ name: 'X', businessUnitIds: bad })).fields
        ?.businessUnitIds,
    ).toBeDefined();
  }
  expect(
    captureAppError(() =>
      validateSaveBrand({
        name: 'X',
        businessUnitIds: Array.from({ length: 51 }, (_, i) => `b${i}`),
      }),
    ).fields?.businessUnitIds,
  ).toBe('Maksimal 50 BU');
  expect(validateSetBrandStatus({ id: 'b', status: 'active' })).toEqual({
    id: 'b',
    status: 'active',
  });
  expect(captureAppError(() => validateSetBrandStatus({ id: '', status: 'x' })).fields).toEqual({
    id: 'Wajib diisi',
    status: 'Nilai tidak valid',
  });
});

test('izin rute merk: list view, save edit, setStatus manage (modul item)', () => {
  const routes = getRoutes();
  expect(routes['brands.list'].permission).toEqual({ module: 'item', level: 'view' });
  expect(routes['brands.save'].permission).toEqual({ module: 'item', level: 'edit' });
  expect(routes['brands.setStatus'].permission).toEqual({ module: 'item', level: 'manage' });
});

describe('ganti nama merk: tabrakan sementara dan perubahan himpunan item', () => {
  const keysOf = async (brandId: string) =>
    (
      await env.DB.prepare('SELECT id, `key` FROM items WHERE brand_id = ? ORDER BY id')
        .bind(brandId)
        .all<{ id: string; key: string }>()
    ).results;

  test('kunci baru satu item = kunci lama item lain di merk yang sama tetapi hasil akhir unik: berhasil', async () => {
    const id = await seedBrand(env, 'A');
    await seedItem(env, { id: 'i1', brand: 'A', model: 'c' }); // a c -> a b c
    await seedItem(env, { id: 'i2', brand: 'A', model: 'b c' }); // a b c -> a b b c
    await saveBrand(env, { id, name: 'A b', businessUnitIds: [] }, admin);
    expect(await keysOf(id)).toEqual([
      { id: 'i1', key: 'a b c' },
      { id: 'i2', key: 'a b b c' },
    ]);
  });

  test('bentrok sungguhan dengan nama lain tetap CONFLICT dengan pesan alias (bukan diulang terus)', async () => {
    await seedBrand(env, 'Ubiquity');
    await seedBrand(env, 'Mikrotik');
    await seedItem(env, { id: 'i1', brand: 'Ubiquity', model: 'ES 24' });
    await seedItem(env, { id: 'i2', brand: 'Mikrotik', model: 'X', aliases: ['Ubiquiti ES 24'] });
    const error = await captureAppErrorAsync(() =>
      saveBrand(env, { id: 'brand-ubiquity', name: 'Ubiquiti', businessUnitIds: [] }, admin),
    );
    expect(error.fields?.name).toBe('Nama baru bentrok dengan nama lain item');
    expect((await itemRow('i1'))?.key).toBe('ubiquity es 24');
  });
});

describe('ganti nama merk: kasus tepi (review)', () => {
  const keysOf = async (brandId: string) =>
    (
      await env.DB.prepare('SELECT id, `key` FROM items WHERE brand_id = ? ORDER BY id')
        .bind(brandId)
        .all<{ id: string; key: string }>()
    ).results;

  test('merk tanpa item sama sekali: ganti nama berhasil tanpa menyentuh item', async () => {
    const id = await seedBrand(env, 'Ubiquity');
    await saveBrand(env, { id, name: 'Ubiquiti', businessUnitIds: [] }, admin);
    expect((await brandRow(id))?.name).toBe('Ubiquiti');
  });

  test('tipe memuat teks Unicode tak utuh (surrogate tunggal): tetap berhasil (dibandingkan per byte)', async () => {
    const id = await seedBrand(env, 'Ubiquity');
    await seedItem(env, { id: 'i1', brand: 'Ubiquity', model: 'X\ud800' });
    await seedItem(env, { id: 'i2', brand: 'Ubiquity', model: 'Y' });
    await saveBrand(env, { id, name: 'Ubiquiti', businessUnitIds: [] }, admin);
    expect(await keysOf(id)).toEqual([
      { id: 'i1', key: 'ubiquiti x' },
      { id: 'i2', key: 'ubiquiti y' },
    ]);
  });

  test('id yang hanya beda huruf besar/kecil (kunci NOCASE): kunci sementara tetap unik', async () => {
    const id = await seedBrand(env, 'Ubiquity');
    await seedItem(env, { id: 'AB', brand: 'Ubiquity', model: 'X' });
    await seedItem(env, { id: 'ab', brand: 'Ubiquity', model: 'Y' });
    await saveBrand(env, { id, name: 'Ubiquiti', businessUnitIds: [] }, admin);
    expect(await keysOf(id)).toEqual([
      { id: 'AB', key: 'ubiquiti x' },
      { id: 'ab', key: 'ubiquiti y' },
    ]);
  });
});

describe('ganti nama merk: konkurensi (satu transaksi, baris dikunci)', () => {
  test('dua ganti nama serentak pada merk yang sama: keduanya berhasil berurutan, hasil akhir konsisten', async () => {
    const id = await seedBrand(env, 'Lama');
    for (const n of [1, 2, 3]) await seedItem(env, { id: `i${n}`, brand: 'Lama', model: `M${n}` });
    const [a, b] = await Promise.all([
      saveBrand(env, { id, name: 'Satu', businessUnitIds: [] }, admin),
      saveBrand(env, { id, name: 'Dua', businessUnitIds: [] }, admin),
    ]);
    expect([a.name, b.name].sort()).toEqual(['Dua', 'Satu']);
    const final = (await brandRow(id))?.name as string;
    expect(['Satu', 'Dua']).toContain(final);
    const items = (
      await env.DB.prepare('SELECT `key` FROM items ORDER BY id').all<{ key: string }>()
    ).results;
    expect(items.every((row) => row.key.startsWith(`${final.toLowerCase()} m`))).toBe(true);
    expect(await auditCount()).toBe(2);
  });

  test('ganti nama dan pembuatan merk bernama sama serentak: tepat satu berhasil, lainnya CONFLICT', async () => {
    const id = await seedBrand(env, 'Asal');
    const results = await Promise.allSettled([
      saveBrand(env, { id, name: 'Zed', businessUnitIds: [] }, admin),
      saveBrand(env, { name: 'Zed', businessUnitIds: [] }, admin),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'CONFLICT' });
    expect((await listBrands(env)).filter((b) => b.name === 'Zed')).toHaveLength(1);
  });
});

describe('kunci merk di tingkat layanan (Review Focus 2)', () => {
  test('Sony, "sony ", "SONY " bentrok lewat normalizeKey; Sone dan Soné adalah merk berbeda', async () => {
    await saveBrand(env, { name: 'Sony', businessUnitIds: [] }, admin);
    for (const dup of ['sony ', ' SONY ', 'Sony']) {
      expect(
        (
          await captureAppErrorAsync(() =>
            saveBrand(env, { name: dup, businessUnitIds: [] }, admin),
          )
        ).fields,
      ).toEqual({ name: 'Nama merk sudah dipakai' });
    }
    await saveBrand(env, { name: 'Sone', businessUnitIds: [] }, admin);
    await saveBrand(env, { name: 'Soné', businessUnitIds: [] }, admin);
    expect((await listBrands(env)).map((b) => b.key).sort()).toEqual(['sone', 'sony', 'soné']);
  });

  test('ganti nama ke varian ternormalisasi merk lain ditolak (lewat indeks brands_key)', async () => {
    await saveBrand(env, { name: 'Sony', businessUnitIds: [] }, admin);
    const other = await saveBrand(env, { name: 'Panasonic', businessUnitIds: [] }, admin);
    const error = await captureAppErrorAsync(() =>
      saveBrand(env, { id: other.id, name: 'SONY ', businessUnitIds: [] }, admin),
    );
    expect(error.fields).toEqual({ name: 'Nama merk sudah dipakai' });
  });
});

describe('BU bawaan merk', () => {
  const defaultsOf = async (brandId: string): Promise<string[]> =>
    (
      await env.DB.prepare(
        'SELECT bu_id FROM brand_default_business_units WHERE brand_id = ? ORDER BY bu_id',
      )
        .bind(brandId)
        .all<{ bu_id: string }>()
    ).results.map((row) => row.bu_id.trim());

  const updatedAtOf = async (brandId: string): Promise<string> =>
    (
      (await env.DB.prepare('SELECT updated_at FROM brands WHERE id = ?')
        .bind(brandId)
        .first<{ updated_at: string }>()) as { updated_at: string }
    ).updated_at;

  beforeEach(async () => {
    await seedBusinessUnit(env, { id: 'bu-a', code: 'A', name: 'BU A' });
    await seedBusinessUnit(env, { id: 'bu-b', code: 'B', name: 'BU B' });
    await seedBusinessUnit(env, { id: 'bu-x', code: 'X', name: 'BU Nonaktif', status: 'inactive' });
  });

  test('membuat merk dengan dua BU bawaan: terurut menurut kode di hasil dan di brands.list; audit memuat kode BU', async () => {
    const saved = await saveBrand(env, { name: 'Sony', businessUnitIds: ['bu-b', 'bu-a'] }, admin);
    expect(saved.businessUnitIds).toEqual(['bu-a', 'bu-b']);
    expect(await defaultsOf(saved.id)).toEqual(['bu-a', 'bu-b']);
    expect(await listBrandDtos(env, null, admin)).toMatchObject([
      { name: 'Sony', businessUnitIds: ['bu-a', 'bu-b'] },
    ]);
    expect(await lastAudit()).toMatchObject({
      action: 'brand.create',
      after: { name: 'Sony', status: 'active', businessUnits: ['A', 'B'] },
    });
  });

  test('brands.list: merk tanpa BU bawaan memuat []; BU bawaan tidak tercampur antarmerk', async () => {
    await saveBrand(env, { name: 'Sony', businessUnitIds: ['bu-a'] }, admin);
    await saveBrand(env, { name: 'LG', businessUnitIds: [] }, admin);
    await saveBrand(env, { name: 'Acer', businessUnitIds: ['bu-b', 'bu-a'] }, admin);
    expect(
      (await listBrandDtos(env, null, admin)).map((brand) => [brand.name, brand.businessUnitIds]),
    ).toEqual([
      ['Acer', ['bu-a', 'bu-b']],
      ['LG', []],
      ['Sony', ['bu-a']],
    ]);
  });

  test('hanya BU bawaan berubah (nama sama): tersimpan, updatedAt naik, audit brand.update memuat businessUnits sebelum/sesudah', async () => {
    const created = await saveBrand(
      env,
      { name: 'Sony', businessUnitIds: ['bu-a', 'bu-b'] },
      admin,
    );
    env.clock.set(Date.parse('2026-10-10T00:00:00.000Z'));
    const saved = await saveBrand(
      env,
      { id: created.id, name: 'Sony', businessUnitIds: ['bu-a'] },
      admin,
    );
    expect(saved.businessUnitIds).toEqual(['bu-a']);
    expect(saved.updatedAt).not.toBe(created.updatedAt);
    expect(await updatedAtOf(created.id)).toBe(saved.updatedAt);
    expect(await defaultsOf(created.id)).toEqual(['bu-a']);
    expect(await lastAudit()).toMatchObject({
      action: 'brand.update',
      before: { name: 'Sony', businessUnits: ['A', 'B'] },
      after: { name: 'Sony', businessUnits: ['A'] },
    });
  });

  test('himpunan dan nama sama: tanpa audit dan updatedAt tak berubah (urutan input tak berpengaruh)', async () => {
    const created = await saveBrand(
      env,
      { name: 'Sony', businessUnitIds: ['bu-a', 'bu-b'] },
      admin,
    );
    const before = await auditCount();
    env.clock.set(Date.parse('2026-10-10T00:00:00.000Z'));
    const saved = await saveBrand(
      env,
      { id: created.id, name: 'Sony', businessUnitIds: ['bu-b', 'bu-a'] },
      admin,
    );
    expect(saved.businessUnitIds).toEqual(['bu-a', 'bu-b']);
    expect(await auditCount()).toBe(before);
    expect(await updatedAtOf(created.id)).toBe(created.updatedAt);
  });

  test('BU nonaktif yang baru ditambah ditolak (VALIDATION di businessUnitIds); BU nonaktif lama boleh dipertahankan atau dilepas', async () => {
    const rejected = await captureAppErrorAsync(() =>
      saveBrand(env, { name: 'Sony', businessUnitIds: ['bu-x'] }, admin),
    );
    expect(rejected.code).toBe('VALIDATION');
    expect(rejected.fields?.businessUnitIds).toBeDefined();
    expect(await listBrands(env)).toHaveLength(0);

    const id = await seedBrand(env, 'LG');
    await env.DB.prepare('INSERT INTO brand_default_business_units (brand_id, bu_id) VALUES (?, ?)')
      .bind(id, 'bu-x')
      .run();
    const kept = await saveBrand(env, { id, name: 'LG', businessUnitIds: ['bu-x', 'bu-a'] }, admin);
    expect(kept.businessUnitIds).toEqual(['bu-a', 'bu-x']);
    const released = await saveBrand(env, { id, name: 'LG', businessUnitIds: ['bu-a'] }, admin);
    expect(released.businessUnitIds).toEqual(['bu-a']);
    const readded = await captureAppErrorAsync(() =>
      saveBrand(env, { id, name: 'LG', businessUnitIds: ['bu-a', 'bu-x'] }, admin),
    );
    expect(readded.code).toBe('VALIDATION');
    expect(await defaultsOf(id)).toEqual(['bu-a']);
  });

  test('BU tak dikenal = VALIDATION di jalur buat dan ubah, tanpa efek samping', async () => {
    const created = await captureAppErrorAsync(() =>
      saveBrand(env, { name: 'Sony', businessUnitIds: ['tidak-ada'] }, admin),
    );
    expect(created.code).toBe('VALIDATION');
    expect(created.fields?.businessUnitIds).toBeDefined();
    expect(await listBrands(env)).toHaveLength(0);

    const id = await seedBrand(env, 'LG');
    const before = await auditCount();
    const updated = await captureAppErrorAsync(() =>
      saveBrand(env, { id, name: 'LG Baru', businessUnitIds: ['bu-a', 'tidak-ada'] }, admin),
    );
    expect(updated.code).toBe('VALIDATION');
    expect((await brandRow(id))?.name).toBe('LG');
    expect(await defaultsOf(id)).toEqual([]);
    expect(await auditCount()).toBe(before);
  });

  test('businessUnitIds [] mengosongkan himpunan BU bawaan', async () => {
    const created = await saveBrand(env, { name: 'Sony', businessUnitIds: ['bu-a'] }, admin);
    const cleared = await saveBrand(
      env,
      { id: created.id, name: 'Sony', businessUnitIds: [] },
      admin,
    );
    expect(cleared.businessUnitIds).toEqual([]);
    expect(await defaultsOf(created.id)).toEqual([]);
  });

  test('brands.setStatus tak mengubah BU bawaan dan DTO-nya tetap memuatnya', async () => {
    const created = await saveBrand(
      env,
      { name: 'Sony', businessUnitIds: ['bu-b', 'bu-a'] },
      admin,
    );
    const off = await setBrandStatus(env, { id: created.id, status: 'inactive' }, admin);
    expect(off).toMatchObject({ status: 'inactive', businessUnitIds: ['bu-a', 'bu-b'] });
    const same = await setBrandStatus(env, { id: created.id, status: 'inactive' }, admin);
    expect(same.businessUnitIds).toEqual(['bu-a', 'bu-b']);
    expect(await defaultsOf(created.id)).toEqual(['bu-a', 'bu-b']);
  });

  test('rename serentak dengan perubahan BU bawaan (Promise.all): hasil akhir = tepat salah satu permintaan, tanpa baris yatim', async () => {
    for (let round = 0; round < 3; round++) {
      const id = await seedBrand(env, `Lama${round}`);
      await seedItem(env, { id: `ci${round}`, brand: `Lama${round}`, model: 'M' });
      const requests = [
        { id, name: `Satu${round}`, businessUnitIds: ['bu-a'] },
        { id, name: `Dua${round}`, businessUnitIds: ['bu-b', 'bu-a'] },
      ];
      const results = await Promise.all(requests.map((request) => saveBrand(env, request, admin)));
      expect(results).toHaveLength(2);
      const finalName = (await brandRow(id))?.name;
      const finalSet = await defaultsOf(id);
      const winner = requests.find((request) => request.name === finalName);
      expect(winner).toBeDefined();
      // nama dan himpunan berasal dari permintaan YANG SAMA (ditulis bersama di satu transaksi)
      expect(finalSet).toEqual([...(winner?.businessUnitIds ?? [])].sort());
      expect((await itemRow(`ci${round}`))?.key).toBe(`${finalName?.toLowerCase()} m`);
    }
  }, 60_000);
});
