import type { ItemStickerMarkDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { expect, test } from 'vitest';
import {
  clampPermil,
  copyMarks,
  groupInstructionErrors,
  isInactiveTarget,
  markLabel,
  moveEntry,
  pointToPermil,
} from './sticker-instructions';

const rect = { left: 100, top: 50, width: 400, height: 200 };

test('clampPermil: dibulatkan dan dijepit 0-1000; nilai tak hingga/NaN menjadi 0', () => {
  expect(clampPermil(499.6)).toBe(500);
  expect(clampPermil(-12)).toBe(0);
  expect(clampPermil(1400)).toBe(1000);
  expect(clampPermil(Number.NaN)).toBe(0);
  expect(clampPermil(Number.POSITIVE_INFINITY)).toBe(0);
  expect(clampPermil(0)).toBe(0);
  expect(clampPermil(1000)).toBe(1000);
});

test('pointToPermil: titik di dalam kotak dikonversi ke permil bulat', () => {
  expect(pointToPermil({ clientX: 300, clientY: 150 }, rect)).toEqual({ x: 500, y: 500 });
  expect(pointToPermil({ clientX: 101, clientY: 51 }, rect)).toEqual({ x: 3, y: 5 });
});

test('pointToPermil: titik di luar kotak dijepit di tepi', () => {
  expect(pointToPermil({ clientX: 0, clientY: 0 }, rect)).toEqual({ x: 0, y: 0 });
  expect(pointToPermil({ clientX: 9000, clientY: 9000 }, rect)).toEqual({ x: 1000, y: 1000 });
});

test('pointToPermil: kotak tanpa ukuran (belum terukur) tidak menghasilkan NaN', () => {
  expect(
    pointToPermil({ clientX: 10, clientY: 10 }, { left: 0, top: 0, width: 0, height: 0 }),
  ).toEqual({
    x: 0,
    y: 0,
  });
});

test('copyMarks: salinan dalam, tidak berbagi referensi dengan sumber', () => {
  const source: ItemStickerMarkDto[] = [
    { x: 10, y: 20, target: { kind: 'sticker', stickerId: 's1' }, note: 'a' },
    { x: 30, y: 40, target: { kind: 'type', typeId: 't1' }, note: '' },
  ];
  const copy = copyMarks(source);
  expect(copy).toEqual(source);
  expect(copy).not.toBe(source);
  expect(copy[0]).not.toBe(source[0]);
  expect(copy[0]?.target).not.toBe(source[0]?.target);
  const first = copy[0];
  if (first) {
    first.x = 999;
    first.target = { kind: 'type', typeId: 'x' };
  }
  expect(source[0]).toEqual({
    x: 10,
    y: 20,
    target: { kind: 'sticker', stickerId: 's1' },
    note: 'a',
  });
});

test('moveEntry: memindahkan elemen tanpa mengubah daftar asal', () => {
  const list = ['a', 'b', 'c', 'd'];
  expect(moveEntry(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  expect(moveEntry(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  expect(list).toEqual(['a', 'b', 'c', 'd']);
});

test('moveEntry: indeks di luar rentang dijepit atau diabaikan', () => {
  const list = ['a', 'b', 'c'];
  expect(moveEntry(list, 1, 99)).toEqual(['a', 'c', 'b']);
  expect(moveEntry(list, 1, -5)).toEqual(['b', 'a', 'c']);
  expect(moveEntry(list, 7, 0)).toEqual(['a', 'b', 'c']);
  expect(moveEntry(list, 1, 1)).toEqual(['a', 'b', 'c']);
});

const sticker = (patch: Partial<StickerDto>): StickerDto => ({
  id: 's1',
  typeId: 't1',
  typeName: 'Postel',
  name: 'Stiker Postel',
  alias: '',
  fileId: null,
  minQty: 0,
  status: 'active',
  businessUnitIds: [],
  low: false,
  updatedAt: '',
  ...patch,
});
const type = (patch: Partial<StickerTypeDto>): StickerTypeDto => ({
  id: 't1',
  name: 'Postel',
  rule: 'bu',
  status: 'active',
  stickerCount: 1,
  updatedAt: '',
  ...patch,
});

test('markLabel: stiker aktif memakai namanya; nonaktif diberi tanda', () => {
  const stickers = [sticker({}), sticker({ id: 's2', name: 'Manual Book', status: 'inactive' })];
  expect(markLabel({ kind: 'sticker', stickerId: 's1' }, stickers, [])).toBe('Stiker Postel');
  expect(markLabel({ kind: 'sticker', stickerId: 's2' }, stickers, [])).toBe(
    'Manual Book — nonaktif',
  );
});

test('markLabel: jenis diawali "Jenis" dan nonaktif diberi tanda', () => {
  const types = [type({}), type({ id: 't2', name: 'Garansi', status: 'inactive' })];
  expect(markLabel({ kind: 'type', typeId: 't1' }, [], types)).toBe('Jenis Postel');
  expect(markLabel({ kind: 'type', typeId: 't2' }, [], types)).toBe('Jenis Garansi — nonaktif');
});

test('markLabel: id kosong menghasilkan teks kosong; id tak dikenal diberi petunjuk', () => {
  expect(markLabel({ kind: 'sticker', stickerId: '' }, [], [])).toBe('');
  expect(markLabel({ kind: 'type', typeId: '' }, [], [])).toBe('');
  expect(markLabel({ kind: 'sticker', stickerId: 'x' }, [], [])).toBe('Stiker tidak ditemukan');
  expect(markLabel({ kind: 'type', typeId: 'x' }, [], [])).toBe('Jenis tidak ditemukan');
});

test('groupInstructionErrors: memilah pesan menurut foto, penanda, dan umum (indeks mulai 0)', () => {
  const grouped = groupInstructionErrors([
    'Maksimal 10 foto instruksi',
    'Foto 1: catatan maksimal 200 karakter',
    'Foto 2: gambar sudah dipakai di foto lain',
    'Foto 2, penanda 3: pilih stiker atau jenis',
    'Foto 2, penanda 3: catatan maksimal 120 karakter',
    'Foto 11, penanda 1: posisi harus bilangan bulat 0–1000',
  ]);
  expect(grouped.general).toEqual(['Maksimal 10 foto instruksi']);
  expect(grouped.photos.get(0)).toEqual(['catatan maksimal 200 karakter']);
  expect(grouped.photos.get(1)).toEqual(['gambar sudah dipakai di foto lain']);
  expect(grouped.marks.get('1:2')).toEqual([
    'pilih stiker atau jenis',
    'catatan maksimal 120 karakter',
  ]);
  expect(grouped.marks.get('10:0')).toEqual(['posisi harus bilangan bulat 0–1000']);
});

test('groupInstructionErrors: pesan kembar digabung dan pesan tak berformat menjadi umum', () => {
  const grouped = groupInstructionErrors([
    'Foto 1: pilih gambar',
    'Foto 1: pilih gambar',
    'Galat server',
  ]);
  expect(grouped.photos.get(0)).toEqual(['pilih gambar']);
  expect(grouped.general).toEqual(['Galat server']);
  expect(groupInstructionErrors([]).general).toEqual([]);
});

test('isInactiveTarget: benar hanya bila stiker/jenis ada di katalog dan nonaktif', () => {
  const stickers = [sticker({}), sticker({ id: 's2', status: 'inactive' })];
  const types = [type({}), type({ id: 't2', status: 'inactive' })];
  expect(isInactiveTarget({ kind: 'sticker', stickerId: 's1' }, stickers, types)).toBe(false);
  expect(isInactiveTarget({ kind: 'sticker', stickerId: 's2' }, stickers, types)).toBe(true);
  expect(isInactiveTarget({ kind: 'type', typeId: 't1' }, stickers, types)).toBe(false);
  expect(isInactiveTarget({ kind: 'type', typeId: 't2' }, stickers, types)).toBe(true);
  // tak dikenal atau kosong: bukan "nonaktif" (ditangani validasi/label lain)
  expect(isInactiveTarget({ kind: 'sticker', stickerId: 'x' }, stickers, types)).toBe(false);
  expect(isInactiveTarget({ kind: 'type', typeId: '' }, stickers, types)).toBe(false);
});
