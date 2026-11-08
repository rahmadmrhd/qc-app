import type { ItemDto } from '@shared/contract';
import { expect, test } from 'vitest';
import { itemFormSchema, parseAliasLines, toItemFormDefaults, toSaveItemInput } from './schemas';

const valid = {
  brandId: 'b1',
  businessUnitIds: ['bu-a'],
  model: 'ES 24 250W',
  isCountryLock: false,
  aliasesText: '',
  stickers: [],
  accessories: [],
  attachments: [],
  detail: '',
};

const messages = (override: Record<string, unknown>) => {
  const result = itemFormSchema.safeParse({ ...valid, ...override });
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

test('parseAliasLines: satu per baris, dirapikan, kosong dan kembar (ternormalisasi) dibuang', () => {
  expect(parseAliasLines(' ES24 \n\n  es24 \nAirFiber\nair-fiber')).toEqual([
    'ES24',
    'AirFiber',
    'air-fiber',
  ]);
  expect(parseAliasLines('')).toEqual([]);
});

test('input sah lolos', () => {
  expect(messages({})).toEqual([]);
});

test('merk dan BU wajib; tipe wajib dan dibatasi', () => {
  expect(messages({ brandId: '', businessUnitIds: [], model: '' })).toEqual([
    'Pilih merk',
    'Pilih minimal satu BU',
    'Wajib diisi',
  ]);
  expect(messages({ model: 'x'.repeat(101) })).toEqual(['Maksimal 100 karakter']);
});

test('nama lain: panjang, harus memuat huruf/angka, maksimal 10', () => {
  expect(messages({ aliasesText: 'x'.repeat(101) })).toEqual([
    'Maksimal 100 karakter per nama lain',
  ]);
  expect(messages({ aliasesText: '--' })).toEqual(['Nama lain harus memuat huruf atau angka']);
  const eleven = Array.from({ length: 11 }, (_, i) => `alias ${i}`).join('\n');
  expect(messages({ aliasesText: eleven })).toEqual(['Maksimal 10 nama lain']);
});

test('stiker: pesan bernomor per baris', () => {
  expect(messages({ stickers: [{ name: ' ', note: '', fileId: null }] })).toEqual([
    'Stiker 1: nama wajib diisi',
  ]);
  expect(
    messages({
      stickers: [
        { name: 'ok', note: '', fileId: null },
        { name: 'b', note: 'x'.repeat(301), fileId: null },
      ],
    }),
  ).toEqual(['Stiker 2: catatan maksimal 300 karakter']);
});

test('kelengkapan: nama wajib, jumlah bilangan bulat 1–999', () => {
  expect(messages({ accessories: [{ name: '', qty: 1 }] })).toEqual([
    'Kelengkapan 1: nama wajib diisi',
  ]);
  for (const qty of [0, -1, 1000, 1.5]) {
    expect(messages({ accessories: [{ name: 'Kabel', qty }] })).toEqual([
      'Kelengkapan 1: jumlah harus bilangan bulat 1–999',
    ]);
  }
});

test('lampiran maksimal 10 dan detail maksimal 20000 karakter', () => {
  const eleven = Array.from({ length: 11 }, (_, i) => `f${i}`);
  expect(messages({ attachments: eleven })).toEqual(['Maksimal 10 gambar']);
  expect(messages({ detail: 'x'.repeat(20_001) })).toEqual(['Maksimal 20000 karakter']);
});

test('toSaveItemInput merapikan teks dan mengubah nama lain menjadi daftar; id hanya bila ada', () => {
  const input = toSaveItemInput(
    {
      ...valid,
      brandId: 'b1',
      businessUnitIds: ['bu-a'],
      model: ' ES 24 ',
      aliasesText: ' ES24 \n AirFiber ',
      stickers: [{ name: ' Label ', note: ' Belakang ', fileId: 'f1' }],
      accessories: [{ name: ' Kabel ', qty: 2 }],
      attachments: ['a'],
      detail: 'isi',
    },
    'i1',
  );
  expect(input).toEqual({
    id: 'i1',
    brandId: 'b1',
    businessUnitIds: ['bu-a'],
    model: 'ES 24',
    isCountryLock: false,
    aliases: ['ES24', 'AirFiber'],
    stickers: [{ name: 'Label', note: 'Belakang', fileId: 'f1' }],
    accessories: [{ name: 'Kabel', qty: 2 }],
    attachments: ['a'],
    detail: 'isi',
  });
  expect('id' in toSaveItemInput(valid)).toBe(false);
});

test('toItemFormDefaults: kosong tanpa item; dari item menggabungkan nama lain per baris', () => {
  expect(toItemFormDefaults()).toEqual({
    brandId: '',
    businessUnitIds: [],
    model: '',
    isCountryLock: false,
    aliasesText: '',
    stickers: [],
    accessories: [],
    attachments: [],
    detail: '',
  });
  const item: ItemDto = {
    id: 'i1',
    brandId: 'b1',
    brand: 'Ubiquiti',
    model: 'ES 24',
    isCountryLock: true,
    status: 'active',
    aliases: ['ES24', 'AirFiber'],
    imageCount: 1,
    businessUnits: [
      { id: 'bu-a', code: 'RTL', name: 'Retail' },
      { id: 'bu-b', code: 'WHL', name: 'Wholesale' },
    ],
    updatedAt: '',
    stickers: [{ name: 'Label', note: '', fileId: null }],
    accessories: [{ name: 'Kabel', qty: 1 }],
    attachments: ['a'],
    detail: '# isi',
    createdAt: '',
    updatedBy: '',
  };
  expect(toItemFormDefaults(item)).toMatchObject({
    brandId: 'b1',
    isCountryLock: true,
    aliasesText: 'ES24\nAirFiber',
    stickers: [{ name: 'Label', note: '', fileId: null }],
    attachments: ['a'],
    detail: '# isi',
  });
});

test('tipe hanya tanda baca ditolak skema form', () => {
  const result = itemFormSchema.safeParse({
    ...toItemFormDefaults(),
    brandId: 'b1',
    businessUnitIds: ['bu-a'],
    model: '--',
  });
  expect(result.success).toBe(false);
});

test('toSaveItemInput menyertakan expectedUpdatedAt hanya untuk ubah', () => {
  const parsed = itemFormSchema.parse({
    brandId: 'b1',
    businessUnitIds: ['bu-a'],
    model: 'ES',
    isCountryLock: false,
    aliasesText: '',
    stickers: [],
    accessories: [],
    attachments: [],
    detail: '',
  });
  expect(toSaveItemInput(parsed, 'i1', '2026-10-15T00:00:00.000Z')).toMatchObject({
    id: 'i1',
    expectedUpdatedAt: '2026-10-15T00:00:00.000Z',
  });
  expect('expectedUpdatedAt' in toSaveItemInput(parsed)).toBe(false);
});

test('toItemFormDefaults memuat id merk dan id BU item', () => {
  const item = {
    id: 'i1',
    brandId: 'b1',
    brand: 'Ubiquiti',
    model: 'ES 24',
    isCountryLock: false,
    status: 'active',
    aliases: [],
    imageCount: 0,
    businessUnits: [
      { id: 'bu-a', code: 'RTL', name: 'Retail' },
      { id: 'bu-b', code: 'WHL', name: 'Wholesale' },
    ],
    updatedAt: '',
    stickers: [],
    accessories: [],
    attachments: [],
    detail: '',
    createdAt: '',
    updatedBy: '',
  } satisfies ItemDto;
  const defaults = toItemFormDefaults(item);
  expect(defaults.brandId).toBe('b1');
  expect(defaults.businessUnitIds).toEqual(['bu-a', 'bu-b']);
});
