import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { removeTempDirSync } from '../test-support/safe-rm';
import { baselineManifestProblem, canRun, parseArch, unpackedDirName } from './verify-pack-args';

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

describe('baselineManifestProblem (UI dasar harus membawa ui-manifest.json yang sah)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qc-verify-pack-'));
    mkdirSync(join(dir, 'ui-baseline'));
  });
  afterEach(() => {
    removeTempDirSync(dir);
  });
  const manifest = JSON.stringify({
    uiVersion: 'a'.repeat(64),
    minBridge: 2,
    files: [{ path: 'index.html', sha256: 'b'.repeat(64), size: 3 }],
    createdAt: 1234,
  });

  test('manifest sah = tanpa masalah', () => {
    writeFileSync(join(dir, 'ui-baseline', 'ui-manifest.json'), manifest);
    expect(baselineManifestProblem(join(dir, 'ui-baseline'))).toBeNull();
  });

  test('tanpa manifest = masalah (installer tak membawa penanda urutan UI dasar)', () => {
    expect(baselineManifestProblem(join(dir, 'ui-baseline'))).toMatch(/ui-manifest\.json/);
  });

  test('manifest rusak atau bentuk salah = masalah', () => {
    writeFileSync(join(dir, 'ui-baseline', 'ui-manifest.json'), '{ rusak');
    expect(baselineManifestProblem(join(dir, 'ui-baseline'))).not.toBeNull();
    writeFileSync(join(dir, 'ui-baseline', 'ui-manifest.json'), '{"uiVersion":"x"}');
    expect(baselineManifestProblem(join(dir, 'ui-baseline'))).not.toBeNull();
  });
});
