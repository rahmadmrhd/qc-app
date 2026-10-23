import { expect, test } from 'vitest';
import { altTextFromFileName } from './image-alt';

test('altTextFromFileName membuang ekstensi dan karakter yang merusak sintaks gambar', () => {
  expect(altTextFromFileName('foto kucing.png')).toBe('foto kucing');
  expect(altTextFromFileName('a.png')).toBe('a');
  expect(altTextFromFileName('foto [1] (kecil).jpg')).toBe('foto 1 kecil');
  expect(altTextFromFileName('.png')).toBe('gambar');
  expect(altTextFromFileName('')).toBe('gambar');
  expect(altTextFromFileName('arsip.v2.final.webp')).toBe('arsip.v2.final');
});
