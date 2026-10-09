import { expect, test } from 'vitest';
import { altTextFromFileName, insertAtCursor, prefixLines, wrapSelection } from './edit-ops';

test('wrapSelection membungkus pilihan dan mempertahankan pilihan pada isinya', () => {
  expect(wrapSelection('halo dunia', { start: 5, end: 10 }, '**')).toEqual({
    text: 'halo **dunia**',
    selection: { start: 7, end: 12 },
  });
});

test('wrapSelection tanpa pilihan menyisipkan teks contoh yang terpilih', () => {
  expect(wrapSelection('', { start: 0, end: 0 }, '**')).toEqual({
    text: '**teks**',
    selection: { start: 2, end: 6 },
  });
  expect(wrapSelection('a b', { start: 2, end: 2 }, '[', '](https://)', 'tautan')).toEqual({
    text: 'a [tautan](https://)b',
    selection: { start: 3, end: 9 },
  });
});

test('prefixLines memberi awalan pada semua baris yang tersentuh pilihan', () => {
  expect(prefixLines('a\nb\nc', { start: 0, end: 3 }, () => '- ')).toEqual({
    text: '- a\n- b\nc',
    selection: { start: 0, end: 7 },
  });
  expect(prefixLines('a\nb\nc', { start: 2, end: 2 }, () => '- ').text).toBe('a\n- b\nc');
  expect(prefixLines('a\nb\nc', { start: 0, end: 5 }, (i) => `${i + 1}. `).text).toBe(
    '1. a\n2. b\n3. c',
  );
});

test('prefixLines: pilihan yang berakhir tepat setelah baris baru tidak menyentuh baris berikutnya', () => {
  expect(prefixLines('a\nb\n', { start: 0, end: 2 }, () => '> ').text).toBe('> a\nb\n');
});

test('prefixLines: kursor di awal teks yang diawali baris baru', () => {
  expect(prefixLines('\nx', { start: 0, end: 0 }, () => '- ').text).toBe('- \nx');
});

test('insertAtCursor mengganti pilihan dan meletakkan kursor sesudah sisipan', () => {
  expect(insertAtCursor('abcd', { start: 1, end: 3 }, 'XY')).toEqual({
    text: 'aXYd',
    selection: { start: 3, end: 3 },
  });
  expect(insertAtCursor('ab', { start: 2, end: 2 }, '!').text).toBe('ab!');
});

test('altTextFromFileName membuang ekstensi dan karakter yang merusak sintaks gambar', () => {
  expect(altTextFromFileName('foto kucing.png')).toBe('foto kucing');
  expect(altTextFromFileName('a\.png')).toBe('a');
  expect(altTextFromFileName('foto [1] (kecil).jpg')).toBe('foto 1 kecil');
  expect(altTextFromFileName('.png')).toBe('gambar');
  expect(altTextFromFileName('')).toBe('gambar');
  expect(altTextFromFileName('arsip.v2.final.webp')).toBe('arsip.v2.final');
});
