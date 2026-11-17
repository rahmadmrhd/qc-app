import type { ItemDto } from '@shared/contract';
import { expect, test } from 'vitest';
import { itemFormSchema, parseAliasLines, toItemFormDefaults, toSaveItemInput } from './schemas';

const valid = {
  brandId: 'b1',
  businessUnitIds: ['bu-a'],
  model: 'ES 24 250W',
  isCountryLock: false,
  firmware: '',
  aliasesText: '',
  stickerPhotos: [],
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

const mark = (patch: Record<string, unknown> = {}) => ({
  x: 100,
  y: 200,
  target: { kind: 'sticker', stickerId: 's1' },
  note: '',
  ...patch,
});
const photo = (patch: Record<string, unknown> = {}) => ({
  guideId: 'g1',
  caption: '',
  buId: null,
  marks: [mark()],
  ...patch,
});

test('instruksi stiker: foto dan penanda sah lolos; daftar kosong lolos', () => {
  expect(messages({ stickerPhotos: [] })).toEqual([]);
  expect(
    messages({
      stickerPhotos: [
        photo({ buId: 'bu-a', caption: 'Bagian belakang' }),
        photo({
          guideId: 'g2',
          marks: [mark({ target: { kind: 'type', typeId: 't1' }, note: 'Pojok kiri' })],
        }),
      ],
    }),
  ).toEqual([]);
});

test('instruksi stiker: maksimal 10 foto dan 30 penanda per foto', () => {
  const eleven = Array.from({ length: 11 }, (_, i) => photo({ guideId: `g${i}` }));
  expect(messages({ stickerPhotos: eleven })).toEqual(['Maksimal 10 foto instruksi']);
  const marks = Array.from({ length: 31 }, () => mark());
  expect(messages({ stickerPhotos: [photo({ marks })] })).toEqual(['Foto 1: maksimal 30 penanda']);
});

test('instruksi stiker: foto kembar dalam satu item ditolak', () => {
  expect(
    messages({ stickerPhotos: [photo(), photo({ guideId: 'g2' }), photo({ guideId: 'g1' })] }),
  ).toEqual(['Foto 3: gambar sudah dipakai di foto lain']);
});

test('instruksi stiker: gambar wajib dipilih', () => {
  expect(messages({ stickerPhotos: [photo({ guideId: '' })] })).toEqual(['Foto 1: pilih gambar']);
});

test('instruksi stiker: batas catatan foto 200 dan catatan penanda 120 karakter', () => {
  expect(messages({ stickerPhotos: [photo({ caption: 'x'.repeat(200) })] })).toEqual([]);
  expect(messages({ stickerPhotos: [photo({ caption: 'x'.repeat(201) })] })).toEqual([
    'Foto 1: catatan maksimal 200 karakter',
  ]);
  expect(
    messages({ stickerPhotos: [photo({ marks: [mark({ note: 'x'.repeat(120) })] })] }),
  ).toEqual([]);
  expect(
    messages({ stickerPhotos: [photo({ marks: [mark({ note: 'x'.repeat(121) })] })] }),
  ).toEqual(['Foto 1, penanda 1: catatan maksimal 120 karakter']);
});

test('instruksi stiker: sasaran penanda wajib terisi (stiker atau jenis)', () => {
  expect(
    messages({
      stickerPhotos: [
        photo({ marks: [mark(), mark({ target: { kind: 'sticker', stickerId: '' } })] }),
      ],
    }),
  ).toEqual(['Foto 1, penanda 2: pilih stiker atau jenis']);
  expect(
    messages({
      stickerPhotos: [photo({ marks: [mark({ target: { kind: 'type', typeId: '' } })] })],
    }),
  ).toEqual(['Foto 1, penanda 1: pilih stiker atau jenis']);
});

test('instruksi stiker: koordinat harus bilangan bulat 0-1000', () => {
  for (const patch of [{ x: -1 }, { x: 1001 }, { y: 0.5 }]) {
    expect(messages({ stickerPhotos: [photo({ marks: [mark(patch)] })] })).toEqual([
      'Foto 1, penanda 1: posisi harus bilangan bulat 0–1000',
    ]);
  }
  expect(messages({ stickerPhotos: [photo({ marks: [mark({ x: 0, y: 1000 })] })] })).toEqual([]);
});

test('instruksi stiker: label BU foto harus salah satu BU item', () => {
  expect(messages({ stickerPhotos: [photo({ buId: 'bu-a' })] })).toEqual([]);
  expect(messages({ stickerPhotos: [photo({ buId: 'bu-x' })] })).toEqual([
    'Foto 1: label BU harus salah satu BU item',
  ]);
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
      stickerPhotos: [
        photo({
          caption: ' Bagian belakang ',
          buId: 'bu-a',
          marks: [
            mark({ note: ' Pojok ' }),
            mark({ x: 5, y: 6, target: { kind: 'type', typeId: 't9' } }),
          ],
        }),
      ],
      accessories: [{ name: ' Kabel ', qty: 2 }],
      attachments: ['a'],
      detail: 'isi',
    } as never,
    'i1',
  );
  expect(input).toEqual({
    id: 'i1',
    brandId: 'b1',
    businessUnitIds: ['bu-a'],
    model: 'ES 24',
    isCountryLock: false,
    firmware: '',
    aliases: ['ES24', 'AirFiber'],
    stickerPhotos: [
      {
        guideId: 'g1',
        caption: 'Bagian belakang',
        buId: 'bu-a',
        marks: [
          { x: 100, y: 200, target: { kind: 'sticker', stickerId: 's1' }, note: 'Pojok' },
          { x: 5, y: 6, target: { kind: 'type', typeId: 't9' }, note: '' },
        ],
      },
    ],
    accessories: [{ name: 'Kabel', qty: 2 }],
    attachments: ['a'],
    detail: 'isi',
  });
  expect('id' in toSaveItemInput(valid)).toBe(false);
});

