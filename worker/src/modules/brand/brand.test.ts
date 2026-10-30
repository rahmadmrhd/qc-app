import { beforeEach, describe, expect, test } from 'bun:test';
import type { UserContext } from '@worker/modules/access/context';
import { loadUserContext } from '@worker/modules/access/context';
import { currentSyncRev } from '@worker/modules/sync/state';
import { getRoutes } from '@worker/routes';
import { captureAppError, captureAppErrorAsync } from '@worker-test/errors';
import { seedBrand, seedItem } from '@worker-test/item-fixtures';
import { measureCpu } from '@worker-test/measure';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';
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
    'SELECT action, target, "before" AS before, "after" AS after FROM audit_log ORDER BY id DESC LIMIT 1',
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
  env.DB.prepare('SELECT name, key, sync_rev FROM brands WHERE id = ?')
    .bind(id)
    .first<{ name: string; key: string; sync_rev: number }>();

const itemRow = async (id: string) =>
  env.DB.prepare('SELECT key, sync_rev FROM items WHERE id = ?')
    .bind(id)
    .first<{ key: string; sync_rev: number }>();

describe('merk', () => {
  test('membuat merk: nama dirapikan, aktif, kolom sinkron kosong, audit brand.create', async () => {
    const saved = await saveBrand(env, { name: 'Ubiquiti' }, admin);
    expect(saved).toMatchObject({
      name: 'Ubiquiti',
      status: 'active',
      externalId: '',
      itemCount: 0,
    });
    expect((await listBrands(env))[0]).toMatchObject({ key: 'ubiquiti', syncRev: 1 });
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
    expect(await currentSyncRev(env.DB, 'brands')).toBe(1);
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

  test('ganti nama merk besar (> 90 item): semua kunci dihitung ulang, revisi item unik dan menaik, hitungan tetap', async () => {
    await seedBrand(env, 'Lama');
    await seedBrand(env, 'Lain');
    for (let n = 1; n <= 130; n++) {
      await seedItem(env, { id: `i${n}`, brand: 'Lama', model: `M ${n}`, syncRev: n });
    }
    await seedItem(env, { id: 'x1', brand: 'Lain', model: 'M 1', syncRev: 500 });
    await env.DB.prepare(
      "INSERT INTO sync_state (resource, seq, updated_at) VALUES ('items', 500, '')",
    ).run();
    const saved = await saveBrand(env, { id: 'brand-lama', name: 'Baru' }, admin);
    expect(saved.itemCount).toBe(130);
    const rows = (
      await env.DB.prepare(
        'SELECT id, key, sync_rev FROM items WHERE brand_id = ? ORDER BY sync_rev',
      )
        .bind('brand-lama')
        .all<{ id: string; key: string; sync_rev: number }>()
    ).results;
    expect(rows).toHaveLength(130);
    expect(rows.every((row) => row.key.startsWith('baru m '))).toBe(true);
    // revisi 501..630: unik, berurutan, > revisi lama; item merk lain tak tersentuh
    expect(rows.map((row) => row.sync_rev)).toEqual(Array.from({ length: 130 }, (_, i) => 501 + i));
    expect((await itemRow('x1'))?.sync_rev).toBe(500);
    expect(await currentSyncRev(env.DB, 'items')).toBe(630);
    const count = await env.DB.prepare(
      "SELECT item_count AS n FROM brands WHERE id = 'brand-lama'",
    ).first<{ n: number }>();
    expect(count?.n).toBe(130);
  });

  test('ganti nama merk tanpa item: hanya merk dan audit yang ditulis', async () => {
    await seedBrand(env, 'Kosong');
    const saved = await saveBrand(env, { id: 'brand-kosong', name: 'Kosong 2' }, admin);
    expect(saved).toMatchObject({ name: 'Kosong 2', itemCount: 0 });
    expect(await currentSyncRev(env.DB, 'items')).toBe(0);
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

describe('sync_rev', () => {
  test('baru, ganti nama, dan status menaikkan; ganti nama juga menaikkan semua item merk itu saja', async () => {
    const created = await saveBrand(env, { name: 'Ubiquity' }, admin);
    const brandRev = async () => (await brandRow(created.id))?.sync_rev ?? -1;
    expect(await brandRev()).toBe(1);
    // penghitung item dimajukan agar revisi baru pasti lebih besar dari revisi fixture
    await env.DB.prepare("INSERT INTO sync_state (resource, seq) VALUES ('items', 6)").run();
    await seedItem(env, {
      id: 'i1',
      brand: 'Ubiquity',
      model: 'X',
      syncRev: 5,
      brandId: created.id,
    });
    await seedItem(env, { id: 'i2', brand: 'Mikrotik', model: 'Y', syncRev: 6 });
    await saveBrand(env, { id: created.id, name: 'Ubiquiti' }, admin);
    expect(await brandRev()).toBe(2);
    expect((await itemRow('i1'))?.sync_rev).toBe(7);
    expect((await itemRow('i2'))?.sync_rev).toBe(6);
    await setBrandStatus(env, { id: created.id, status: 'inactive' }, admin);
    expect(await brandRev()).toBe(3);
  });

  test('tiap item mendapat revisi sendiri yang unik dan menaik', async () => {
    const id = await seedBrand(env, 'Ubiquity');
    for (const n of [1, 2, 3]) {
      await seedItem(env, { id: `i${n}`, brand: 'Ubiquity', model: `M${n}` });
    }
    await saveBrand(env, { id, name: 'Ubiquiti' }, admin);
    const revs = await env.DB.prepare('SELECT sync_rev FROM items ORDER BY sync_rev').all<{
      sync_rev: number;
    }>();
    expect(revs.results.map((r) => r.sync_rev)).toEqual([1, 2, 3]);
    expect(await currentSyncRev(env.DB, 'items')).toBe(3);
  });

  test('dua perubahan bersamaan menghasilkan revisi berbeda (tanpa nomor ganda)', async () => {
    const a = await seedBrand(env, 'Alfa');
    const b = await seedBrand(env, 'Beta');
    await Promise.all([
      setBrandStatus(env, { id: a, status: 'inactive' }, admin),
      setBrandStatus(env, { id: b, status: 'inactive' }, admin),
    ]);
    const rows = await env.DB.prepare('SELECT sync_rev FROM brands ORDER BY sync_rev').all<{
      sync_rev: number;
    }>();
    expect(rows.results.map((r) => r.sync_rev)).toEqual([1, 2]);
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

test('ganti nama merk dengan 520 item (dua potongan UPDATE): semua kunci berubah, revisi unik berurutan, item merk lain utuh', async () => {
  const id = await seedBrand(env, 'Ubiquity');
  for (let i = 0; i < 520; i++) {
    await seedItem(env, { id: `i${i}`, brand: 'Ubiquity', model: `Model ${i}` });
  }
  await seedItem(env, { id: 'lain', brand: 'Mikrotik', model: 'Z', syncRev: 9 });
  await env.DB.prepare(
    "INSERT INTO sync_state (resource, seq) VALUES ('items', 100) ON CONFLICT (resource) DO UPDATE SET seq = 100",
  ).run();
  await saveBrand(env, { id, name: 'Ubiquiti' }, admin);
  const rows = (
    await env.DB.prepare('SELECT key, sync_rev FROM items WHERE brand_id = ? ORDER BY sync_rev')
      .bind(id)
      .all<{ key: string; sync_rev: number }>()
  ).results;
  expect(rows).toHaveLength(520);
  expect(rows.every((row) => row.key.startsWith('ubiquiti model '))).toBe(true);
  expect(rows.map((row) => row.sync_rev)).toEqual(Array.from({ length: 520 }, (_, i) => 101 + i));
  expect(await currentSyncRev(env.DB, 'items')).toBe(620);
  expect((await itemRow('lain'))?.sync_rev).toBe(9);
});

test('ganti nama merk: bentrok dengan merk+tipe item lain pada item KE-300 membatalkan seluruh batch (tanpa perubahan sebagian)', async () => {
  await seedBrand(env, 'Ab');
  await seedBrand(env, 'A');
  for (let i = 0; i < 300; i++) {
    await seedItem(env, { id: `i${i}`, brand: 'Ab', model: `c d ${i}` });
  }
  await seedItem(env, { id: 'x', brand: 'A', model: 'b c d 299' });
  const revBefore = await currentSyncRev(env.DB, 'items');
  const error = await captureAppErrorAsync(() =>
    saveBrand(env, { id: 'brand-ab', name: 'A b' }, admin),
  );
  expect(error.code).toBe('CONFLICT');
  expect(error.fields?.name).toBe('Nama baru membuat merk dan tipe dua item bentrok');
  expect((await itemRow('i0'))?.key).toBe('ab c d 0');
  expect((await itemRow('i299'))?.key).toBe('ab c d 299');
  expect(await currentSyncRev(env.DB, 'items')).toBe(revBefore);
  expect((await brandRow('brand-ab'))?.name).toBe('Ab');
});

test('CPU kasar: ganti nama merk dengan 200 item di bawah anggaran', async () => {
  const id = await seedBrand(env, 'Ubiquity');
  for (let i = 0; i < 200; i++) {
    await seedItem(env, { id: `i${i}`, brand: 'Ubiquity', model: `Model ${i}` });
  }
  const { ms } = await measureCpu(() => saveBrand(env, { id, name: 'Ubiquiti' }, admin));
  expect(ms).toBeLessThan(50);
});
