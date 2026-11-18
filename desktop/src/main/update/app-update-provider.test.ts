import { generateKeyPairSync } from 'node:crypto';
import { publicKeyPemOf, signUiManifest } from '@countrylock/ui-manifest';
import { type DesktopReleaseManifest, installerName } from '@shared/desktop-release';
import { describe, expect, it } from 'vitest';
import { createUpdateProviderOptions, QcUpdateProvider } from './app-update-provider';

const SHA = `${'A'.repeat(86)}==`;
const SERVER = 'https://qc.example.test';
const { privateKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKeyPemOf(privatePem);

const manifest = (version = '1.1.0'): DesktopReleaseManifest => ({
  schema: 1,
  version,
  publishedAt: '2026-11-18T10:00:00.000Z',
  files: (['x64', 'arm64'] as const).map((arch) => ({
    name: installerName(version, arch),
    arch,
    size: 4242,
    sha512: SHA,
  })),
  changelog: 'Perbaikan kecil.',
});

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function setup(respond: () => Response | Promise<Response>, installedVersion = '1.0.0') {
  const calls: Call[] = [];
  const logs: string[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond();
  }) as typeof fetch;
  const options = createUpdateProviderOptions({
    serverUrl: SERVER,
    publicKeyPem: publicPem,
    installedVersion,
    arch: 'x64',
    fetchImpl,
    log: (message) => logs.push(message),
  });
  const runtime = { isUseMultipleRangeRequest: false, platform: 'win32', executor: {} };
  const provider = new options.updateProvider(options, {} as never, runtime as never);
  return { provider, calls, logs, options };
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const signed = (m: DesktopReleaseManifest) => ({
  manifest: m,
  signature: signUiManifest(JSON.stringify(m), privatePem),
});

describe('QcUpdateProvider', () => {
  it('opsi memakai provider kustom dan kelas kita', () => {
    const { options } = setup(() => ok(signed(manifest())));
    expect(options.provider).toBe('custom');
    expect(options.updateProvider).toBe(QcUpdateProvider);
  });

  it('meminta manifest ke server QC sesuai arch, tanpa cookie atau Authorization', async () => {
    const { provider, calls } = setup(() => ok(signed(manifest())));
    await provider.getLatestVersion();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${SERVER}/api/desktop/app-manifest?arch=x64`);
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
    expect(calls[0]?.init?.credentials).toBe('omit');
  });

  it('rilis sah: UpdateInfo berisi versi, catatan, url server, sha512, dan ukuran', async () => {
    const { provider } = setup(() => ok(signed(manifest())));
    const info = await provider.getLatestVersion();
    expect(info.version).toBe('1.1.0');
    expect(info.releaseNotes).toBe('Perbaikan kecil.');
    expect(info.files).toHaveLength(1);
    expect(info.files[0]).toMatchObject({
      url: `${SERVER}/api/desktop/app-file/1.1.0/QC-App-Setup-1.1.0-x64.exe`,
      sha512: SHA,
      size: 4242,
    });
    const resolved = provider.resolveFiles(info);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.url.href).toBe(info.files[0]?.url);
    expect(resolved[0]?.url.pathname.endsWith('.exe')).toBe(true);
  });

  it('404, JSON rusak, galat jaringan, atau tanda tangan tak sah = UpdateInfo versi terpasang (bukan pembaruan)', async () => {
    const cases: Array<() => Response | Promise<Response>> = [
      () => new Response('tidak ada', { status: 404 }),
      () => new Response('bukan json', { status: 200 }),
      () => ok({ manifest: manifest(), signature: 'x'.repeat(86) }),
      () => ok({ halo: 1 }),
      () => {
        throw new Error('jaringan putus');
      },
    ];
    for (const respond of cases) {
      const { provider, logs } = setup(respond, '1.0.0');
      const info = await provider.getLatestVersion();
      expect(info.version).toBe('1.0.0');
      expect(info.files).toEqual([]);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join(' ')).not.toMatch(/github|rahmad|qc-app/i);
    }
  });

  it('manifest valid tetapi tidak lebih baru = versi terpasang', async () => {
    const { provider } = setup(() => ok(signed(manifest('1.0.0'))), '1.0.0');
    expect((await provider.getLatestVersion()).files).toEqual([]);
  });

  it('badan jawaban terlalu besar dihentikan di tengah aliran (tidak dibaca utuh), hasilnya versi terpasang', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(100 * 1024).fill(32);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 50) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const { provider, logs } = setup(
      () => new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const info = await provider.getLatestVersion();
    expect(info.version).toBe('1.0.0');
    expect(info.files).toEqual([]);
    expect(logs.join(' ')).toContain('terlalu besar');
    expect(pulled).toBeLessThan(15);
  });

  it('manifest yang diubah setelah ditandatangani ditolak', async () => {
    const good = signed(manifest());
    const tampered = { ...good, manifest: { ...good.manifest, changelog: 'disusupi' } };
    const { provider } = setup(() => ok(tampered));
    expect((await provider.getLatestVersion()).version).toBe('1.0.0');
  });
});
