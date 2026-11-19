import type { MeDto } from '@shared/contract';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { GuideEntry } from '@/modules/guide/lib/types';

const state = vi.hoisted(() => ({
  offers: [] as { entry: GuideEntry; stepCount: number }[],
  ready: true,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useMatchRoute: () => () => false,
}));
vi.mock('@/modules/auth/use-me', () => ({
  useMe: () =>
    ({
      email: 'a@qc.local',
      name: 'A',
      isSuperAdmin: false,
      permissions: { item: 'view' },
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

function offer(id: string, halaman: string): { entry: GuideEntry; stepCount: number } {
  return {
    entry: { id, kind: 'dasar', status: 'disimpan', version: 1, title: id, halaman, steps: [] },
    stepCount: 2,
  };
}

function Tree() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </TooltipProvider>
  );
}

function renderSidebar() {
  return render(<Tree />);
}

beforeEach(() => {
  state.offers = [];
  state.ready = true;
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

describe('AppSidebar titik panduan', () => {
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
    expect(screen.getByLabelText('Ada panduan')).toBeInTheDocument();
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
