import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';

test('R10: lebar menu mengikuti butir terpanjang, lantai 8 rem (14 rem di layar sentuh), tak melewati layar', async () => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>pemicu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Catat keluar</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'pemicu' }));
  const menu = await screen.findByRole('menu');
  const cls = menu.className;
  // Bukan lagi selebar pemicu (pemicu ikon 32 px = lantai 8 rem saja).
  expect(cls).not.toContain('w-(--radix-dropdown-menu-trigger-width)');
  expect(cls).toContain('w-max');
  expect(cls).toContain('min-w-[max(var(--radix-dropdown-menu-trigger-width),8rem)]');
  expect(cls).toContain('touch:min-w-56');
  expect(cls).toContain('max-w-[calc(100dvw-1rem)]');
});

test('R10: collisionPadding bawaan 8 px agar menu tak menempel tepi layar; pemakai dapat menimpa', () => {
  const props = (element: unknown) =>
    (element as { props: { children: { props: { collisionPadding?: number } } } }).props.children
      .props;
  expect(props(DropdownMenuContent({})).collisionPadding).toBe(8);
  expect(props(DropdownMenuContent({ collisionPadding: 0 })).collisionPadding).toBe(0);
});

test('pemakai yang menimpa lebar (mis. w-56) tetap menang atas bawaan', async () => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>pemicu</DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuItem>Satu</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'pemicu' }));
  const menu = await screen.findByRole('menu');
  expect(menu.className).toContain('w-56');
  expect(menu.className).not.toContain('w-max');
});
