import { expect, test } from 'bun:test';
import { captureAppError } from '@gas-test/errors';
import { validateGetItem_, validateSaveItem_, validateSetItemStatus_ } from './validate';

const base = {
  brand: ' Ubiquiti ',
  model: ' ES 24 250W ',
  isCountryLock: false,
  aliases: [],
  stickers: [],
  accessories: [],
  attachments: [],
  detail: '',
};

const fieldsOf = (override: Record<string, unknown>) =>
  captureAppError(() => validateSaveItem_({ ...base, ...override })).fields;

test('menormalisasi dan mengembalikan input yang sah', () => {
  expect(
    validateSaveItem_({
      ...base,
      id: 'i1',
      isCountryLock: true,
      aliases: [' ES24 ', 'Es24', '', 'AirFiber'],
      stickers: [{ name: ' Label SNI ', note: ' Belakang ', fileId: ' f1 ' }, { name: 'Garansi' }],
      accessories: [{ name: ' Kabel ', qty: 2 }],
      attachments: [' a ', 'a', 'b'],
      detail: 'baris1\r\nbaris2',
    }),
  ).toEqual({
    id: 'i1',
    brand: 'Ubiquiti',
    model: 'ES 24 250W',
    isCountryLock: true,
    aliases: ['ES24', 'AirFiber'],
    stickers: [
      { name: 'Label SNI', note: 'Belakang', fileId: 'f1' },
      { name: 'Garansi', note: '', fileId: null },
    ],
    accessories: [{ name: 'Kabel', qty: 2 }],
    attachments: ['a', 'b'],
    detail: 'baris1\nbaris2',
  });
});

test('tanpa id menghasilkan objek tanpa properti id', () => {
  expect('id' in validateSaveItem_(base)).toBe(false);
});

test('merk dan tipe wajib serta dibatasi panjangnya', () => {
  expect(fieldsOf({ brand: '', model: '' })).toMatchObject({
    brand: 'Wajib diisi',
    model: 'Wajib diisi',
  });
  expect(fieldsOf({ brand: 'x'.repeat(61) })?.brand).toBe('Maksimal 60 karakter');
  expect(fieldsOf({ model: 'x'.repeat(101) })?.model).toBe('Maksimal 100 karakter');
});

test('isCountryLock harus boolean sungguhan', () => {
  for (const bad of ['true', 1, null, undefined]) {
    expect(fieldsOf({ isCountryLock: bad })?.isCountryLock).toBe('Harus true atau false');
  }
});

test('nama lain: daftar teks, kosong dibuang, kembar (ternormalisasi) dibuang, batas jumlah dan panjang', () => {
  expect(fieldsOf({ aliases: 'x' })?.aliases).toBe('Harus berupa daftar teks');
  expect(fieldsOf({ aliases: [1] })?.aliases).toBe('Harus berupa daftar teks');
  expect(fieldsOf({ aliases: ['--'] })?.aliases).toBe('Nama lain harus memuat huruf atau angka');
  expect(fieldsOf({ aliases: ['x'.repeat(101)] })?.aliases).toBe(
    'Maksimal 100 karakter per nama lain',
  );
  const eleven = Array.from({ length: 11 }, (_, i) => `alias ${i}`);
  expect(fieldsOf({ aliases: eleven })?.aliases).toBe('Maksimal 10 nama lain');
});

test('stiker: nama wajib, catatan dan berkas dibatasi, pesan menyebut nomor stiker', () => {
  expect(fieldsOf({ stickers: 'x' })?.stickers).toBe('Harus berupa daftar stiker');
  expect(fieldsOf({ stickers: ['x'] })?.stickers).toBe('Stiker 1: tidak valid');
  expect(fieldsOf({ stickers: [{ name: '' }] })?.stickers).toBe('Stiker 1: nama wajib diisi');
  expect(fieldsOf({ stickers: [{ name: 'ok' }, { name: 'x'.repeat(101) }] })?.stickers).toBe(
    'Stiker 2: nama maksimal 100 karakter',
  );
  expect(fieldsOf({ stickers: [{ name: 'a', note: 'x'.repeat(301) }] })?.stickers).toBe(
    'Stiker 1: catatan maksimal 300 karakter',
  );
  expect(fieldsOf({ stickers: [{ name: 'a', note: 5 }] })?.stickers).toBe(
    'Stiker 1: catatan harus berupa teks',
  );
  expect(fieldsOf({ stickers: [{ name: 'a', fileId: 5 }] })?.stickers).toBe(
    'Stiker 1: berkas tidak valid',
  );
  const many = Array.from({ length: 31 }, (_, i) => ({ name: `s${i}` }));
  expect(fieldsOf({ stickers: many })?.stickers).toBe('Maksimal 30 stiker');
});