const baseItem = {
  id: 'i1',
  brandId: 'b1',
  brand: 'Ubiquiti',
  model: 'ES 24',
  isCountryLock: true,
  firmware: '',
  status: 'active',
  aliases: ['ES24', 'AirFiber'],
  imageCount: 1,
  hasInstructions: true,
  hasManualBook: false,
  hasPostel: false,
  manualBook: null,
  postel: null,
  businessUnits: [
    { id: 'bu-a', code: 'RTL', name: 'Retail' },
    { id: 'bu-b', code: 'WHL', name: 'Wholesale' },
  ],
  updatedAt: '',
  stickerPhotos: [
    {
      guideId: 'g1',
      guideName: 'Belakang',
      width: 800,
      height: 600,
      caption: 'Bagian belakang',
      buId: 'bu-a',
      marks: [
        {
          x: 100,
          y: 200,
          target: { kind: 'sticker', stickerId: 's1' },
          note: 'Pojok',
          targetName: 'Stiker Postel',
          resolved: [],
          unresolved: false,
        },
      ],
    },
  ],
  accessories: [{ name: 'Kabel', qty: 1 }],
  attachments: ['a'],
  detail: '# isi',
  createdAt: '',
  updatedBy: '',
} satisfies ItemDto;

test('toItemFormDefaults: kosong tanpa item; dari item menggabungkan nama lain per baris', () => {
  expect(toItemFormDefaults()).toEqual({
    brandId: '',
    businessUnitIds: [],
    model: '',
    isCountryLock: false,
    firmware: '',
    aliasesText: '',
    stickerPhotos: [],
    accessories: [],
    attachments: [],
    detail: '',
  });
  expect(toItemFormDefaults(baseItem)).toMatchObject({
    brandId: 'b1',
    isCountryLock: true,
    firmware: '',
    aliasesText: 'ES24\nAirFiber',
    stickerPhotos: [
      {
        guideId: 'g1',
        caption: 'Bagian belakang',
        buId: 'bu-a',
        marks: [{ x: 100, y: 200, target: { kind: 'sticker', stickerId: 's1' }, note: 'Pojok' }],
      },
    ],
    attachments: ['a'],
    detail: '# isi',
  });
});

test('toItemFormDefaults: hanya field form (tanpa nama gambar, dimensi, atau hasil penerjemahan)', () => {
  const photoDefaults = toItemFormDefaults(baseItem).stickerPhotos[0];
  expect(Object.keys(photoDefaults ?? {}).sort()).toEqual(['buId', 'caption', 'guideId', 'marks']);
  expect(Object.keys(photoDefaults?.marks[0] ?? {}).sort()).toEqual(['note', 'target', 'x', 'y']);
});

test('toItemFormDefaults: salinan dalam, mengubah form tidak mengubah item', () => {
  const defaults = toItemFormDefaults(baseItem);
  const formMark = defaults.stickerPhotos[0]?.marks[0];
  const sourceMark = baseItem.stickerPhotos[0]?.marks[0];
  expect(formMark?.target).not.toBe(sourceMark?.target);
  if (formMark) formMark.x = 999;
  expect(sourceMark?.x).toBe(100);
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
    firmware: '',
    aliasesText: '',
    stickerPhotos: [],
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
  const defaults = toItemFormDefaults({ ...baseItem, isCountryLock: false, stickerPhotos: [] });
  expect(defaults.brandId).toBe('b1');
  expect(defaults.businessUnitIds).toEqual(['bu-a', 'bu-b']);
});
