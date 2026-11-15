import { describe, expect, test } from 'bun:test';
import { markdownToPlain } from './markdown-plain';
import { hasControlChars } from './postel';

describe('markdownToPlain', () => {
  test('heading, penekanan, dan kode menjadi teks biasa', () => {
    const { text, imageCount } = markdownToPlain('# Judul\n\nIni **tebal**, _miring_, dan `kode`.');
    expect(text).toBe('Judul\n\nIni tebal, miring, dan kode.');
    expect(imageCount).toBe(0);
  });

  test('daftar dan kutipan dipertahankan terbaca', () => {
    const { text } = markdownToPlain('- satu\n* dua\n+ tiga\n1. empat\n> kutipan');
    expect(text).toBe('- satu\n- dua\n- tiga\n1. empat\nkutipan');
  });

  test('tautan menjadi "teks (url)"', () => {
    expect(markdownToPlain('Lihat [dokumen](https://contoh.id/a) ya').text).toBe(
      'Lihat dokumen (https://contoh.id/a) ya',
    );
  });

  test('gambar dibuang dan dihitung (inline dan rujukan)', () => {
    const { text, imageCount } = markdownToPlain(
      'Foto ![a](qcfile:abc123) dan ![b](qcfile:def456)\n![c][x]\n\n[x]: qcfile:ghi789',
    );
    expect(imageCount).toBe(3);
    expect(text).not.toContain('qcfile');
    expect(text).toBe('Foto dan');
  });

  test('teks hasil tanpa karakter kontrol atau pengatur arah', () => {
    const { text } = markdownToPlain('a\u0007b‮c\nbaris dua x');
    expect(hasControlChars(text.replaceAll('\n', ''))).toBe(false);
    expect(text).toContain('baris dua');
  });

  test('kosong tetap kosong', () => {
    expect(markdownToPlain('')).toEqual({ text: '', imageCount: 0 });
  });
});
