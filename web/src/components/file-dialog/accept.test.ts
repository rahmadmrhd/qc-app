import { expect, test } from 'vitest';
import { baseName, checkFile, formatBytes, resolveAccept } from './accept';

const rule = { accept: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 10 * 1024 * 1024 };
const file = (name: string, type: string, size = 1000) => ({ name, type, size });

test("resolveAccept: kategori 'image' = mime berawalan image/ dalam supported", () => {
  expect(resolveAccept(['image'], ['image/png', 'application/pdf'])).toEqual(['image/png']);
  expect(resolveAccept([], ['image/png'])).toEqual([]);
});

test('checkFile menerima berkas sah', () => {
  expect(checkFile(file('a.png', 'image/png'), rule)).toBeNull();
  expect(checkFile(file('a.webp', 'image/webp', rule.maxBytes), rule)).toBeNull();
});

test('checkFile menolak HEIC, GIF, PDF, dan tipe kosong dengan alasan', () => {
  expect(checkFile(file('IMG_1.HEIC', 'image/heic'), rule)).toMatch(/HEIC/);
  expect(checkFile(file('IMG_2.heic', ''), rule)).toMatch(/HEIC/);
  expect(checkFile(file('a.gif', 'image/gif'), rule)).toMatch(/GIF/);
  expect(checkFile(file('a.pdf', 'application/pdf'), rule)).toMatch(/PDF/);
  expect(checkFile(file('a.bin', ''), rule)).toMatch(/JPEG, PNG, WebP/);
});

test('checkFile menolak berkas kosong dan di atas batas', () => {
  expect(checkFile(file('a.png', 'image/png', 0), rule)).toMatch(/kosong/i);
  expect(checkFile(file('a.png', 'image/png', rule.maxBytes + 1), rule)).toMatch(/10 MB/);
});

test('baseName membuang ekstensi, merapikan spasi, dan memotong sesuai batas', () => {
  expect(baseName('foto  kardus.final.PNG')).toBe('foto kardus.final');
  expect(baseName('.png')).toBe('Berkas');
  expect(baseName('noext')).toBe('noext');
  expect(baseName(`${'a'.repeat(200)}.png`, 120)).toHaveLength(120);
  expect(baseName(`${'\u{1F600}'.repeat(130)}.png`, 120)).toBe('\u{1F600}'.repeat(120));
});

test('formatBytes', () => {
  expect(formatBytes(500)).toBe('500 B');
  expect(formatBytes(2048)).toBe('2 KB');
  expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
});
