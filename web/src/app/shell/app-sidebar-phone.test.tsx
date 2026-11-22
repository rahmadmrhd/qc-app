import type { MeDto } from '@shared/contract';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const navigate = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    onClick,
    ...props
  }: {
    to: string;
    children: React.ReactNode;
    onClick?: (event: React.MouseEvent) => void;
  }) => (
    <a href={to} onClick={onClick} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ navigate }),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: '/' } }),
  useMatchRoute: () => () => false,
}));
vi.mock('@/modules/auth/use-me', () => ({
  useMe: () =>
    ({
      email: 'a@qc.local',
      name: 'A',
      isSuperAdmin: false,
      permissions: { item: 'view', sticker: 'view' },
      locations: [],
      businessUnits: [],
      sharedAccount: false,
    }) as unknown as MeDto,
}));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ available: [], selectedIds: [], toggle: () => undefined }),
}));
vi.mock('@/modules/guide/lib/use-offered-guides', () => ({
  useOfferedGuides: () => ({ ready: true, offers: [] }),
}));

import { SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { mockMatchMedia } from '@/test/match-media';
import { AppSidebar } from './app-sidebar';

function OpenPanel() {
  const { setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(true), [setOpenMobile]);
  return null;
}

let media: ReturnType<typeof mockMatchMedia>;
beforeEach(() => {
  localStorage.clear();
  navigate.mockClear();
  window.innerWidth = 360;
  window.history.replaceState({ __TSR_key: 'p', __TSR_index: 1 }, '', '/');
  media = mockMatchMedia(false);
  render(
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <OpenPanel />
      </SidebarProvider>
    </TooltipProvider>,
  );
});
afterEach(() => {
  media.restore();
  window.innerWidth = 1024;
});

test('panel menu ponsel: kolom cari menyaring menurut nama butir/submenu dan menampilkan pesan kosong', async () => {
  const search = await screen.findByRole('searchbox', { name: 'Cari menu' });
  await userEvent.type(search, 'merk');
  expect(screen.getByRole('link', { name: 'Merk' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Beranda' })).toBeNull();
  await userEvent.clear(search);
  await userEvent.type(search, 'zzzz');
  expect(screen.getByText('Tidak ada menu yang cocok.')).toBeInTheDocument();
});

test('panel menu ponsel: memilih butir = replace (bukan push) ke tujuannya', async () => {
  await userEvent.click(await screen.findByRole('link', { name: 'Beranda' }));
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
  expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true });
});

test('P8: panel menu ponsel tidak memuat Aplikasi Desktop dan Country Lock', async () => {
  await screen.findByRole('searchbox', { name: 'Cari menu' });
  expect(screen.queryByRole('link', { name: 'Aplikasi Desktop' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Country Lock' })).toBeNull();
});
