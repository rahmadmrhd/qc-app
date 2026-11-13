import type { MeDto } from '@shared/contract';
import { render, screen } from '@testing-library/react';
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
vi.mock('./app-sidebar', () => ({ AppSidebar: stubs.make('sidebar') }));
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

// Dimuat malas (belum pernah dimuat saat tur dimulai), seperti demo Serah Terima yang sebenarnya.
registerDemoLoader('tip-shell-uji', async () => [
  { kind: 'kode', caption: 'Keterangan demo cangkang', durationMs: 5000, render: () => <p>isi</p> },
]);

// Pemuatan malas pertama (kompilasi modul) bisa lebih lama dari batas findBy bawaan; panaskan dulu.
beforeAll(async () => {
  await import('@/modules/guide/components/tour/tour-overlay');
}, 30_000);

beforeEach(() => {
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
