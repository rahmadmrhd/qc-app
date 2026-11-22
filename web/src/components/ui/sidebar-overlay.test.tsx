import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { Sidebar, SidebarProvider } from './sidebar';

afterEach(() => {
  window.innerWidth = 1024;
});

test('rentang overlay (768-959 px): ruang samping tetap rel ikon, sidebar terbuka melayang (z-40, bayangan), klik luar menutup', async () => {
  window.innerWidth = 800;
  const onOpenChange = vi.fn();
  const { container } = render(
    <SidebarProvider open onOpenChange={onOpenChange}>
      <Sidebar collapsible="icon">isi</Sidebar>
    </SidebarProvider>,
  );
  const gap = container.querySelector('[data-slot="sidebar-gap"]');
  expect(gap?.className).toContain('sidebar-overlay:w-(--sidebar-width-icon)');
  const panel = container.querySelector('[data-slot="sidebar-container"]');
  expect(panel?.className).toContain('sidebar-overlay:group-data-[state=expanded]:shadow-xl');
  const backdrop = container.querySelector('[data-slot="sidebar-backdrop"]') as HTMLElement;
  await userEvent.click(backdrop);
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(screen.getByText('isi')).toBeInTheDocument();
});

test('R13: di rentang overlay hanya lebar kontainer (rel 3 rem <-> 16 rem) dan bayangan yang beranimasi; z-index tetap', () => {
  window.innerWidth = 800;
  const { container } = render(
    <SidebarProvider open={false}>
      <Sidebar collapsible="icon">isi</Sidebar>
    </SidebarProvider>,
  );
  const panel = container.querySelector('[data-slot="sidebar-container"]') as HTMLElement;
  const cls = panel.className;
  // z-40 TETAP (bukan z-10 <-> z-40 yang berganti seketika): rel hanya menempati ruang samping 3 rem.
  expect(cls).toContain('sidebar-overlay:z-40');
  expect(cls).not.toContain('sidebar-overlay:group-data-[state=expanded]:z-40');
  // Tertutup = rel selebar 3 rem yang memotong isi; terbuka = 16 rem; keduanya dianimasikan (lebar + bayangan).
  expect(cls).toContain('sidebar-overlay:w-(--sidebar-width-icon)');
  expect(cls).toContain('sidebar-overlay:group-data-[state=expanded]:w-(--sidebar-width)');
  expect(cls).toContain('sidebar-overlay:overflow-hidden');
  expect(cls).toContain('transition-[left,right,width,box-shadow]');
  // Bayangan hanya saat terbuka (tak bocor di sebelah rel tertutup, memudar saat menutup).
  expect(cls).toContain('sidebar-overlay:group-data-[state=expanded]:shadow-xl');
  expect(cls).not.toMatch(/(?<![:\w-])shadow-xl/);
  // Isi tetap selebar penuh dan dipotong, bukan diperas (tak ada tata letak ulang saat lebar berubah).
  const inner = container.querySelector('[data-slot="sidebar-inner"]') as HTMLElement;
  expect(inner.className).toContain('sidebar-overlay:w-(--sidebar-width)');
  expect(inner.className).toContain('sidebar-overlay:shrink-0');
});

test('R13: backdrop selalu ada di rentang overlay dan memudar lewat opacity (bukan hidden <-> block), tak menangkap klik saat tertutup', () => {
  window.innerWidth = 800;
  const { container } = render(
    <SidebarProvider open={false}>
      <Sidebar collapsible="icon">isi</Sidebar>
    </SidebarProvider>,
  );
  const cls = (container.querySelector('[data-slot="sidebar-backdrop"]') as HTMLElement).className;
  expect(cls).toContain('sidebar-overlay:block');
  expect(cls).toContain('opacity-0');
  expect(cls).toContain('transition-opacity');
  expect(cls).toContain('duration-200');
  expect(cls).toContain('pointer-events-none');
  expect(cls).toContain('sidebar-overlay:group-data-[state=expanded]:opacity-100');
  expect(cls).toContain('sidebar-overlay:group-data-[state=expanded]:pointer-events-auto');
  expect(cls).not.toContain('group-data-[state=expanded]:block');
});

test('R13: di rentang overlay tak ada mode ikon (data-collapsible kosong di kedua keadaan); layar lebar tetap mode ikon saat terlipat', () => {
  const collapsible = (width: number, open: boolean) => {
    window.innerWidth = width;
    const { container, unmount } = render(
      <SidebarProvider open={open}>
        <Sidebar collapsible="icon">isi</Sidebar>
      </SidebarProvider>,
    );
    const value = container
      .querySelector('[data-slot="sidebar"]')
      ?.getAttribute('data-collapsible');
    unmount();
    return value;
  };
  expect(collapsible(800, false)).toBe('');
  expect(collapsible(800, true)).toBe('');
  expect(collapsible(1200, false)).toBe('icon');
  expect(collapsible(1200, true)).toBe('');
});

test('R13: mengubah ukuran jendela lintas rentang menukar mode ikon <-> rel yang dipotong', () => {
  window.innerWidth = 1200;
  const { container } = render(
    <SidebarProvider open={false}>
      <Sidebar collapsible="icon">isi</Sidebar>
    </SidebarProvider>,
  );
  const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement;
  expect(sidebar).toHaveAttribute('data-collapsible', 'icon');
  act(() => {
    window.innerWidth = 800;
    window.dispatchEvent(new Event('resize'));
  });
  expect(sidebar).toHaveAttribute('data-collapsible', '');
  act(() => {
    window.innerWidth = 1200;
    window.dispatchEvent(new Event('resize'));
  });
  expect(sidebar).toHaveAttribute('data-collapsible', 'icon');
});

function Harness({ initial = true }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <button type="button" data-sidebar="trigger">
        pemicu
      </button>
      <Sidebar collapsible="icon">
        <button type="button">dalam</button>
      </Sidebar>
      <button type="button">isi halaman</button>
    </SidebarProvider>
  );
}

test('rentang overlay: Escape menutup sidebar dan fokus kembali ke pemicu', async () => {
  window.innerWidth = 800;
  const { container } = render(<Harness />);
  const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement;
  expect(sidebar).toHaveAttribute('data-state', 'expanded');
  screen.getByRole('button', { name: 'dalam' }).focus();
  await userEvent.keyboard('{Escape}');
  expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  expect(screen.getByRole('button', { name: 'pemicu' })).toHaveFocus();
});

test('rentang overlay: fokus keluar dari sidebar (Tab ke isi) menutupnya', async () => {
  window.innerWidth = 800;
  const { container } = render(<Harness />);
  const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement;
  screen.getByRole('button', { name: 'dalam' }).focus();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'isi halaman' })).toHaveFocus();
  expect(sidebar).toHaveAttribute('data-state', 'collapsed');
});

test('layar lebar tersemat (>= 960 px): Escape dan fokus keluar tidak menutup sidebar', async () => {
  window.innerWidth = 1200;
  const { container } = render(<Harness />);
  const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement;
  screen.getByRole('button', { name: 'dalam' }).focus();
  await userEvent.keyboard('{Escape}');
  await userEvent.tab();
  expect(sidebar).toHaveAttribute('data-state', 'expanded');
});
