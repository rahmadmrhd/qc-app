import { describe, expect, test } from 'bun:test';
import {
  DRIVE_REF_SCHEME,
  extractFileRefs,
  extractImageTargets,
  extractRefs,
  hashText,
  ITEM_LIMITS,
  itemKey,
  mapMarkdownRefs,
  normalizeKey,
  normalizeNewlines,
} from './items';

describe('normalizeKey', () => {
  test('huruf kecil, tanda baca menjadi spasi, spasi dirapikan', () => {
    expect(normalizeKey('ES-24 250W')).toBe('es 24 250w');
    expect(normalizeKey('  Ubiquiti   AF/5XHD ')).toBe('ubiquiti af 5xhd');
    expect(normalizeKey('B DB AC')).toBe('b db ac');
  });

  test('varian penulisan yang sama menghasilkan kunci yang sama', () => {
    const variants = ['ES 24 250W', 'es-24 250w', 'ES_24  250W', '(ES) 24, 250W.'];
    expect(new Set(variants.map(normalizeKey)).size).toBe(1);
  });

  test('hanya tanda baca atau kosong menghasilkan teks kosong', () => {
    expect(normalizeKey('')).toBe('');
    expect(normalizeKey(' -- / .. ')).toBe('');
  });

  test('angka dan huruf bukan-ASCII dipertahankan', () => {
    expect(normalizeKey('Tipe 7Å')).toBe('tipe 7å');
  });
});

describe('itemKey', () => {
  test('menggabungkan merk dan tipe', () => {
    expect(itemKey('Ubiquiti', 'ES-24 250W')).toBe('ubiquiti es 24 250w');
    expect(itemKey('UBIQUITI', 'es-24 250w')).toBe('ubiquiti es 24 250w');
  });

  test('batas pemisah merk dan tipe tidak kabur: "ab" + "c d" berbeda dari "a" + "bc d"', () => {
    expect(itemKey('ab', 'c d')).not.toBe(itemKey('a', 'bc d'));
  });
});

describe('normalizeNewlines', () => {
  test('CRLF dan CR sendirian menjadi LF', () => {
    const cr = String.fromCharCode(13);
    const lf = String.fromCharCode(10);
    expect(normalizeNewlines(`a${cr}${lf}b${cr}c`)).toBe(`a${lf}b${lf}c`);
    expect(normalizeNewlines('tanpa baris baru')).toBe('tanpa baris baru');
  });
});

