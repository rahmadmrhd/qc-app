import type { MeDto } from '@shared/contract';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ path: '/' }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ navigate: () => Promise.resolve() }),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: state.path } }),
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
  useOfferedGuides: () => ({ ready: true, offers: [] }),
}));

import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppSidebar } from './app-sidebar';

function Tree({ open, onOpenChange }: { open: boolean; onOpenChange?: (open: boolean) => void }) {
  return (
    <TooltipProvider>
      <SidebarProvider open={open} onOpenChange={onOpenChange}>
        <AppSidebar />
      </SidebarProvider>
    </TooltipProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  state.path = '/';
  window.innerWidth = 800;
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  window.innerWidth = 1024;
});

describe('R13: AppSidebar di rentang overlay (rel ikon yang dipotong)', () => {
  test('tertutup: induk tetap pemicu Collapsible (tak berganti menjadi dropdown); mengetuknya membuka sidebar dan induk itu', async () => {
    const onOpenChange = vi.fn();
    render(<Tree open={false} onOpenChange={onOpenChange} />);
    // Anak induk bukan aktif: belum ada. Pohon yang sama dengan keadaan terbuka (tak ada pertukaran komponen).
    expect(screen.queryByRole('link', { name: 'Katalog' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Stiker' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(await screen.findByRole('link', { name: 'Katalog' })).toBeInTheDocument();
  });

  test('tertutup: induk aktif tetap menampilkan anaknya di DOM (disembunyikan lewat transisi CSS, bukan dilepas) dan ditandai aktif', () => {
    state.path = '/sticker';
    render(<Tree open={false} />);
    const link = screen.getByRole('link', { name: /Katalog/ });
    const content = link.closest('[data-slot="collapsible-content"]') as HTMLElement;
    expect(content).not.toBeNull();
    // Tinggi beranimasi (grid 1fr <-> 0fr) dan visibility mengikuti state sidebar: serentak dengan lebar kontainer.
    const cls = content.className;
    expect(cls).toContain('sidebar-overlay:grid');
    expect(cls).toContain('sidebar-overlay:transition-[grid-template-rows,visibility]');
    expect(cls).toContain('sidebar-overlay:duration-200');
    expect(cls).toContain('sidebar-overlay:group-data-[state=collapsed]:invisible');
    expect(cls).toContain('sidebar-overlay:group-data-[state=collapsed]:grid-rows-[0fr]');
    const list = content.querySelector('[data-slot="sidebar-menu-sub"]') as HTMLElement;
    expect(list.className).toContain('sidebar-overlay:min-h-0');
    expect(list.className).toContain('sidebar-overlay:overflow-hidden');
    // Rel: ikon induk aktif disorot (anaknya tak terlihat).
    expect(screen.getByRole('button', { name: /Stiker/ })).toHaveAttribute('data-active', 'true');
  });

  test('judul: "QC" selalu ada dan " App" memudar lewat opacity (satu elemen, tak ada teks yang bertukar seketika)', () => {
    render(<Tree open={false} />);
    const header = document.querySelector('[data-sidebar="header"] div') as HTMLElement;
    expect(header.textContent?.replace(/\s+/g, ' ').trim()).toBe('QC App');
    const app = header.querySelector('span') as HTMLElement;
    expect(app.className).toContain('transition-opacity');
    expect(app.className).toContain('sidebar-overlay:group-data-[state=collapsed]:opacity-0');
  });

  test('butir dan label grup menyempit/memudar lewat state sidebar (transisi), bukan data-collapsible=icon', () => {
    render(<Tree open={false} />);
    const button = screen.getAllByRole('link')[0]?.closest('[data-slot="sidebar-menu-button"]');
    expect(button?.className).toContain('sidebar-overlay:group-data-[state=collapsed]:w-8');
    const label = document.querySelector('[data-slot="sidebar-group-label"]') as HTMLElement;
    expect(label.className).toContain('sidebar-overlay:group-data-[state=collapsed]:-mt-8');
    expect(label.className).toContain('sidebar-overlay:group-data-[state=collapsed]:opacity-0');
    expect(label.className).toContain('transition-[margin,opacity]');
    expect(document.querySelector('[data-slot="sidebar"]')).toHaveAttribute('data-collapsible', '');
  });

  test('layar lebar terlipat tetap mode ikon dengan dropdown anak (tak berubah)', async () => {
    window.innerWidth = 1200;
    render(<Tree open={false} />);
    expect(document.querySelector('[data-slot="sidebar"]')).toHaveAttribute(
      'data-collapsible',
      'icon',
    );
    const parent = screen.getByRole('button', { name: 'Stiker' });
    parent.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: /Katalog/ })).toBeInTheDocument();
  });

  test('mengubah ukuran jendela dari lebar ke overlay mengganti dropdown anak menjadi pemicu Collapsible', async () => {
    window.innerWidth = 1200;
    render(<Tree open={false} />);
    act(() => {
      window.innerWidth = 800;
      window.dispatchEvent(new Event('resize'));
    });
    expect(document.querySelector('[data-slot="sidebar"]')).toHaveAttribute('data-collapsible', '');
    await userEvent.click(screen.getByRole('button', { name: 'Stiker' }));
    expect(await screen.findByRole('link', { name: 'Katalog' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
});
