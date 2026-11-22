import type { MeDto } from '@shared/contract';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { GuideEntry } from '@/modules/guide/lib/types';

const state = vi.hoisted(() => ({ pathname: '/', mark: vi.fn() }));
const stubs = vi.hoisted(() => ({
  make: (name: string) => () => <div data-testid={name} />,
}));

vi.mock('@tanstack/react-router', async () => {
  const { useTour } = await import('@/modules/guide/components/tour/tour-provider');
  const entry: GuideEntry = {
    id: 'dasar-layout',
    kind: 'dasar',
    status: 'disimpan',
    version: 1,
    title: 'Uji',
    steps: [{ target: 'sorot', text: 'Teks sorotan', advance: 'next', tip: 'tip-shell-uji' }],
  };
  function Outlet() {
    const tour = useTour();
    return (
      <div>
        <button type="button" data-tour="sorot" onClick={() => tour.start(entry)}>
          Mulai dari anak
        </button>
        <span>{tour.active ? 'tur aktif' : 'tur diam'}</span>
      </div>
    );
  }
  return {
    Outlet,
    useMatches: () => [],
    useNavigate: () => vi.fn(),
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: state.pathname } }),
  };
});
vi.mock('@/modules/auth/use-me', () => ({
  useMe: () =>
    ({
      email: 'a@qc.local',
      name: 'A',
      isSuperAdmin: false,
      permissions: {},
      locations: [],
      businessUnits: [],
      sharedAccount: false,
    }) as unknown as MeDto,
}));
vi.mock('@/modules/location/active-locations-context', () => ({
  ActiveLocationsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useActiveLocations: () => ({ available: [], selectedIds: [], toggle: () => undefined }),
}));
vi.mock('@/modules/guide/lib/use-guide-store', () => ({
  useGuideStore: () => ({ ready: true, done: new Map(), mark: state.mark, reset: vi.fn() }),
}));
vi.mock('../prefetch', () => ({ usePrefetchOnIdle: () => undefined }));
vi.mock('./app-sidebar', async () => {
  const { useSidebar } = await import('@/components/ui/sidebar');
  return {
    AppSidebar: () => <div data-testid="sidebar" data-state={useSidebar().state} />,
  };
});
vi.mock('./app-breadcrumb', () => ({ AppBreadcrumb: stubs.make('breadcrumb') }));
vi.mock('./user-menu', () => ({ UserMenu: stubs.make('user-menu') }));
vi.mock('@/modules/location/location-picker', () => ({ LocationPicker: stubs.make('picker') }));
vi.mock('@/modules/notification/notification-bell', () => ({
  NotificationBell: stubs.make('bell'),
}));
vi.mock('@/modules/theme/theme-toggle', () => ({ ThemeToggle: stubs.make('theme') }));
vi.mock('@/modules/push/components/push-onboarding', () => ({
  PushOnboarding: stubs.make('push'),
}));
vi.mock('@/modules/guide/components/guide-banner', () => ({
  GuideBanner: stubs.make('guide-banner'),
}));
vi.mock('@/modules/guide/components/guide-greeting', () => ({
  GuideGreeting: stubs.make('greeting'),
}));

import { registerDemoLoader } from '@/modules/guide/lib/demo-types';
import { AppShell } from './app-shell';
import { readSidebarState, SIDEBAR_STORAGE_KEY } from './sidebar-state';

// Dimuat malas (belum pernah dimuat saat tur dimulai), seperti demo Serah Terima yang sebenarnya.
registerDemoLoader('tip-shell-uji', async () => [
  { kind: 'kode', caption: 'Keterangan demo cangkang', durationMs: 5000, render: () => <p>isi</p> },
]);

// Pemuatan malas pertama (kompilasi modul) bisa lebih lama dari batas findBy bawaan; panaskan dulu.
beforeAll(async () => {
  await import('@/modules/guide/components/tour/tour-overlay');
}, 30_000);

