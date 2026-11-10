import { expect, test } from 'bun:test';
import { captureAppError } from '@server-test/errors';
import {
  validateGetItem,
  validateListItems,
  validateSaveItem,
  validateSetItemStatus,
} from './validate';

const base = {
  brandId: ' brand-ubiquiti ',
  businessUnitIds: ['bu-a'],
  model: ' ES 24 250W ',
  isCountryLock: false,
  aliases: [],
  stickerPhotos: [],
  accessories: [],
  attachments: [],
  detail: '',
};

const fieldsOf = (override: Record<string, unknown>) =>
  captureAppError(() => validateSaveItem({ ...base, ...override })).fields;

test('menormalisasi dan mengembalikan input yang sah', () => {
  expect(
    validateSaveItem({
      ...base,
      id: 'i1',
      isCountryLock: true,
      aliases: [' ES24 ', 'Es24', '', 'AirFiber'],
      stickerPhotos: [
        {
          guideId: ' g1 ',
          caption: ' Sisi depan ',
          buId: ' bu-a ',
          marks: [
            { x: 10, y: 20, target: { kind: 'sticker', stickerId: ' s1 ' }, note: ' kiri ' },
            { x: 0, y: 1000, target: { kind: 'type', typeId: 't1' } },
          ],
        },
        { guideId: 'g2', buId: '', marks: [] },
      ],
      accessories: [{ name: ' Kabel ', qty: 2 }],
      attachments: [' a ', 'a', 'b'],
      detail: 'baris1\r\nbaris2',
    }),
  ).toEqual({
    id: 'i1',
    brandId: 'brand-ubiquiti',
    businessUnitIds: ['bu-a'],
    model: 'ES 24 250W',
    isCountryLock: true,
    aliases: ['ES24', 'AirFiber'],
    stickerPhotos: [
      {
        guideId: 'g1',
        caption: 'Sisi depan',
        buId: 'bu-a',
        marks: [
          { x: 10, y: 20, target: { kind: 'sticker', stickerId: 's1' }, note: 'kiri' },
          { x: 0, y: 1000, target: { kind: 'type', typeId: 't1' }, note: '' },
        ],
      },
      { guideId: 'g2', caption: '', buId: null, marks: [] },
    ],
    accessories: [{ name: 'Kabel', qty: 2 }],
    attachments: ['a', 'b'],
    detail: 'baris1\nbaris2',
  });
});

test('tanpa id menghasilkan objek tanpa properti id', () => {
  expect('id' in validateSaveItem(base)).toBe(false);
});

test('merk (brandId) dan tipe wajib serta dibatasi panjangnya', () => {
  expect(fieldsOf({ brandId: '', model: '' })).toMatchObject({
    brandId: 'Wajib diisi',
    model: 'Wajib diisi',
  });
  expect(fieldsOf({ brandId: 'x'.repeat(101) })?.brandId).toBe('Maksimal 100 karakter');
  expect(fieldsOf({ model: 'x'.repeat(101) })?.model).toBe('Maksimal 100 karakter');
});

