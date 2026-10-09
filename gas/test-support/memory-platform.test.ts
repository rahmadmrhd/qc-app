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
  expect(platform.driveReadFile(file)).toEqual({ mime: 'image/png', base64: 'QUJD' });
  expect(platform.driveReadFile('tidak-ada')).toBeNull();
});

test('Drive palsu menolak folder yang tidak ada', () => {
  const platform = createMemoryPlatform();
  expect(() => platform.driveCreateFile('hilang', 'a.png', 'image/png', 'QUJD')).toThrow();
});
