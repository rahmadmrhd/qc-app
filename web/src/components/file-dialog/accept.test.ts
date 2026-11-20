import { expect, test } from 'vitest';
import { baseName, checkFile, fileMime, formatBytes, resolveAccept } from './accept';

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

test('checkFile: PDF di dialog gambar ditolak dengan daftar format yang didukung', () => {
  expect(checkFile(file('a.pdf', 'application/pdf'), rule)).toBe(
    'Format PDF tidak didukung (hanya JPEG, PNG, WebP)',
  );
});

test('checkFile: jenis kosong diturunkan dari ekstensi lewat fileMime', () => {
  expect(checkFile(file('a.PNG', ''), rule)).toBeNull();
  expect(
    checkFile(file('a.pdf', ''), { accept: ['application/pdf'], maxBytes: 10_000 }),
  ).toBeNull();
});

test('checkFile: pesan persis untuk berkas kosong dan melebihi 10 MB', () => {
  expect(checkFile(file('a.png', 'image/png', 0), rule)).toBe('Berkas kosong');
  expect(checkFile(file('a.png', 'image/png', 10_485_761), rule)).toBe('Ukuran melebihi 10 MB');
});

test('fileMime: file.type dulu, cadangan ekstensi, selain itu kosong', () => {
  expect(fileMime(file('a.bin', 'image/png'))).toBe('image/png');
  expect(fileMime(file('a.JPG', ''))).toBe('image/jpeg');
  expect(fileMime(file('a.pdf', ''))).toBe('application/pdf');
  expect(fileMime(file('pdf', ''))).toBe('');
  expect(fileMime(file('constructor', ''))).toBe('');
});

test("resolveAccept: kategori 'pdf' = application/pdf", () => {
  expect(resolveAccept(['pdf'], ['image/png', 'application/pdf'])).toEqual(['application/pdf']);
  expect(resolveAccept(['image', 'pdf'], ['image/png', 'application/pdf'])).toEqual([
    'image/png',
    'application/pdf',
  ]);
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
