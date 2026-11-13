import type { MeDto } from '@shared/contract';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// Komponen aplikasi NYATA (pemilih lokasi, lonceng, tema, menu profil) dengan Radix nyata; hanya data di luarnya di-mock.
const state = vi.hoisted(() => ({ mark: vi.fn(), install: 'prompt' as 'prompt' | 'unavailable' }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: '/' } }),
}));
vi.mock('@/modules/auth/use-me', () => ({
  useMe: () =>
    ({
      email: 'rina@qc.local',
      name: 'Rina',
      isSuperAdmin: false,
      permissions: {},
      locations: [],
      businessUnits: [],
      sharedAccount: false,
    }) as unknown as MeDto,
}));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({
    available: [
      { id: 'l1', name: 'Gudang A', code: 'GA' },
      { id: 'l2', name: 'Gudang B', code: 'GB' },
    ],
    selectedIds: ['l1'],
    toggle: () => undefined,
  }),
}));
vi.mock('../../lib/use-guide-store', () => ({
  useGuideStore: () => ({ ready: true, done: new Map(), mark: state.mark, reset: vi.fn() }),
}));
vi.mock('@/app/pwa/install', () => ({
  useInstall: () => ({ state: state.install, install: vi.fn() }),
}));
vi.mock('@/modules/auth/use-logout', () => ({ useLogout: () => vi.fn() }));
vi.mock('@/modules/push/components/push-settings-dialog', () => ({
  PushSettingsDialog: () => null,
}));
vi.mock('@/modules/guide/components/guide-menu-dialog', () => ({ GuideMenuDialog: () => null }));
vi.mock('@/modules/notification/queries', () => ({
  notificationsQueryOptions: () => ({
    queryKey: ['notifications'],
    queryFn: async () => ({ unread: 0, items: [] }),
  }),
  useMarkRead: () => ({ mutate: vi.fn() }),
  useMarkAllRead: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserMenu } from '@/app/shell/user-menu';
import { LocationPicker } from '@/modules/location/location-picker';
import { NotificationBell } from '@/modules/notification/notification-bell';
import { ThemeProvider } from '@/modules/theme/theme-provider';
import { ThemeToggle } from '@/modules/theme/theme-toggle';
import type { GuideEntry, GuideStep } from '../../lib/types';
import { TourProvider, useTour } from './tour-provider';

let startTour: (entry: GuideEntry) => void = () => undefined;
function Capture() {
  startTour = useTour().start;
  return null;
}

function step(overrides: Partial<GuideStep>): GuideStep {
  return { target: 'x', text: 'Teks', advance: 'next', ...overrides };
}

function Page() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider>
        <TourProvider targetWaitMs={400}>
          <Capture />
          <LocationPicker />
          <NotificationBell />
          <ThemeToggle />
          <UserMenu />
        </TourProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function start(...steps: GuideStep[]) {
  act(() =>
    startTour({
      id: 'dasar-layout',
      kind: 'dasar',
      status: 'disimpan',
      version: 1,
      title: 'Uji',
      steps,
    }),
  );
}

beforeAll(async () => {
  await import('./tour-overlay');
}, 30_000);

beforeEach(() => {
  state.mark.mockReset().mockResolvedValue(undefined);
  state.install = 'prompt';
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  document.body.style.pointerEvents = '';
});

const find = (text: string) => screen.findByText(text, {}, { timeout: 5000 });

describe('komponen aplikasi nyata dibuka tur', () => {
  test('pemilih lokasi: daftar lokasi terbuka dan disorot', async () => {
    render(<Page />);
    start(step({ buka: 'location-picker', target: 'location-menu', text: 'Daftar lokasi' }));
    expect(await find('Daftar lokasi')).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: /Gudang B/ })).toBeInTheDocument();
  });

  test('lonceng: isi popover terbuka', async () => {
    render(<Page />);
    start(step({ buka: 'notification-bell', target: 'notification-menu', text: 'Kabar terbaru' }));
    expect(await find('Kabar terbaru')).toBeInTheDocument();
    expect(await screen.findByText('Belum ada notifikasi.')).toBeInTheDocument();
  });

  test('tema: pilihan tema terbuka', async () => {
    render(<Page />);
    start(step({ buka: 'theme-toggle', target: 'theme-menu', text: 'Pilihan tema' }));
    expect(await find('Pilihan tema')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Gelap/ })).toBeInTheDocument();
  });

  test('menu profil: akun, butir Pasang aplikasi, dan butir Notifikasi push dapat disorot satu per satu', async () => {
    render(<Page />);
    start(
      step({ buka: 'user-menu', target: 'user-menu-account', text: 'Akun' }),
      step({ buka: 'user-menu', target: 'user-menu-install', text: 'Pasang' }),
      step({ buka: 'user-menu', target: 'user-menu-push', text: 'Push' }),
    );
    expect(await find('Akun')).toBeInTheDocument();
    expect(screen.getByText('rina@qc.local')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(await find('Pasang')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(await find('Push')).toBeInTheDocument();
    // Murni UI: tak ada butir yang terpilih/terjalankan oleh tur.
    expect(screen.getByRole('menuitem', { name: 'Pasang aplikasi' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Keluar' })).toBeNull());
  });

  test('butir bersyarat tak ada (pemasangan tak tersedia): langkahnya dilewati', async () => {
    state.install = 'unavailable';
    render(<Page />);
    start(
      step({ buka: 'user-menu', target: 'user-menu-install', text: 'Pasang' }),
      step({ buka: 'user-menu', target: 'user-menu-push', text: 'Push' }),
    );
    expect(await find('Push')).toBeInTheDocument();
    expect(screen.queryByText('Pasang')).toBeNull();
  });
});
