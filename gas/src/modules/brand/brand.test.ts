import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import type { UserContext } from '@gas/modules/access/context';
import { loadUserContext_ } from '@gas/modules/access/context';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { insertItem_, listItems_ } from '@gas/modules/item/repo';
import { getRoutes_ } from '@gas/routes';
import { captureAppError } from '@gas-test/errors';
import { brand, item } from '@gas-test/item-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { insertBrand_, listBrands_ } from './repo';
import { listBrandDtos_, saveBrand_, setBrandStatus_ } from './service';
import { validateSaveBrand_, validateSetBrandStatus_ } from './validate';

let admin: UserContext;

beforeEach(() => {
  setPlatform_(
    createMemoryPlatform({
      properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
      now: () => Date.parse('2026-10-09T00:00:00.000Z'),
    }),
  );
  const ctx = loadUserContext_('admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

const lastAudit = () => {
  const record = listAuditRecords_().at(-1);
  if (!record) throw new Error('audit kosong');
  return record;
};

test('membuat merk: nama dirapikan, aktif, kolom sinkron kosong, audit brand.create', () => {
  const saved = saveBrand_({ name: 'Ubiquiti' }, admin);
  expect(saved).toMatchObject({ name: 'Ubiquiti', status: 'active', externalId: '', itemCount: 0 });
  expect(listBrands_()[0]).toMatchObject({ key: 'ubiquiti', syncRev: 0 });
  expect(lastAudit()).toMatchObject({
    action: 'brand.create',
    target: 'Ubiquiti',
    before: null,
    after: { name: 'Ubiquiti', status: 'active' },
  });
});

test('nama merk kembar (ternormalisasi) ditolak dengan pesan di field name', () => {
  saveBrand_({ name: 'Ubiquiti' }, admin);
  for (const dup of ['ubiquiti', ' UBIQUITI ', 'Ubi-quiti'.replace('-', '')]) {
    expect(captureAppError(() => saveBrand_({ name: dup }, admin)).fields).toEqual({
      name: 'Nama merk sudah dipakai',
    });
  }
  expect(listBrands_()).toHaveLength(1);
});

test('mengganti nama merk: kunci semua item merk itu ikut dihitung ulang, audit brand.update, item merk lain tak berubah', () => {
  insertBrand_(brand('Ubiquity'));
  insertBrand_(brand('Mikrotik'));
  insertItem_(item({ id: 'i1', brand: 'Ubiquity', model: 'ES 24' }));
  insertItem_(item({ id: 'i2', brand: 'Mikrotik', model: 'hAP' }));
  const saved = saveBrand_({ id: 'brand-ubiquity', name: 'Ubiquiti' }, admin);
  expect(saved).toMatchObject({ name: 'Ubiquiti', itemCount: 1 });
  const items = listItems_();
  expect(items.find((i) => i.id === 'i1')?.key).toBe('ubiquiti es 24');
  expect(items.find((i) => i.id === 'i2')?.key).toBe('mikrotik hap');
  expect(lastAudit()).toMatchObject({
    action: 'brand.update',
    before: { name: 'Ubiquity' },
    after: { name: 'Ubiquiti' },
  });
});

test('ganti nama ke nama merk lain ditolak; ganti kapitalisasi milik sendiri diizinkan; id tak dikenal NOT_FOUND', () => {
  insertBrand_(brand('A'));
  insertBrand_(brand('B'));
  expect(captureAppError(() => saveBrand_({ id: 'brand-a', name: 'b' }, admin)).fields).toEqual({
    name: 'Nama merk sudah dipakai',
  });
  expect(saveBrand_({ id: 'brand-a', name: 'a' }, admin).name).toBe('a');
  expect(captureAppError(() => saveBrand_({ id: 'x', name: 'Z' }, admin)).code).toBe('NOT_FOUND');
});

test('ganti nama yang membuat kunci merk+tipe dua item bentrok ditolak tanpa mengubah apa pun', () => {
  insertBrand_(brand('Ab'));
  insertBrand_(brand('A'));
  insertItem_(item({ id: 'i1', brand: 'Ab', model: 'c d' }));
  insertItem_(item({ id: 'i2', brand: 'A', model: 'b c d' }));
  const error = captureAppError(() => saveBrand_({ id: 'brand-ab', name: 'A b' }, admin));
  expect(error.code).toBe('CONFLICT');
  expect(error.fields?.name).toBe('Nama baru membuat merk dan tipe dua item bentrok');
  expect(listBrands_().find((x) => x.id === 'brand-ab')?.name).toBe('Ab');
  expect(listItems_().find((x) => x.id === 'i1')?.key).toBe('ab c d');
});

test('daftar merk: urut nama, memuat jumlah item (aktif dan nonaktif)', () => {
  insertBrand_(brand('Zebra'));
  insertBrand_(brand('Alfa'));
  insertItem_(item({ id: 'i1', brand: 'Alfa', model: 'x' }));
  insertItem_(item({ id: 'i2', brand: 'Alfa', model: 'y', status: 'inactive' }));
  expect(listBrandDtos_().map((b) => [b.name, b.itemCount])).toEqual([
    ['Alfa', 2],
    ['Zebra', 0],
  ]);
});

test('menonaktifkan dan mengaktifkan merk dicatat di audit; status sama tidak menulis audit', () => {
  insertBrand_(brand('Alfa'));
  setBrandStatus_({ id: 'brand-alfa', status: 'inactive' }, admin);
  expect(lastAudit().action).toBe('brand.deactivate');
  const before = listAuditRecords_().length;
  setBrandStatus_({ id: 'brand-alfa', status: 'inactive' }, admin);
  expect(listAuditRecords_()).toHaveLength(before);
  setBrandStatus_({ id: 'brand-alfa', status: 'active' }, admin);
  expect(lastAudit().action).toBe('brand.activate');
  expect(captureAppError(() => setBrandStatus_({ id: 'x', status: 'active' }, admin)).code).toBe(
    'NOT_FOUND',
  );
});

test('validator', () => {
  expect(validateSaveBrand_({ name: '  Ubiquiti ' })).toEqual({ name: 'Ubiquiti' });
  expect(validateSaveBrand_({ id: 'b1', name: 'X' })).toEqual({ id: 'b1', name: 'X' });
  expect(captureAppError(() => validateSaveBrand_({ name: '' })).fields).toEqual({
    name: 'Wajib diisi',
  });
  expect(captureAppError(() => validateSaveBrand_({ name: 'x'.repeat(61) })).fields).toEqual({
    name: 'Maksimal 60 karakter',
  });
  expect(captureAppError(() => validateSaveBrand_({ name: '--' })).fields).toEqual({
    name: 'Nama merk harus memuat huruf atau angka',
  });
  expect(validateSetBrandStatus_({ id: 'b', status: 'active' })).toEqual({
    id: 'b',
    status: 'active',
  });
  expect(captureAppError(() => validateSetBrandStatus_({ id: '', status: 'x' })).fields).toEqual({
    id: 'Wajib diisi',
    status: 'Nilai tidak valid',
  });
});

test('izin rute merk: list view, save edit, setStatus manage (modul item)', () => {
  const routes = getRoutes_();
  expect(routes['brands.list'].permission).toEqual({ module: 'item', level: 'view' });
  expect(routes['brands.save'].permission).toEqual({ module: 'item', level: 'edit' });
  expect(routes['brands.setStatus'].permission).toEqual({ module: 'item', level: 'manage' });
});

test('ganti nama merk yang membuat kunci item sama dengan nama lain item lain atau item sendiri ditolak', () => {
  insertBrand_(brand('Ubiquity'));
  insertBrand_(brand('Mikrotik'));
  insertItem_(item({ id: 'i1', brand: 'Ubiquity', model: 'ES 24' }));
  insertItem_(item({ id: 'i2', brand: 'Mikrotik', model: 'X', aliases: ['Ubiquiti ES 24'] }));
  const other = captureAppError(() =>
    saveBrand_({ id: 'brand-ubiquity', name: 'Ubiquiti' }, admin),
  );
  expect(other.code).toBe('CONFLICT');
  expect(other.fields?.name).toBe('Nama baru bentrok dengan nama lain item');

  insertItem_(item({ id: 'i3', brand: 'Ubiquity', model: 'AF', aliases: ['Ubiquiti AF'] }));
  // i2 dibersihkan agar hanya kasus alias milik sendiri yang diuji
  expect(
    captureAppError(() => saveBrand_({ id: 'brand-ubiquity', name: 'Ubiquiti' }, admin)).code,
  ).toBe('CONFLICT');
  expect(listBrands_().find((x) => x.id === 'brand-ubiquity')?.name).toBe('Ubiquity');
});

test('ganti nama ke nama yang persis sama tidak menulis audit', () => {
  insertBrand_(brand('Alfa'));
  const before = listAuditRecords_().length;
  expect(saveBrand_({ id: 'brand-alfa', name: 'Alfa' }, admin).name).toBe('Alfa');
  expect(listAuditRecords_()).toHaveLength(before);
});
