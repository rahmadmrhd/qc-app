import type { MeDto } from '@shared/contract';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/modules/auth/use-me', () => ({
  useMe: () =>
    ({
      email: 'a@qc.local',
      name: 'A',
      isSuperAdmin: false,
      permissions: { item: 'none', sticker: 'view' },
      locations: [],
      businessUnits: [],
      sharedAccount: false,
    }) as unknown as MeDto,
}));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ available: [], selectedIds: [], toggle: () => undefined }),
}));

import { Launcher } from './launcher';

test('peluncur: ubin hanya untuk menu yang boleh dibuka, tanpa Beranda, dan dapat dicari', async () => {
  render(<Launcher />);
  expect(screen.queryByRole('link', { name: /Beranda/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /Daftar Item/ })).toBeNull();
  const links = screen.getAllByRole('link');
  expect(links.length).toBeGreaterThan(0);
  const search = screen.getByRole('searchbox', { name: 'Cari menu' });
  await userEvent.type(search, 'zzzzzz');
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.getByText('Tidak ada menu yang cocok.')).toBeInTheDocument();
});

test('peluncur tidak memuat riwayat, favorit, atau "terbaru"', () => {
  render(<Launcher />);
  expect(screen.queryByText(/terbaru|favorit|riwayat/i)).toBeNull();
});
