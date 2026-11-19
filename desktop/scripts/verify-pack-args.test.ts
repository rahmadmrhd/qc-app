import { describe, expect, test } from 'vitest';
import { canRun, parseArch, unpackedDirName } from './verify-pack-args';

describe('parseArch', () => {
  test('tanpa argumen = x64 (perilaku lama)', () => {
    expect(parseArch([])).toBe('x64');
  });

  test('--arch <nilai> dan --arch=<nilai>', () => {
    expect(parseArch(['--arch', 'arm64'])).toBe('arm64');
    expect(parseArch(['--arch=arm64'])).toBe('arm64');
    expect(parseArch(['--arch', 'x64'])).toBe('x64');
  });

  test('nilai tak dikenal atau tanpa nilai ditolak', () => {
    expect(() => parseArch(['--arch', 'ia32'])).toThrow();
    expect(() => parseArch(['--arch'])).toThrow();
    expect(() => parseArch(['--arch='])).toThrow();
  });
});

describe('unpackedDirName', () => {
  test('nama folder hasil electron-builder --dir per arsitektur', () => {
    expect(unpackedDirName('x64')).toBe('win-unpacked');
    expect(unpackedDirName('arm64')).toBe('win-arm64-unpacked');
  });
});

describe('canRun', () => {
  test('x64 dapat dijalankan di host x64 dan arm64 (emulasi); arm64 hanya di host arm64', () => {
    expect(canRun('x64', 'x64')).toBe(true);
    expect(canRun('x64', 'arm64')).toBe(true);
    expect(canRun('arm64', 'arm64')).toBe(true);
    expect(canRun('arm64', 'x64')).toBe(false);
  });
});