beforeEach(() => {
  localStorage.clear();
  state.pathname = '/';
  state.mark.mockReset().mockResolvedValue(undefined);
  // SidebarProvider (useIsMobile) membutuhkan matchMedia yang tidak ada di jsdom.
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

test('TourProvider terpasang: anak AppShell dapat memulai tur dan tur menyorot UI', async () => {
  render(<AppShell />);
  expect(screen.getByText('tur diam')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Mulai dari anak' }));
  expect(await screen.findByRole('dialog', { name: 'Panduan' })).toBeInTheDocument();
  expect(await screen.findByText('Teks sorotan')).toBeInTheDocument();
  expect(screen.getByText('tur aktif')).toBeInTheDocument();
});

test('langkah ber-tip menampilkan pemutar demo bila adegannya terdaftar', async () => {
  render(<AppShell />);
  await userEvent.click(screen.getByRole('button', { name: 'Mulai dari anak' }));
  expect(
    await screen.findByText('Keterangan demo cangkang', {}, { timeout: 5000 }),
  ).toBeInTheDocument();
}, 15_000);

test('GuideGreeting dipasang di cangkang', () => {
  render(<AppShell />);
  expect(screen.getByTestId('greeting')).toBeInTheDocument();
});

test('GuideBanner dipasang di atas area utama', () => {
  render(<AppShell />);
  const banner = screen.getByTestId('guide-banner');
  // SidebarInset dan AppShell sama-sama <main> (bersarang): yang terdalam memuat Outlet.
  const main = screen.getAllByRole('main').at(-1) as HTMLElement;
  expect(banner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('area utama boleh menyusut (min-w-0): tabel lebar menggulir di wadahnya, bukan melebarkan halaman', () => {
  render(<AppShell />);
  const inset = document.querySelector('[data-slot="sidebar-inset"]');
  expect(inset?.classList.contains('min-w-0')).toBe(true);
});

test('sidebar tersimpan terlipat dirender collapsed; SidebarTrigger menyimpan keadaan terbuka', async () => {
  localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ open: false }));
  render(<AppShell />);
  expect(screen.getByTestId('sidebar')).toHaveAttribute('data-state', 'collapsed');
  await userEvent.click(screen.getByRole('button', { name: /Toggle Sidebar/i }));
  expect(screen.getByTestId('sidebar')).toHaveAttribute('data-state', 'expanded');
  expect(readSidebarState()).toEqual({ open: true });
});

test('tanpa penyimpanan sidebar terbuka dan tidak menulis cookie sidebar_state', () => {
  render(<AppShell />);
  expect(screen.getByTestId('sidebar')).toHaveAttribute('data-state', 'expanded');
  expect(document.cookie).not.toContain('sidebar_state');
});

test('isi halaman dibungkus PageContainer rata tengah berlebar bawaan', () => {
  render(<AppShell />);
  const main = screen.getAllByRole('main').at(-1) as HTMLElement;
  const container = main.firstElementChild as HTMLElement;
  expect(container.className).toContain('mx-auto');
  expect(container.className).toContain('max-w-7xl');
});

test('butir 41: di ponsel judul ada di header di sebelah tombol menu, tanpa baris breadcrumb dan tanpa tombol tema', () => {
  window.innerWidth = 360;
  window.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  const { container } = render(<AppShell />);
  expect(container.querySelector('[data-slot="phone-breadcrumb"]')).toBeNull();
  expect(container.querySelector('header [data-slot="sidebar-trigger"]')).not.toBeNull();
  expect(container.querySelector('header [aria-label="Ganti tema"]')).toBeNull();
  window.innerWidth = 1024;
});

test('B12: pada rentang overlay (768-959 px) sidebar mulai tertutup dan buka/tutup tak mengubah pilihan tersimpan', async () => {
  window.innerWidth = 800;
  localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ open: true }));
  render(<AppShell />);
  expect(screen.getByTestId('sidebar')).toHaveAttribute('data-state', 'collapsed');
  await userEvent.click(screen.getByRole('button', { name: /Toggle Sidebar/i }));
  expect(screen.getByTestId('sidebar')).toHaveAttribute('data-state', 'expanded');
  // Pilihan tersimpan (untuk layar lebar) tak berubah.
  expect(readSidebarState()).toEqual({ open: true });
  await userEvent.click(screen.getByRole('button', { name: /Toggle Sidebar/i }));
  expect(readSidebarState()).toEqual({ open: true });
  window.innerWidth = 1024;
});

test('B12/D2: ukuran jendela berubah lintas rentang overlay menyinkronkan keadaan terbuka (tanpa menulis pilihan tersimpan)', async () => {
  window.innerWidth = 1024;
  localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ open: true }));
  render(<AppShell />);
  expect(screen.getByTestId('sidebar')).toHaveAttribute('data-state', 'expanded');
  // Tablet diputar ke 800 px: masuk rentang overlay, sidebar menutup sendiri (tak menutupi isi dengan latar gelap).
  window.innerWidth = 800;
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
  });
  expect(screen.getByTestId('sidebar')).toHaveAttribute('data-state', 'collapsed');
  expect(readSidebarState()).toEqual({ open: true });
  // Kembali lebar: pilihan tersimpan (terbuka) dipulihkan.
  window.innerWidth = 1200;
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
  });
  expect(screen.getByTestId('sidebar')).toHaveAttribute('data-state', 'expanded');
  // Pilihan tersimpan tertutup: tetap tertutup saat kembali lebar.
  window.innerWidth = 800;
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
  });
  localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ open: false }));
  window.innerWidth = 1200;
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
  });
  expect(screen.getByTestId('sidebar')).toHaveAttribute('data-state', 'collapsed');
  window.innerWidth = 1024;
});
