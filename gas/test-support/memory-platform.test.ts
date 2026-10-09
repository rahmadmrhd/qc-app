import { expect, test } from 'bun:test';
import { createMemoryPlatform } from './memory-platform';

test('setProperty menyimpan dan getProperty membacanya', () => {
  const platform = createMemoryPlatform();
  expect(platform.getProperty('X')).toBeNull();
  platform.setProperty('X', 'nilai');
  expect(platform.getProperty('X')).toBe('nilai');
});

test('Drive palsu: buat folder, simpan berkas, baca kembali', () => {
  const platform = createMemoryPlatform();
  const folder = platform.driveCreateFolder('QC App Files');
  expect(platform.folders.get(folder)).toBe('QC App Files');
  const file = platform.driveCreateFile(folder, 'a.png', 'image/png', 'QUJD');
  expect(platform.driveReadFile(file, folder)).toEqual({ mime: 'image/png', base64: 'QUJD' });
  expect(platform.driveReadFile('tidak-ada', folder)).toBeNull();
});

test('Drive palsu menolak folder yang tidak ada', () => {
  const platform = createMemoryPlatform();
  expect(() => platform.driveCreateFile('hilang', 'a.png', 'image/png', 'QUJD')).toThrow();
});

test('driveReadFile hanya membaca berkas yang berada di folder yang diminta', () => {
  const platform = createMemoryPlatform();
  const a = platform.driveCreateFolder('A');
  const b = platform.driveCreateFolder('B');
  const file = platform.driveCreateFile(a, 'x.png', 'image/png', 'QUJD');
  expect(platform.driveReadFile(file, a)).not.toBeNull();
  expect(platform.driveReadFile(file, b)).toBeNull();
});

test('driveFolderExists: ada, dihapus, dan di tempat sampah', () => {
  const platform = createMemoryPlatform();
  const folder = platform.driveCreateFolder('A');
  expect(platform.driveFolderExists(folder)).toBe(true);
  platform.trashedFolders.add(folder);
  expect(platform.driveFolderExists(folder)).toBe(false);
  platform.folders.delete(folder);
  expect(platform.driveFolderExists(folder)).toBe(false);
  expect(platform.driveFolderExists('tidak-ada')).toBe(false);
});

test('driveTrashFile membuang berkas dan aman dipanggil untuk id yang tidak ada', () => {
  const platform = createMemoryPlatform();
  const folder = platform.driveCreateFolder('A');
  const file = platform.driveCreateFile(folder, 'x.png', 'image/png', 'QUJD');
  platform.driveTrashFile(file);
  expect(platform.driveReadFile(file, folder)).toBeNull();
  expect(() => platform.driveTrashFile('tidak-ada')).not.toThrow();
});
