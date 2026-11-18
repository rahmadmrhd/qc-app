import { generateKeyPairSync } from 'node:crypto';
import { publicKeyPemOf, signUiManifest } from '@countrylock/ui-manifest';
import {
  type DesktopReleaseManifest,
  installerName,
  type ReleaseArch,
} from '@shared/desktop-release';
import { describe, expect, it } from 'vitest';
import { evaluateRelease } from './release-verify';

const SHA = `${'A'.repeat(86)}==`;

function keyPair() {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return { privatePem, publicPem: publicKeyPemOf(privatePem) };
}
const trusted = keyPair();

function manifestOf(
  version: string,
  archs: ReleaseArch[] = ['x64', 'arm64'],
): DesktopReleaseManifest {
  return {
    schema: 1,
    version,
    publishedAt: '2026-11-18T10:00:00.000Z',
    files: archs.map((arch) => ({
      name: installerName(version, arch),
      arch,
      size: 123,
      sha512: SHA,
    })),
    changelog: 'Perbaikan',
  };
}
const sign = (json: string, privatePem = trusted.privatePem) => signUiManifest(json, privatePem);

function evaluate(
  manifest: DesktopReleaseManifest,
  overrides: Partial<Parameters<typeof evaluateRelease>[0]> = {},
) {
  const manifestJson = overrides.manifestJson ?? JSON.stringify(manifest);
  return evaluateRelease({
    manifestJson,
    signature: sign(manifestJson),
    publicKeyPem: trusted.publicPem,
    installedVersion: '1.0.0',
    arch: 'x64',
    ...overrides,
  });
}

describe('evaluateRelease', () => {
  it('rilis lebih baru dengan tanda tangan sah dan berkas untuk arch = available', () => {
    const result = evaluate(manifestOf('1.1.0'));
    expect(result.kind).toBe('available');
    if (result.kind === 'available') {
      expect(result.file.name).toBe('QC-App-Setup-1.1.0-x64.exe');
      expect(result.manifest.version).toBe('1.1.0');
    }
  });

  it('memilih berkas sesuai arch', () => {
    const result = evaluate(manifestOf('1.1.0'), { arch: 'arm64' });
    expect(result.kind === 'available' && result.file.arch).toBe('arm64');
  });

  it('1.10.0 lebih baru daripada terpasang 1.9.0 (perbandingan numerik)', () => {
    expect(evaluate(manifestOf('1.10.0'), { installedVersion: '1.9.0' }).kind).toBe('available');
    expect(evaluate(manifestOf('1.9.0'), { installedVersion: '1.10.0' }).kind).toBe('none');
  });

  it('versi sama atau lebih rendah = none (pembaruan hanya naik)', () => {
    expect(evaluate(manifestOf('1.0.0')).kind).toBe('none');
    expect(evaluate(manifestOf('0.9.0')).kind).toBe('none');
  });

  it('tanda tangan dari kunci lain, rusak, atau atas teks berbeda = none', () => {
    const other = keyPair();
    const json = JSON.stringify(manifestOf('1.1.0'));
    expect(evaluate(manifestOf('1.1.0'), { signature: sign(json, other.privatePem) }).kind).toBe(
      'none',
    );
    expect(evaluate(manifestOf('1.1.0'), { signature: 'x'.repeat(86) }).kind).toBe('none');
    expect(evaluate(manifestOf('1.1.0'), { signature: sign('{"lain":1}') }).kind).toBe('none');
  });

  it('manifest tidak kanonik (berspasi) atau schema tak dikenal = none walau bertanda tangan sah', () => {
    const spaced = JSON.stringify(manifestOf('1.1.0'), null, 2);
    expect(evaluate(manifestOf('1.1.0'), { manifestJson: spaced }).kind).toBe('none');
    const schema2 = JSON.stringify({ ...manifestOf('1.1.0'), schema: 2 });
    expect(evaluate(manifestOf('1.1.0'), { manifestJson: schema2 }).kind).toBe('none');
  });

  it('rilis tanpa berkas untuk arch yang diminta = none', () => {
    expect(evaluate(manifestOf('1.1.0', ['arm64']), { arch: 'x64' }).kind).toBe('none');
  });

  it('alasan penolakan tidak memuat identitas repo atau isi manifest', () => {
    const results = [
      evaluate(manifestOf('1.1.0'), { signature: 'x'.repeat(86) }),
      evaluate(manifestOf('1.0.0')),
      evaluate(manifestOf('1.1.0', ['arm64'])),
    ];
    for (const result of results) {
      expect(result.kind).toBe('none');
      if (result.kind === 'none') expect(result.reason).not.toMatch(/github|rahmad|qc-app/i);
    }
  });
});
