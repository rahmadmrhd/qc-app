import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { Sidebar, SidebarProvider } from './sidebar';

afterEach(() => {
  window.innerWidth = 1024;
});

test('rentang overlay (768-959 px): ruang samping = rel ikon, sidebar terbuka melayang (z-40, bayangan), klik luar menutup', async () => {
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
  expect(panel?.className).toContain('sidebar-overlay:group-data-[state=expanded]:z-40');
  expect(panel?.className).toContain('sidebar-overlay:group-data-[state=expanded]:shadow-xl');
  const backdrop = container.querySelector('[data-slot="sidebar-backdrop"]') as HTMLElement;
  expect(backdrop.className).toContain('sidebar-overlay:group-data-[state=expanded]:block');
  await userEvent.click(backdrop);
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(screen.getByText('isi')).toBeInTheDocument();
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
