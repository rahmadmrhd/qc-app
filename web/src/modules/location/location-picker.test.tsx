import type { MeDto } from '@shared/contract';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ACTIVE_LOCATIONS_STORAGE_KEY } from './active-locations';
import { ActiveLocationsProvider } from './active-locations-context';
import { LocationPicker } from './location-picker';

const none = {
  qrcode: 'none',
  handover: 'none',
  qc: 'none',
  stock: 'none',
  stickerstock: 'none',
} as const;
let me: MeDto;

vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

function mount() {
  return render(
    <ActiveLocationsProvider>
      <LocationPicker />
    </ActiveLocationsProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  me = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: {
      access: 'none',
      item: 'none',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
    },
    businessUnits: [],
    locations: [
      { id: 'l-a', code: 'JKT', name: 'Jakarta', permissions: { ...none, handover: 'view' } },
      { id: 'l-b', code: 'BDG', name: 'Bandung', permissions: { ...none, handover: 'view' } },
    ],
  };
});
afterEach(() => localStorage.clear());

test('disembunyikan bila user hanya punya satu lokasi', () => {
  me = { ...me, locations: me.locations.slice(0, 1) };
  mount();
  expect(screen.queryByRole('button', { name: 'Pilih lokasi aktif' })).not.toBeInTheDocument();
});

test('default semua lokasi; mengubah pilihan tersimpan dan tidak bisa dikosongkan', async () => {
  mount();
  const trigger = screen.getByRole('button', { name: 'Pilih lokasi aktif' });
  expect(trigger).toHaveTextContent('Semua lokasi');
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Bandung/ }));
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Pilih lokasi aktif' })).toHaveTextContent('Jakarta');
  expect(localStorage.getItem(ACTIVE_LOCATIONS_STORAGE_KEY)).toBe('["l-a"]');
  await userEvent.click(screen.getByRole('button', { name: 'Pilih lokasi aktif' }));
  await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Jakarta/ }));
  await userEvent.keyboard('{Escape}');
  expect(localStorage.getItem(ACTIVE_LOCATIONS_STORAGE_KEY)).toBe('["l-a"]');
});

test('pilihan tersimpan yang basi disaring saat dimuat', () => {
  localStorage.setItem(ACTIVE_LOCATIONS_STORAGE_KEY, '["l-b","hilang"]');
  mount();
  expect(screen.getByRole('button', { name: 'Pilih lokasi aktif' })).toHaveTextContent('Bandung');
});

test('bila semua pilihan tersimpan basi, kembali ke semua lokasi yang tersedia', () => {
  localStorage.setItem(ACTIVE_LOCATIONS_STORAGE_KEY, '["hilang"]');
  mount();
  expect(screen.getByRole('button', { name: 'Pilih lokasi aktif' })).toHaveTextContent(
    'Semua lokasi',
  );
});
