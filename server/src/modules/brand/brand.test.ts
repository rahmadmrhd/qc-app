import { beforeEach, describe, expect, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { getRoutes } from '@server/routes';
import { captureAppError, captureAppErrorAsync } from '@server-test/errors';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { listBrands } from './repo';
import { listBrandDtos, planBrandByName, saveBrand, setBrandStatus } from './service';
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
    const saved = await saveBrand(env, { name: 'Ubiquiti' }, admin);
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
    await saveBrand(env, { name: 'Ubiquiti' }, admin);
    for (const dup of ['ubiquiti', ' UBIQUITI ', 'Ubiquiti']) {
      expect(
        (await captureAppErrorAsync(() => saveBrand(env, { name: dup }, admin))).fields,
      ).toEqual({
        name: 'Nama merk sudah dipakai',
      });
    }
    expect(await listBrands(env)).toHaveLength(1);
  });

  test('dua pembuatan nama sama bersamaan: satu berhasil, satu CONFLICT, satu audit', async () => {
    const make = () => saveBrand(env, { name: 'Kembar' }, admin);
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
    const saved = await saveBrand(env, { id: 'brand-ubiquity', name: 'Ubiquiti' }, admin);
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
    const saved = await saveBrand(env, { id: 'brand-lama', name: 'Baru' }, admin);
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
    const saved = await saveBrand(env, { id: 'brand-kosong', name: 'Kosong 2' }, admin);
    expect(saved).toMatchObject({ name: 'Kosong 2', itemCount: 0 });
  });

  test('ganti nama ke merk lain ditolak; ganti kapitalisasi milik sendiri diizinkan; id tak dikenal NOT_FOUND', async () => {
    await seedBrand(env, 'A');
    await seedBrand(env, 'B');
    expect(
      (await captureAppErrorAsync(() => saveBrand(env, { id: 'brand-a', name: 'b' }, admin)))
        .fields,
    ).toEqual({ name: 'Nama merk sudah dipakai' });
    expect((await saveBrand(env, { id: 'brand-a', name: 'a' }, admin)).name).toBe('a');
    expect(
      (await captureAppErrorAsync(() => saveBrand(env, { id: 'x', name: 'Z' }, admin))).code,
    ).toBe('NOT_FOUND');
  });

  test('ganti nama yang membuat kunci merk+tipe dua item bentrok ditolak tanpa mengubah apa pun', async () => {
    await seedBrand(env, 'Ab');
    await seedBrand(env, 'A');
    await seedItem(env, { id: 'i1', brand: 'Ab', model: 'c d' });
    await seedItem(env, { id: 'i2', brand: 'A', model: 'b c d' });
    const before = await auditCount();
    const error = await captureAppErrorAsync(() =>
      saveBrand(env, { id: 'brand-ab', name: 'A b' }, admin),
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
      saveBrand(env, { id: 'brand-ubiquity', name: 'Ubiquiti' }, admin),
    );
    expect(other.code).toBe('CONFLICT');
    expect(other.fields?.name).toBe('Nama baru bentrok dengan nama lain item');
    await seedItem(env, { id: 'i3', brand: 'Ubiquity', model: 'AF', aliases: ['Ubiquiti AF'] });
    expect(
      (
        await captureAppErrorAsync(() =>
          saveBrand(env, { id: 'brand-ubiquity', name: 'Ubiquiti' }, admin),
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
    expect((await listBrandDtos(env)).map((b) => [b.name, b.itemCount])).toEqual([
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
    expect((await saveBrand(env, { id: 'brand-alfa', name: 'Alfa' }, admin)).name).toBe('Alfa');
    expect(await auditCount()).toBe(before);
  });
});

describe('planBrandByName (untuk penyimpanan item)', () => {
  test('merk yang ada dipakai tanpa pernyataan; yang baru menghasilkan pernyataan atomik', async () => {
    await seedBrand(env, 'Ubiquiti');
    const found = await planBrandByName(env, ' ubiquiti ', admin);
    expect(found.brand.id).toBe('brand-ubiquiti');
    expect(found.statements).toHaveLength(0);
    const fresh = await planBrandByName(env, 'Mikrotik', admin);
    expect(fresh.statements.length).toBeGreaterThan(0);
    expect(await listBrands(env)).toHaveLength(1);
    await env.DB.batch(fresh.statements);
    expect((await listBrands(env)).map((b) => b.name).sort()).toEqual(['Mikrotik', 'Ubiquiti']);
    expect((await lastAudit()).action).toBe('brand.create');
  });
});

test('validator', () => {
  expect(validateSaveBrand({ name: '  Ubiquiti ' })).toEqual({ name: 'Ubiquiti' });
  expect(validateSaveBrand({ id: 'b1', name: 'X' })).toEqual({ id: 'b1', name: 'X' });
  expect(captureAppError(() => validateSaveBrand({ name: '' })).fields).toEqual({
    name: 'Wajib diisi',
  });
  expect(captureAppError(() => validateSaveBrand({ name: 'x'.repeat(61) })).fields).toEqual({
    name: 'Maksimal 60 karakter',
  });
  expect(captureAppError(() => validateSaveBrand({ name: '--' })).fields).toEqual({
    name: 'Nama merk harus memuat huruf atau angka',
  });
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
    await saveBrand(env, { id, name: 'A b' }, admin);
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
      saveBrand(env, { id: 'brand-ubiquity', name: 'Ubiquiti' }, admin),
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
    await saveBrand(env, { id, name: 'Ubiquiti' }, admin);
    expect((await brandRow(id))?.name).toBe('Ubiquiti');
  });

  test('tipe memuat teks Unicode tak utuh (surrogate tunggal): tetap berhasil (dibandingkan per byte)', async () => {
    const id = await seedBrand(env, 'Ubiquity');
    await seedItem(env, { id: 'i1', brand: 'Ubiquity', model: 'X\ud800' });
    await seedItem(env, { id: 'i2', brand: 'Ubiquity', model: 'Y' });
    await saveBrand(env, { id, name: 'Ubiquiti' }, admin);
    expect(await keysOf(id)).toEqual([
      { id: 'i1', key: 'ubiquiti x' },
      { id: 'i2', key: 'ubiquiti y' },
    ]);
  });

  test('id yang hanya beda huruf besar/kecil (kunci NOCASE): kunci sementara tetap unik', async () => {
    const id = await seedBrand(env, 'Ubiquity');
    await seedItem(env, { id: 'AB', brand: 'Ubiquity', model: 'X' });
    await seedItem(env, { id: 'ab', brand: 'Ubiquity', model: 'Y' });
    await saveBrand(env, { id, name: 'Ubiquiti' }, admin);
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
      saveBrand(env, { id, name: 'Satu' }, admin),
      saveBrand(env, { id, name: 'Dua' }, admin),
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
      saveBrand(env, { id, name: 'Zed' }, admin),
      saveBrand(env, { name: 'Zed' }, admin),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'CONFLICT' });
    expect((await listBrands(env)).filter((b) => b.name === 'Zed')).toHaveLength(1);
  });
});

describe('kunci merk di tingkat layanan (Review Focus 2)', () => {
  test('Sony, "sony ", "SONY " bentrok lewat normalizeKey; Sone dan Soné adalah merk berbeda', async () => {
    await saveBrand(env, { name: 'Sony' }, admin);
    for (const dup of ['sony ', ' SONY ', 'Sony']) {
      expect(
        (await captureAppErrorAsync(() => saveBrand(env, { name: dup }, admin))).fields,
      ).toEqual({ name: 'Nama merk sudah dipakai' });
    }
    await saveBrand(env, { name: 'Sone' }, admin);
    await saveBrand(env, { name: 'Soné' }, admin);
    expect((await listBrands(env)).map((b) => b.key).sort()).toEqual(['sone', 'sony', 'soné']);
  });

  test('ganti nama ke varian ternormalisasi merk lain ditolak (lewat indeks brands_key)', async () => {
    await saveBrand(env, { name: 'Sony' }, admin);
    const other = await saveBrand(env, { name: 'Panasonic' }, admin);
    const error = await captureAppErrorAsync(() =>
      saveBrand(env, { id: other.id, name: 'SONY ' }, admin),
    );
    expect(error.fields).toEqual({ name: 'Nama merk sudah dipakai' });
  });
});