test('kelengkapan: nama wajib dan jumlah bilangan bulat 1–999', () => {
  expect(fieldsOf({ accessories: 'x' })?.accessories).toBe('Harus berupa daftar kelengkapan');
  expect(fieldsOf({ accessories: [{ name: '', qty: 1 }] })?.accessories).toBe(
    'Kelengkapan 1: nama wajib diisi',
  );
  for (const bad of [0, -1, 1000, 1.5, Number.NaN, '2', null, undefined]) {
    expect(fieldsOf({ accessories: [{ name: 'Kabel', qty: bad }] })?.accessories).toBe(
      'Kelengkapan 1: jumlah harus bilangan bulat 1–999',
    );
  }
  const many = Array.from({ length: 31 }, (_, i) => ({ name: `k${i}`, qty: 1 }));
  expect(fieldsOf({ accessories: many })?.accessories).toBe('Maksimal 30 kelengkapan');
});

test('lampiran: daftar teks, kembar dibuang, maksimal 10', () => {
  expect(fieldsOf({ attachments: 'x' })?.attachments).toBe('Harus berupa daftar berkas');
  expect(fieldsOf({ attachments: [''] })?.attachments).toBe('Harus berupa daftar berkas');
  const eleven = Array.from({ length: 11 }, (_, i) => `f${i}`);
  expect(fieldsOf({ attachments: eleven })?.attachments).toBe('Maksimal 10 gambar');
});

test('detail Markdown: teks, maksimal 20.000 karakter setelah normalisasi baris baru', () => {
  expect(fieldsOf({ detail: 5 })?.detail).toBe('Harus berupa teks');
  expect(fieldsOf({ detail: 'x'.repeat(20_001) })?.detail).toBe('Maksimal 20000 karakter');
  expect(validateSaveItem_({ ...base, detail: 'x'.repeat(20_000) }).detail).toHaveLength(20_000);
  const crlf = '\r\n'.repeat(10_000);
  expect(validateSaveItem_({ ...base, detail: crlf }).detail).toHaveLength(10_000);
  expect(validateSaveItem_({ ...base, detail: undefined }).detail).toBe('');
});

test('input bukan objek ditolak', () => {
  expect(captureAppError(() => validateSaveItem_('x')).fields?._).toBe('Input harus berupa objek');
});

test('validateGetItem_ dan validateSetItemStatus_', () => {
  expect(validateGetItem_({ id: 'i1' })).toEqual({ id: 'i1' });
  expect(captureAppError(() => validateGetItem_({ id: '' })).fields).toEqual({ id: 'Wajib diisi' });
  expect(validateSetItemStatus_({ id: 'i1', status: 'inactive' })).toEqual({
    id: 'i1',
    status: 'inactive',
  });
  expect(captureAppError(() => validateSetItemStatus_({ id: '', status: 'x' })).fields).toEqual({
    id: 'Wajib diisi',
    status: 'Nilai tidak valid',
  });
});

test('JSON per kolom melebihi 40.000 karakter ditolak (karakter kontrol membengkak saat di-JSON)', () => {
  const note = String.fromCharCode(1).repeat(300);
  const stickers = Array.from({ length: 30 }, (_, i) => ({ name: `s${i}`, note }));
  expect(fieldsOf({ stickers })?.stickers).toBe('Data stiker terlalu besar');
});

test('merk wajib memuat huruf atau angka', () => {
  expect(fieldsOf({ brand: '!!!' })?.brand).toBe('Merk harus memuat huruf atau angka');
});

test('tipe wajib memuat huruf atau angka (kunci tidak boleh kosong)', () => {
  expect(fieldsOf({ model: '--' })?.model).toBe('Tipe harus memuat huruf atau angka');
  expect(validateSaveItem_({ ...base, brand: '小米', model: '手机' }).model).toBe('手机');
});
