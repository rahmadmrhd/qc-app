import { describe, expect, test } from 'bun:test';
import { installerName } from '@shared/desktop-release';
import type { ServedRelease } from './app-release';
import { filterSupported, toReleaseDto } from './releases-dto';

const SHA_B64 = `${'A'.repeat(86)}==`;

function served(version: string, archs: ('x64' | 'arm64')[] = ['x64', 'arm64']): ServedRelease {
  const manifest = {
    schema: 1 as const,
    version,
    publishedAt: '2026-11-18T10:00:00.000Z',
    files: archs.map((arch) => ({
      name: installerName(version, arch),
      arch,
      size: 105_906_176,
      sha512: SHA_B64,
    })),
    changelog: `Catatan ${version}`,
  };
  return {
    version,
    manifestJson: JSON.stringify(manifest),
    manifest,
    signature: 'c'.repeat(86),
    etag: 'e',
    files: new Map(),
  };
}

describe('toReleaseDto', () => {
  test('url publik, sha512 heksadesimal 128, changelog dan tanggal diteruskan', () => {
    const dto = toReleaseDto(served('1.2.0'));
    expect(dto.version).toBe('1.2.0');
    expect(dto.publishedAt).toBe('2026-11-18T10:00:00.000Z');
    expect(dto.changelog).toBe('Catatan 1.2.0');
    expect(dto.files.map((file) => file.arch)).toEqual(['x64', 'arm64']);
    const x64 = dto.files[0];
    expect(x64?.url).toBe('/api/desktop/app-file/1.2.0/QC-App-Setup-1.2.0-x64.exe');
    expect(x64?.name).toBe('QC-App-Setup-1.2.0-x64.exe');
    expect(x64?.size).toBe(105_906_176);
    expect(x64?.sha512).toMatch(/^[0-9a-f]{128}$/);
    expect(x64?.sha512).toBe(Buffer.from(SHA_B64, 'base64').toString('hex'));
  });

  test('berkas diurutkan x64 lalu arm64 walau manifest berurutan sebaliknya', () => {
    const release = served('1.0.0');
    release.manifest.files.reverse();
    expect(toReleaseDto(release).files.map((file) => file.arch)).toEqual(['x64', 'arm64']);
  });

  test('rilis dengan satu arsitektur saja', () => {
    expect(toReleaseDto(served('1.0.0', ['arm64'])).files.map((file) => file.arch)).toEqual([
      'arm64',
    ]);
  });
});

describe('filterSupported', () => {
  const releases = [served('1.10.0'), served('1.2.0'), served('1.1.9')];

  test('menyaring versi di bawah minimum dan membandingkan secara numerik', () => {
    const versions = filterSupported(releases, '1.2.0').map((release) => release.version);
    expect(versions).toEqual(['1.10.0', '1.2.0']);
  });

  test('minimum 0.0.0 tidak menyaring apa pun', () => {
    expect(filterSupported(releases, '0.0.0')).toHaveLength(3);
  });
});
