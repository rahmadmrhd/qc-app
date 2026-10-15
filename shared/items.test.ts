import { describe, expect, test } from 'bun:test';
import {
  extractFileRefs,
  hashText,
  ITEM_LIMITS,
  itemKey,
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
