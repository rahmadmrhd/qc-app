import { describe, expect, test } from 'bun:test';
import { parseDesktopCatalog } from './desktop-catalog';

const item = {
  id: 'i1',
  brand: 'Ubiquiti',
  model: 'AF-5XHD',
  aliases: [],
  businessUnits: [],
  stickerIds: [],
  stickerPhotos: [],
};

const catalogOf = (entry: Record<string, unknown>) => ({
  version: 1,
  items: [entry],
  stickerTypes: [],
  stickers: [],
  files: [],
});

describe('parseDesktopCatalog: firmware item', () => {
  test('server lama (tanpa field firmware) tetap sah', () => {
    expect(parseDesktopCatalog(catalogOf(item))).not.toBeNull();
  });
  test('firmware berupa teks pendek sah', () => {
    const parsed = parseDesktopCatalog(catalogOf({ ...item, firmware: 'af5xhd' }));
    expect(parsed?.items[0]?.firmware).toBe('af5xhd');
    expect(parseDesktopCatalog(catalogOf({ ...item, firmware: '' }))).not.toBeNull();
  });
  test('firmware bukan teks atau terlalu panjang = katalog ditolak', () => {
    expect(parseDesktopCatalog(catalogOf({ ...item, firmware: 5 }))).toBeNull();
    expect(parseDesktopCatalog(catalogOf({ ...item, firmware: null }))).toBeNull();
    expect(parseDesktopCatalog(catalogOf({ ...item, firmware: 'x'.repeat(41) }))).toBeNull();
  });
});

describe('parseDesktopCatalog: businessUnits pada item', () => {
  test('isi yang salah (null, id kosong, field bukan teks, bukan larik) = katalog ditolak; yang benar sah', () => {
    const ref = { id: 'b1', code: 'DEF', name: 'BU Bawaan' };
    expect(parseDesktopCatalog(catalogOf({ ...item, businessUnits: [ref] }))).not.toBeNull();
    for (const businessUnits of [
      [null],
      [{ ...ref, id: '' }],
      [{ ...ref, name: 5 }],
      ['b1'],
      'x',
    ]) {
      expect(
        parseDesktopCatalog(catalogOf({ ...item, businessUnits })),
        JSON.stringify(businessUnits),
      ).toBeNull();
    }
  });
});

describe('parseDesktopCatalog: BU dan lokasi (pilihan form inject)', () => {
  const withTargets = (extra: Record<string, unknown>) => ({ ...catalogOf(item), ...extra });
  const ref = { id: 'b1', code: 'DEF', name: 'BU Bawaan' };

  test('server atau cache lama (tanpa businessUnits/locations) tetap sah', () => {
    expect(parseDesktopCatalog(catalogOf(item))).not.toBeNull();
  });
  test('daftar BU dan lokasi yang benar diteruskan apa adanya', () => {
    const parsed = parseDesktopCatalog(withTargets({ businessUnits: [ref], locations: [ref] }));
    expect(parsed?.businessUnits).toEqual([ref]);
    expect(parsed?.locations).toEqual([ref]);
  });
  test('bentuk salah (bukan larik, id kosong, field bukan teks) = katalog ditolak', () => {
    expect(parseDesktopCatalog(withTargets({ locations: 'x' }))).toBeNull();
    expect(parseDesktopCatalog(withTargets({ locations: [{ ...ref, id: '' }] }))).toBeNull();
    expect(parseDesktopCatalog(withTargets({ businessUnits: [{ ...ref, name: 5 }] }))).toBeNull();
    expect(parseDesktopCatalog(withTargets({ businessUnits: [null] }))).toBeNull();
  });
});
