import type { MeDto } from '@shared/contract';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { GuideEntry } from '@/modules/guide/lib/types';

const state = vi.hoisted(() => ({
  offers: [] as { entry: GuideEntry; stepCount: number }[],
  ready: true,
  path: '/',
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useMatchRoute:
    () =>
    ({ to, fuzzy }: { to: string; fuzzy?: boolean }) =>
      fuzzy ? state.path.startsWith(to) : state.path === to,
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
  useOfferedGuides: () => ({ ready: state.ready, offers: state.ready ? state.offers : [] }),
}));

import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppSidebar } from './app-sidebar';
import { readSidebarState, SIDEBAR_STORAGE_KEY } from './sidebar-state';

function offer(id: string, halaman: string): { entry: GuideEntry; stepCount: number } {
  return {
    entry: { id, kind: 'dasar', status: 'disimpan', version: 1, title: id, halaman, steps: [] },
    stepCount: 2,
  };
}

function Tree({ open = true }: { open?: boolean }) {
  return (
    <TooltipProvider>
      <SidebarProvider open={open}>
        <AppSidebar />
      </SidebarProvider>
    </TooltipProvider>
  );
}

function renderSidebar(open = true) {
  return render(<Tree open={open} />);
}

beforeEach(() => {
  localStorage.clear();
  state.path = '/';
  state.offers = [];
  state.ready = true;
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

describe('AppSidebar titik panduan', () => {
  beforeEach(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ open: true, expanded: ['item'] }));
  });

  test('titik muncul pada item yang punya panduan belum selesai, tidak pada item lain', () => {
    state.offers = [offer('item-dasar', '/item')];
    renderSidebar();
    const dataItem = screen.getByRole('link', { name: /Daftar Item/ });
    expect(within(dataItem).getByLabelText('Ada panduan')).toBeInTheDocument();
    const merk = screen.getByRole('link', { name: /Merk/ });
    expect(within(merk).queryByLabelText('Ada panduan')).toBeNull();
  });

  test('titik hilang setelah panduan selesai (tak lagi ditawarkan)', () => {
    state.offers = [offer('item-dasar', '/item')];
    const view = renderSidebar();
    expect(screen.getAllByLabelText('Ada panduan').length).toBeGreaterThan(0);
    state.offers = [];
    view.rerender(<Tree />);
    expect(screen.queryByLabelText('Ada panduan')).toBeNull();
  });

  test('tanpa penawaran atau belum ready: tidak ada titik', () => {
    state.ready = false;
    state.offers = [offer('item-dasar', '/item')];
    renderSidebar();
    expect(screen.queryByLabelText('Ada panduan')).toBeNull();
  });
});

describe('AppSidebar submenu', () => {
  test('klik induk membuka submenu dan menyimpan id ke qc.sidebar', async () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: 'Merk' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Item' }));
    expect(await screen.findByRole('link', { name: 'Daftar Item' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Merk' })).toBeInTheDocument();
    expect(readSidebarState().expanded).toContain('item');
  });

  test('rute aktif di bawah induk membuatnya terbuka walau tak tersimpan', () => {
    state.path = '/item/brands';
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Merk' })).toBeInTheDocument();
    expect(readSidebarState().expanded).toEqual([]);
  });

  test('butir induk bukan tautan (tanpa href)', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: 'Item' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Item' })).not.toHaveAttribute('href');
  });

  test('mode ikon: Enter pada induk membuka menu anak, Escape menutupnya', async () => {
    // Pengguna Stiker (sticker view) memuat induk Stiker dengan Katalog dan Jenis.
    renderSidebar(false);
    const parent = screen.getByRole('button', { name: 'Stiker' });
    parent.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: /Katalog/ })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: /Katalog/ })).toBeNull());
  });

  test('titik panduan pada induk bila salah satu anak punya panduan', () => {
    state.offers = [offer('item-dasar', '/item/brands')];
    renderSidebar();
    const parent = screen.getByRole('button', { name: /Item/ });
    expect(within(parent).getByLabelText('Ada panduan')).toBeInTheDocument();
  });
});
