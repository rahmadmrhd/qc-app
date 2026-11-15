import type { MeDto } from '@shared/contract';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { NO_LOCATION_MESSAGE, NoLocationNotice } from './no-location-notice';

const location = {
  id: 'l1',
  code: 'JKT',
  name: 'Jakarta',
  permissions: { handover: 'view', qc: 'none', stock: 'none', stickerstock: 'none' },
} as const;

beforeEach(() => {
  me = {
    email: 'a@x.com',
    name: 'A',
    isSuperAdmin: false,
    sharedAccount: false,
    canManageSerialSettings: false,
    permissions: {} as MeDto['permissions'],
    businessUnits: [],
    locations: [],
  };
});

test('tanpa penugasan lokasi: peringatan tampil dengan teks jelas', () => {
  render(<NoLocationNotice />);
  expect(screen.getByRole('status')).toHaveTextContent(NO_LOCATION_MESSAGE);
  expect(NO_LOCATION_MESSAGE).toContain('belum ditugaskan ke lokasi mana pun');
  expect(NO_LOCATION_MESSAGE).toContain('Hubungi admin');
});

test('sudah punya lokasi, super admin, atau halaman tak bergantung: tidak tampil', () => {
  me = { ...me, locations: [{ ...location }] };
  const { unmount } = render(<NoLocationNotice />);
  expect(screen.queryByRole('status')).toBeNull();
  unmount();

  me = { ...me, locations: [], isSuperAdmin: true };
  const second = render(<NoLocationNotice />);
  expect(screen.queryByRole('status')).toBeNull();
  second.unmount();

  me = { ...me, isSuperAdmin: false };
  render(<NoLocationNotice relevant={false} />);
  expect(screen.queryByRole('status')).toBeNull();
});
