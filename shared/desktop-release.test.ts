import { describe, expect, test } from 'bun:test';
import {
  compareVersions,
  type DesktopReleaseManifest,
  installerName,
  isReleaseFileName,
  latestVersion,
  manifestFileName,
  parseReleaseManifest,
  RELEASE_SCHEMA,
  signatureFileName,
} from './desktop-release';

const SHA = `${'A'.repeat(86)}==`;

const valid = (): DesktopReleaseManifest => ({
  schema: RELEASE_SCHEMA,
  version: '1.2.0',
  publishedAt: '2026-11-18T10:00:00.000Z',
  files: [
    { name: installerName('1.2.0', 'x64'), arch: 'x64', size: 100_000_000, sha512: SHA },
    { name: installerName('1.2.0', 'arm64'), arch: 'arm64', size: 99_000_000, sha512: SHA },
  ],
  changelog: '## Diperbaiki\n- Perbaikan kecil.',
});
const parse = (value: unknown) => parseReleaseManifest(JSON.stringify(value));

describe('nama berkas rilis', () => {
  test('bentuk nama', () => {
    expect(installerName('1.2.0', 'x64')).toBe('QC-App-Setup-1.2.0-x64.exe');
    expect(manifestFileName('1.2.0')).toBe('release-1.2.0.json');
    expect(signatureFileName('1.2.0')).toBe('release-1.2.0.sig');
  });
  test('isReleaseFileName mengenali tiga jenis dan menolak sisanya', () => {
    expect(isReleaseFileName('QC-App-Setup-1.10.0-arm64.exe')).toEqual({
      kind: 'installer',
      version: '1.10.0',
      arch: 'arm64',
    });
    expect(isReleaseFileName('release-1.10.0.json')).toEqual({
      kind: 'manifest',
      version: '1.10.0',
    });
    expect(isReleaseFileName('release-1.10.0.sig')).toEqual({
      kind: 'signature',
      version: '1.10.0',
    });
    for (const bad of [
      'QC-App-Setup-1.0.0-ia32.exe',
      'QC-App-Setup-01.0.0-x64.exe',
      'release-1.0.0.json.bak',
      'release-1.0.json',
      '../release-1.0.0.json',
      'sub/release-1.0.0.json',
      'release-1.0.0.json\n',
      '',
    ]) {
      expect(isReleaseFileName(bad), bad).toBeNull();
    }
  });
});

describe('perbandingan versi', () => {
  test('numerik, bukan teks', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('10.0.0', '9.99.99')).toBeGreaterThan(0);
  });
  test('latestVersion mengabaikan yang bukan X.Y.Z', () => {
    expect(latestVersion(['1.9.0', '1.10.0', 'x', '2.0', '01.0.0'])).toBe('1.10.0');
    expect(latestVersion([])).toBeNull();
    expect(latestVersion(['abc'])).toBeNull();
  });
});

describe('parseReleaseManifest', () => {
  test('manifest sah diterima', () => {
    expect(parse(valid())).toEqual(valid());
  });
  test('hanya satu arsitektur juga sah', () => {
    const manifest = valid();
    manifest.files = manifest.files.slice(0, 1);
    expect(parse(manifest)).not.toBeNull();
  });
  test('bukan bentuk kanonik (JSON berspasi) ditolak', () => {
    expect(parseReleaseManifest(JSON.stringify(valid(), null, 2))).toBeNull();
  });
  test('urutan kunci selain urutan kanonik ditolak (klien membangun ulang teks yang ditandatangani dalam urutan itu)', () => {
    const base = valid();
    const { changelog, ...rest } = base;
    const topLevel = { changelog, ...rest };
    expect(parseReleaseManifest(JSON.stringify(topLevel))).toBeNull();
    const file = base.files[0] as DesktopReleaseManifest['files'][number];
    const reordered = {
      ...base,
      files: [{ sha512: file.sha512, name: file.name, arch: file.arch, size: file.size }],
    };
    expect(parseReleaseManifest(JSON.stringify(reordered))).toBeNull();
  });
  test('bukan JSON atau bukan objek ditolak', () => {
    expect(parseReleaseManifest('bukan json')).toBeNull();
    expect(parseReleaseManifest('[]')).toBeNull();
    expect(parseReleaseManifest('null')).toBeNull();
  });
  test('schema dan versi', () => {
    expect(parse({ ...valid(), schema: 2 })).toBeNull();
    expect(parse({ ...valid(), version: '01.2.0' })).toBeNull();
    expect(parse({ ...valid(), version: '1.2' })).toBeNull();
  });
  test('publishedAt harus ISO sah', () => {
    expect(parse({ ...valid(), publishedAt: 'kemarin' })).toBeNull();
    expect(parse({ ...valid(), publishedAt: '2026-13-40T00:00:00.000Z' })).toBeNull();
  });
  test('berkas: nama, arch, ukuran, hash', () => {
    const withFile = (patch: Record<string, unknown>) => {
      const manifest = valid();
      manifest.files = [{ ...manifest.files[0], ...patch } as never];
      return manifest;
    };
    expect(parse(withFile({ name: '../x.exe' }))).toBeNull();
    expect(parse(withFile({ name: 'QC-App-Setup-1.2.0-arm64.exe' }))).toBeNull(); // tak cocok arch
    expect(parse(withFile({ arch: 'ia32' }))).toBeNull();
    expect(parse(withFile({ size: 0 }))).toBeNull();
    expect(parse(withFile({ size: 1.5 }))).toBeNull();
    expect(parse(withFile({ size: 500 * 1024 * 1024 + 1 }))).toBeNull();
    expect(parse(withFile({ sha512: 'A'.repeat(87) }))).toBeNull();
    expect(parse(withFile({ sha512: `${'A'.repeat(85)}!==` }))).toBeNull();
  });
  test('arch ganda, daftar kosong, dan kunci tak dikenal ditolak', () => {
    const dup = valid();
    dup.files = [dup.files[0] as never, dup.files[0] as never];
    expect(parse(dup)).toBeNull();
    expect(parse({ ...valid(), files: [] })).toBeNull();
    expect(parse({ ...valid(), extra: 1 })).toBeNull();
    expect(parse({ ...valid(), files: [{ ...valid().files[0], extra: 1 }] })).toBeNull();
  });
  test('changelog: harus teks dan maksimal 20.000 karakter', () => {
    expect(parse({ ...valid(), changelog: 'a'.repeat(20_000) })).not.toBeNull();
    expect(parse({ ...valid(), changelog: 'a'.repeat(20_001) })).toBeNull();
    expect(parse({ ...valid(), changelog: 1 })).toBeNull();
  });
});
