import type { DesktopReleaseDto, DesktopReleasesDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { DetectedPlatform } from '../lib/detect-platform';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { DesktopDownloadsPage } from './desktop-downloads-page';

const sha = (char: string) => char.repeat(128);

function release(
  version: string,
  archs: ('x64' | 'arm64')[] = ['x64', 'arm64'],
): DesktopReleaseDto {
  return {
    version,
    publishedAt: '2026-11-18T10:00:00.000Z',
    changelog: `Catatan untuk ${version}`,
    files: archs.map((arch) => ({
      arch,
      name: `QC-App-Setup-${version}-${arch}.exe`,
      size: 105_906_176,
      sha512: sha(arch === 'x64' ? 'a' : 'b'),
      url: `/api/desktop/app-file/${version}/QC-App-Setup-${version}-${arch}.exe`,
    })),
  };
}

function renderPage(data: DesktopReleasesDto, platform: DetectedPlatform) {
  apiMock.mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>memuat</p>}>
        <DesktopDownloadsPage platform={platform} />
      </Suspense>
    </QueryClientProvider>,
  );
}

const WIN_X64: DetectedPlatform = { os: 'windows', arch: 'x64' };

beforeEach(() => {
  apiMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DesktopDownloadsPage', () => {
  test('enabled false: pesan belum tersedia tanpa tautan unduh', async () => {
    renderPage({ enabled: false, releases: [] }, WIN_X64);
    expect(await screen.findByText('Unduhan belum tersedia')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /unduh/i })).toBeNull();
  });

  test('enabled tetapi kosong: pesan belum ada versi (bukan "belum tersedia")', async () => {
    renderPage({ enabled: true, releases: [] }, WIN_X64);
    expect(
      await screen.findByText('Belum ada versi yang tersedia untuk diunduh'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Unduhan belum tersedia')).toBeNull();
  });

  test('Windows x64: tombol utama ke installer x64 versi terbaru, dua baris di daftar', async () => {
    renderPage({ enabled: true, releases: [release('1.10.0'), release('1.2.0')] }, WIN_X64);
    const main = await screen.findByRole('link', { name: /Unduh untuk Windows x64/ });
    expect(main).toHaveAttribute(
      'href',
      '/api/desktop/app-file/1.10.0/QC-App-Setup-1.10.0-x64.exe',
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(
      within(rows[1] as HTMLElement).getByText(/Pasang versi lama hanya bila perlu/),
    ).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).queryByText(/Pasang versi lama hanya bila perlu/),
    ).toBeNull();
  });

  test('Windows ARM: tombol utama ke installer arm64', async () => {
    renderPage({ enabled: true, releases: [release('1.2.0')] }, { os: 'windows', arch: 'arm64' });
    const main = await screen.findByRole('link', { name: /Unduh untuk Windows ARM/ });
    expect(main).toHaveAttribute(
      'href',
      '/api/desktop/app-file/1.2.0/QC-App-Setup-1.2.0-arm64.exe',
    );
  });

  test('OS lain: kalimat Windows tanpa tombol utama, tautan di daftar tetap ada', async () => {
    renderPage({ enabled: true, releases: [release('1.2.0')] }, { os: 'other' });
    expect(
      await screen.findByText('Aplikasi desktop baru tersedia untuk Windows'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Unduh untuk/ })).toBeNull();
    expect(screen.getAllByRole('link', { name: /x64/ }).length).toBeGreaterThan(0);
  });

  test('versi terbaru tanpa installer untuk arsitektur itu: tanpa tombol utama', async () => {
    renderPage(
      { enabled: true, releases: [release('1.2.0', ['x64'])] },
      { os: 'windows', arch: 'arm64' },
    );
    expect(
      await screen.findByText('Aplikasi desktop baru tersedia untuk Windows'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Unduh untuk/ })).toBeNull();
  });

  test('catatan rilis ditampilkan sebagai teks biasa, bukan markup', async () => {
    const dangerous = { ...release('1.2.0'), changelog: '<script>alert(1)</script> **tebal**' };
    const { container } = renderPage({ enabled: true, releases: [dangerous] }, WIN_X64);
    expect(
      await screen.findByText(/<script>alert\(1\)<\/script> \*\*tebal\*\*/),
    ).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
  });

  test('teks bantuan peringatan Windows dan perintah Get-FileHash tampil', async () => {
    renderPage({ enabled: true, releases: [release('1.2.0')] }, WIN_X64);
    expect(await screen.findByText(/penerbit tak dikenal/)).toBeInTheDocument();
    expect(screen.getByText(/Get-FileHash -Algorithm SHA512/)).toBeInTheDocument();
  });

  test('Salin checksum menyalin heksadesimal berkas itu dan menampilkan Tersalin', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderPage({ enabled: true, releases: [release('1.2.0')] }, WIN_X64);
    const buttons = await screen.findAllByRole('button', { name: /Salin checksum x64/ });
    await userEvent.click(buttons[0] as HTMLElement);
    expect(writeText).toHaveBeenCalledWith(sha('a'));
    expect(await screen.findByText('Tersalin')).toBeInTheDocument();
  });

  test.each([
    ['clipboard tak ada', undefined],
    [
      'writeText menolak',
      {
        writeText: async (_text: string) => {
          throw new Error('ditolak');
        },
      },
    ],
  ])('Salin gagal (%s): tidak melempar dan memberi tahu pengguna', async (_name, clipboard) => {
    vi.stubGlobal('navigator', { ...navigator, clipboard });
    renderPage({ enabled: true, releases: [release('1.2.0')] }, WIN_X64);
    const buttons = await screen.findAllByRole('button', { name: /Salin checksum x64/ });
    await userEvent.click(buttons[0] as HTMLElement);
    expect(await screen.findByText('Tidak bisa menyalin, salin manual')).toBeInTheDocument();
  });
});