describe('hashText', () => {
  test('deterministik, berbeda untuk teks berbeda, dan 8 digit heksa', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
    expect(hashText('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('extractFileRefs', () => {
  test('mengambil id dari rujukan gambar qcfile, unik dan berurutan', () => {
    const md = 'A ![x](qcfile:aaa-1) dan ![y](qcfile:bbb_2) lalu ![z](qcfile:aaa-1)';
    expect(extractFileRefs(md)).toEqual(['aaa-1', 'bbb_2']);
  });

  test('mengambil id dari semua bentuk rujukan yang dirender: judul, kurung sudut, gaya referensi', () => {
    const md = [
      '![a](qcfile:aaa "judul")',
      '![b](<qcfile:bbb>)',
      '![c]( qcfile:ccc )',
      '![d][r]',
      '',
      '[r]: qcfile:ddd',
    ].join(String.fromCharCode(10));
    expect(extractFileRefs(md)).toEqual(['aaa', 'bbb', 'ccc', 'ddd']);
  });

  test('mengabaikan rujukan kosong, huruf besar, atau skema lain', () => {
    const md = ['![a](https://x.test/a.png)', '![b](qcfile:)', '![e](QCFILE:eee)'].join(' ');
    expect(extractFileRefs(md)).toEqual([]);
  });

  test('teks tanpa rujukan menghasilkan daftar kosong', () => {
    expect(extractFileRefs('')).toEqual([]);
    expect(extractFileRefs('teks biasa')).toEqual([]);
  });
});

test('ITEM_LIMITS memuat batas PRD FI7', () => {
  expect(ITEM_LIMITS).toMatchObject({
    brand: 60,
    model: 100,
    alias: 100,
    aliases: 10,
    stickerName: 100,
    stickerNote: 300,
    stickers: 30,
    accessoryName: 100,
    accessoryQty: 999,
    accessories: 30,
    attachments: 10,
    jsonCell: 40_000,
  });
});
describe('extractRefs', () => {
  test('skema bebas; sama dengan extractFileRefs untuk qcfile', () => {
    const md = '![a](drive:AAA_1) dan [b](drive:BBB-2) ![c](qcfile:zzz)';
    expect(extractRefs(md, 'drive:')).toEqual(['AAA_1', 'BBB-2']);
    expect(extractRefs(md, 'qcfile:')).toEqual(['zzz']);
    expect(extractFileRefs(md)).toEqual(['zzz']);
  });
});

describe('mapMarkdownRefs', () => {
  test('mengganti skema dan id yang dikenal; id tak dikenal dan kemunculan di tengah kata dibiarkan', () => {
    const lookup = (id: string) => (id === 'f1' ? 'DRV1' : null);
    expect(
      mapMarkdownRefs('![x](qcfile:f1) ![y](qcfile:f2) xqcfile:f1', 'qcfile:', 'drive:', lookup),
    ).toBe('![x](drive:DRV1) ![y](qcfile:f2) xqcfile:f1');
  });

  test('id kosong dan teks tanpa rujukan tidak berubah; bolak-balik stabil', () => {
    const none = () => null;
    expect(mapMarkdownRefs('![x](qcfile:) teks', 'qcfile:', 'drive:', none)).toBe(
      '![x](qcfile:) teks',
    );
    expect(mapMarkdownRefs('', 'qcfile:', 'drive:', none)).toBe('');
    const there = mapMarkdownRefs('A ![x](qcfile:f1) B', 'qcfile:', 'drive:', () => 'D1');
    expect(mapMarkdownRefs(there, 'drive:', 'qcfile:', () => 'f1')).toBe('A ![x](qcfile:f1) B');
  });
});

describe('extractImageTargets', () => {
  test('mengambil tujuan semua gambar ![..](..), termasuk yang berjudul; tautan biasa diabaikan', () => {
    const md = [
      '![a](drive:AAA)',
      '[tautan](https://x.test)',
      '![b](https://x.test/b.png "judul")',
      '![c](data:image/png;base64,AAAA)',
    ].join(String.fromCharCode(10));
    expect(extractImageTargets(md)).toEqual([
      'drive:AAA',
      'https://x.test/b.png "judul"',
      'data:image/png;base64,AAAA',
    ]);
  });

  test('tanpa gambar atau kurung tak lengkap menghasilkan daftar kosong', () => {
    expect(extractImageTargets('teks biasa')).toEqual([]);
    expect(extractImageTargets('![a] tanpa tujuan')).toEqual([]);
  });
});

test('DRIVE_REF_SCHEME adalah skema rujukan Drive pada kabel sinkronisasi', () => {
  expect(DRIVE_REF_SCHEME).toBe('drive:');
});

test('normalizeKey mempertahankan huruf dan angka non-Latin (CJK, Arab, Thai, Kiril)', () => {
  expect(normalizeKey('小米 13')).toBe('小米 13');
  expect(normalizeKey('Xiaomi-小米!')).toBe('xiaomi 小米');
  expect(normalizeKey('Хуавей P40')).toBe('хуавей p40');
  expect(normalizeKey('ซัมซุง')).toBe('ซัมซุง');
  expect(normalizeKey('مرحبا 2')).toBe('مرحبا 2');
  expect(itemKey('小米', '手机')).not.toBe(itemKey('华为', '手机'));
});
