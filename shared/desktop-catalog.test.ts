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
