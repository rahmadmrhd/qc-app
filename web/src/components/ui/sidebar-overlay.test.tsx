import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
