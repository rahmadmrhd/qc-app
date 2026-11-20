import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { GuideEntry } from '../lib/types';

const state = vi.hoisted(() => ({
  ready: true,
  offers: [] as { entry: GuideEntry; stepCount: number; updated?: boolean }[],
  pathname: '/handover',
  tourActive: false,
  blocking: false,
  start: vi.fn(),
  mark: vi.fn(),
}));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: state.pathname } }),
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => ({ email: 'a@qc.local' }) }));
vi.mock('../lib/use-offered-guides', () => ({
  useOfferedGuides: () => ({ ready: state.ready, offers: state.ready ? state.offers : [] }),
}));
vi.mock('../lib/use-guide-store', () => ({
  useGuideStore: () => ({ ready: true, done: new Map(), mark: state.mark, reset: vi.fn() }),
}));
vi.mock('./tour/tour-provider', () => ({
  useTour: () => ({ start: state.start, active: state.tourActive }),
}));
vi.mock('@/modules/push/components/push-onboarding', () => ({
  useBlockingOnboardingActive: () => state.blocking,
}));

import { GuideBanner, pageLabelFor } from './guide-banner';

function entry(overrides: Partial<GuideEntry> = {}): GuideEntry {
  return {
    id: 'handover-dasar',
    kind: 'dasar',
    status: 'disimpan',
    version: 2,
    title: 'Dasar Serah Terima',
    halaman: '/handover',
    covers: ['tip-handover-tempel-wa'],
    steps: [],
    ...overrides,
  };
}

beforeEach(() => {
  sessionStorage.clear();
  state.ready = true;
  state.pathname = '/handover';
  state.tourActive = false;
  state.blocking = false;
  state.offers = [{ entry: entry(), stepCount: 4 }];
  state.start.mockReset();
  state.mark.mockReset().mockResolvedValue(undefined);
});

describe('GuideBanner', () => {
  test('menampilkan teks, jumlah langkah, dan tiga tombol di halaman yang cocok', () => {
    render(<GuideBanner />);
    const banner = screen.getByTestId('guide-banner');
    expect(banner).toHaveTextContent('Pertama kali di Serah Terima?');
    expect(banner).toHaveAttribute('data-slot', 'alert');
    expect(banner).toHaveAttribute('data-color', 'info');
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveTextContent('Ada panduan 4 langkah.');
    expect(screen.getByRole('button', { name: 'Mulai' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nanti' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sudah paham' })).toBeInTheDocument();
  });

  test('N1: panduan yang diperbarui menampilkan label "Diperbarui"', () => {
    state.offers = [{ entry: entry(), stepCount: 4, updated: true }];
    render(<GuideBanner />);
    expect(screen.getByTestId('guide-banner')).toHaveTextContent('Diperbarui');
  });

  test('N1: panduan baru pertama kali tanpa label "Diperbarui"', () => {
    render(<GuideBanner />);
    expect(screen.getByTestId('guide-banner')).not.toHaveTextContent('Diperbarui');
  });

  test('cocok juga di anak rute halaman', () => {
    state.pathname = '/handover/new';
    render(<GuideBanner />);
    expect(screen.getByTestId('guide-banner')).toBeInTheDocument();
  });

  test('tidak tampil di halaman lain', () => {
    state.pathname = '/item';
    render(<GuideBanner />);
    expect(screen.queryByTestId('guide-banner')).toBeNull();
  });

  test('Mulai menjalankan panduan tanpa menulis penanda', async () => {
    render(<GuideBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Mulai' }));
    expect(state.start).toHaveBeenCalledWith(state.offers[0]?.entry);
    expect(state.mark).not.toHaveBeenCalled();
  });

  test('Nanti menyembunyikan banner, tercatat di sessionStorage, tanpa mark', async () => {
    const view = render(<GuideBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Nanti' }));
    expect(screen.queryByTestId('guide-banner')).toBeNull();
    expect(state.mark).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('qc.guide.later:a@qc.local')).toContain('handover-dasar');
    // Muat ulang dalam sesi tab yang sama: tetap tersembunyi.
    view.unmount();
    render(<GuideBanner />);
    expect(screen.queryByTestId('guide-banner')).toBeNull();
  });

  test('Sudah paham menulis mark(id, version, covers) lalu menyembunyikan banner', async () => {
    render(<GuideBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Sudah paham' }));
    expect(state.mark).toHaveBeenCalledTimes(1);
    expect(state.mark).toHaveBeenCalledWith('handover-dasar', 2, ['tip-handover-tempel-wa']);
    await waitFor(() => expect(screen.queryByTestId('guide-banner')).toBeNull());
  });

  test('tidak tampil saat tur berjalan', () => {
    state.tourActive = true;
    render(<GuideBanner />);
    expect(screen.queryByTestId('guide-banner')).toBeNull();
  });

  test('tidak tampil saat dialog atau banner PushOnboarding tampil', () => {
    state.blocking = true;
    render(<GuideBanner />);
    expect(screen.queryByTestId('guide-banner')).toBeNull();
  });

  test('tidak tampil bila belum ready', () => {
    state.ready = false;
    render(<GuideBanner />);
    expect(screen.queryByTestId('guide-banner')).toBeNull();
  });

  test('hanya satu banner walau beberapa panduan cocok (yang pertama)', () => {
    state.offers = [
      { entry: entry({ id: 'satu', title: 'Satu' }), stepCount: 1 },
      { entry: entry({ id: 'dua', title: 'Dua' }), stepCount: 2 },
    ];
    render(<GuideBanner />);
    expect(screen.getAllByTestId('guide-banner')).toHaveLength(1);
    expect(screen.getByTestId('guide-banner')).toHaveTextContent('1 langkah');
  });

  test('yang disembunyikan sesi ini memberi giliran pada panduan berikutnya yang cocok', async () => {
    state.offers = [
      { entry: entry({ id: 'satu', title: 'Satu' }), stepCount: 1 },
      { entry: entry({ id: 'dua', title: 'Dua' }), stepCount: 2 },
    ];
    render(<GuideBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Nanti' }));
    expect(screen.getByTestId('guide-banner')).toHaveTextContent('2 langkah');
  });

  test('sessionStorage terblokir: Nanti tetap menyembunyikan banner di sesi halaman ini', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('penuh');
    });
    render(<GuideBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Nanti' }));
    expect(screen.queryByTestId('guide-banner')).toBeNull();
    vi.restoreAllMocks();
  });
});

describe('pageLabelFor', () => {
  test('label anak generik digabung dengan label induknya', () => {
    expect(pageLabelFor('/serial', 'Judul')).toBe('Daftar Serial Number');
    expect(pageLabelFor('/serial/reports', 'Judul')).toBe('Laporan Serial Number');
    expect(pageLabelFor('/serial/settings', 'Judul')).toBe('Pengaturan Serial Number');
  });

  test('label anak spesifik dan butir tingkat atas tetap apa adanya; tak dikenal = judul', () => {
    expect(pageLabelFor('/item/brands', 'Judul')).toBe('Merk');
    expect(pageLabelFor('/handover', 'Judul')).toBe('Serah Terima');
    expect(pageLabelFor('/tidak-ada', 'Judul')).toBe('Judul');
    expect(pageLabelFor(undefined, 'Judul')).toBe('Judul');
  });
});