test('businessUnitIds: wajib minimal satu, tanpa kembar, id tak kosong, maksimal 50', () => {
  expect(validateSaveItem({ ...base, businessUnitIds: [' a ', 'a', 'b'] }).businessUnitIds).toEqual(
    ['a', 'b'],
  );
  for (const bad of [[], 'a', null, undefined, [''], [1], ['x'.repeat(101)]]) {
    expect(fieldsOf({ businessUnitIds: bad })?.businessUnitIds).toBeDefined();
  }
  expect(fieldsOf({ businessUnitIds: [] })?.businessUnitIds).toBe('Pilih minimal satu BU');
  expect(
    fieldsOf({ businessUnitIds: Array.from({ length: 51 }, (_, i) => `b${i}`) })?.businessUnitIds,
  ).toBe('Maksimal 50 BU');
  expect('brand' in validateSaveItem(base)).toBe(false);
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

const photo = (override: Record<string, unknown> = {}) => ({
  guideId: 'g1',
  caption: '',
  buId: null,
  marks: [],
  ...override,
});
const mark = (override: Record<string, unknown> = {}) => ({
  x: 1,
  y: 2,
  target: { kind: 'sticker', stickerId: 's1' },
  note: '',
  ...override,
});
const photosError = (stickerPhotos: unknown) => fieldsOf({ stickerPhotos })?.stickerPhotos;

test('instruksi stiker: wajib daftar, maksimal 10 foto, pesan menyebut nomor foto', () => {
  expect(photosError('x')).toBe('Harus berupa daftar foto');
  expect(photosError(undefined)).toBe('Harus berupa daftar foto');
  expect(photosError(Array.from({ length: 11 }, (_, i) => photo({ guideId: `g${i}` })))).toBe(
    'Maksimal 10 foto',
  );
  expect(photosError(['x'])).toBe('Foto 1: tidak valid');
  expect(photosError([photo(), 5])).toBe('Foto 2: tidak valid');
  expect(photosError([photo({ guideId: '' })])).toBe('Foto 1: gambar wajib dipilih');
  expect(photosError([photo({ guideId: 5 })])).toBe('Foto 1: gambar wajib dipilih');
  expect(photosError([photo({ guideId: 'x'.repeat(101) })])).toBe('Foto 1: gambar tidak valid');
});

test('instruksi stiker: foto kembar (guideId sama) ditolak', () => {
  expect(photosError([photo(), photo({ guideId: 'g2' }), photo({ guideId: ' g1 ' })])).toBe(
    'Foto 3: gambar sudah dipakai di foto lain',
  );
});

test('instruksi stiker: catatan foto dan label BU', () => {
  expect(photosError([photo({ caption: 'x'.repeat(201) })])).toBe(
    'Foto 1: catatan maksimal 200 karakter',
  );
  expect(photosError([photo(), photo({ guideId: 'g2', caption: 5 })])).toBe(
    'Foto 2: catatan harus berupa teks',
  );
  expect(photosError([photo({ buId: 5 })])).toBe('Foto 1: label BU tidak valid');
  expect(photosError([photo({ buId: 'x'.repeat(101) })])).toBe('Foto 1: label BU tidak valid');
  const ok = validateSaveItem({
    ...base,
    stickerPhotos: [photo({ caption: '  a  ', buId: '   ' }), photo({ guideId: 'g2', buId: null })],
  });
  expect(ok.stickerPhotos.map((p) => [p.caption, p.buId])).toEqual([
    ['a', null],
    ['', null],
  ]);
  const withoutLabel = { guideId: 'g3', marks: [] };
  expect(validateSaveItem({ ...base, stickerPhotos: [withoutLabel] }).stickerPhotos).toEqual([
    { guideId: 'g3', caption: '', buId: null, marks: [] },
  ]);
});

test('instruksi stiker: penanda (jumlah, posisi, sasaran, catatan), pesan menyebut foto dan penanda', () => {
  expect(photosError([photo({ marks: 'x' })])).toBe('Foto 1: penanda harus berupa daftar');
  expect(photosError([photo({ marks: Array.from({ length: 31 }, () => mark()) })])).toBe(
    'Foto 1: maksimal 30 penanda',
  );
  expect(photosError([photo({ marks: ['x'] })])).toBe('Foto 1, penanda 1: tidak valid');
  for (const bad of [-1, 1001, 1.5, Number.NaN, '5', null, undefined]) {
    expect(photosError([photo({ marks: [mark(), mark({ x: bad })] })])).toBe(
      'Foto 1, penanda 2: posisi harus bilangan bulat 0–1000',
    );
    expect(photosError([photo(), photo({ guideId: 'g2', marks: [mark({ y: bad })] })])).toBe(
      'Foto 2, penanda 1: posisi harus bilangan bulat 0–1000',
    );
  }
  for (const target of [
    undefined,
    null,
    'x',
    {},
    { kind: 'lain', stickerId: 's1' },
    { kind: 'sticker' },
    { kind: 'sticker', stickerId: '' },
    { kind: 'sticker', stickerId: 5 },
    { kind: 'type', typeId: '' },
    { kind: 'type', stickerId: 's1' },
    { kind: 'sticker', stickerId: 'x'.repeat(101) },
  ]) {
    expect(photosError([photo({ marks: [mark({ target })] })])).toBe(
      'Foto 1, penanda 1: sasaran tidak valid',
    );
  }
  for (const target of [
    { kind: 'sticker', stickerId: 's', typeId: 't' },
    { kind: 'type', typeId: 't', stickerId: 's' },
  ]) {
    expect(photosError([photo({ marks: [mark({ target })] })])).toBe(
      'Foto 1, penanda 1: pilih stiker atau jenis, bukan keduanya',
    );
  }
  expect(photosError([photo({ marks: [mark({ note: 'x'.repeat(121) })] })])).toBe(
    'Foto 1, penanda 1: catatan maksimal 120 karakter',
  );
  expect(photosError([photo({ marks: [mark({ note: 5 })] })])).toBe(
    'Foto 1, penanda 1: catatan harus berupa teks',
  );
});

test('instruksi stiker: batas 10 foto dan 30 penanda yang tepat lolos', () => {
  const marks = Array.from({ length: 30 }, (_, i) => mark({ x: i, y: 1000 - i }));
  const photos = Array.from({ length: 10 }, (_, i) => photo({ guideId: `g${i}`, marks }));
  expect(validateSaveItem({ ...base, stickerPhotos: photos }).stickerPhotos).toHaveLength(10);
  const edge = photo({ marks: [mark({ x: 0, y: 1000 })] });
  expect(validateSaveItem({ ...base, stickerPhotos: [edge] }).stickerPhotos).toHaveLength(1);
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
  expect(validateSaveItem({ ...base, detail: 'x'.repeat(20_000) }).detail).toHaveLength(20_000);
  const crlf = '\r\n'.repeat(10_000);
  expect(validateSaveItem({ ...base, detail: crlf }).detail).toHaveLength(10_000);
  expect(validateSaveItem({ ...base, detail: undefined }).detail).toBe('');
});

test('input bukan objek ditolak', () => {
  expect(captureAppError(() => validateSaveItem('x')).fields?._).toBe('Input harus berupa objek');
});

test('validateGetItem dan validateSetItemStatus', () => {
  expect(validateGetItem({ id: 'i1' })).toEqual({ id: 'i1' });
  expect(captureAppError(() => validateGetItem({ id: '' })).fields).toEqual({ id: 'Wajib diisi' });
  expect(validateSetItemStatus({ id: 'i1', status: 'inactive' })).toEqual({
    id: 'i1',
    status: 'inactive',
  });
  expect(captureAppError(() => validateSetItemStatus({ id: '', status: 'x' })).fields).toEqual({
    id: 'Wajib diisi',
    status: 'Nilai tidak valid',
  });
});

test('tipe wajib memuat huruf atau angka (kunci tidak boleh kosong)', () => {
  expect(fieldsOf({ model: '--' })?.model).toBe('Tipe harus memuat huruf atau angka');
  expect(validateSaveItem({ ...base, model: '手机' }).model).toBe('手机');
});

test('galat daftar yang dilaporkan adalah yang PERTAMA, bukan yang terakhir', () => {
  expect(photosError([photo({ guideId: '' }), photo({ guideId: 'x'.repeat(101) })])).toBe(
    'Foto 1: gambar wajib dipilih',
  );
  expect(
    fieldsOf({
      accessories: [
        { name: '', qty: 1 },
        { name: 'ok', qty: 0 },
      ],
    })?.accessories,
  ).toBe('Kelengkapan 1: nama wajib diisi');
  expect(fieldsOf({ aliases: ['--', 'x'.repeat(101)] })?.aliases).toBe(
    'Nama lain harus memuat huruf atau angka',
  );
});

test('validateListItems: bawaan, batas, kursor, kueri, dan status', () => {
  expect(validateListItems(null)).toEqual({ limit: 20 });
  expect(
    validateListItems({ limit: 50, cursor: 'a b', query: ' ES 24 ', status: 'inactive' }),
  ).toEqual({ limit: 50, cursor: 'a b', query: 'ES 24', status: 'inactive' });
  for (const bad of [{ limit: 0 }, { limit: 51 }, { limit: '5' }]) {
    expect(captureAppError(() => validateListItems(bad)).fields?.limit).toBeDefined();
  }
  expect(captureAppError(() => validateListItems({ cursor: '' })).fields?.cursor).toBeDefined();
  expect(captureAppError(() => validateListItems({ status: 'x' })).fields?.status).toBeDefined();
});
