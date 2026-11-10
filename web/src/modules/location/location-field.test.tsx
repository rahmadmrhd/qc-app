import type { MeDto } from '@shared/contract';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { linkOptionNames, pickLink } from '@/test/link-field';
import { ActiveLocationsProvider } from './active-locations-context';
import { LocationField } from './location-field';

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

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
      {
        id: 'l-a',
        code: 'JKT',
        name: 'Jakarta',
        permissions: { handover: 'manage', qc: 'none', stock: 'none', stickerstock: 'none' },
      },
      {
        id: 'l-b',
        code: 'BDG',
        name: 'Bandung',
        permissions: { handover: 'view', qc: 'none', stock: 'none', stickerstock: 'none' },
      },
    ],
  };
});

test('hanya menawarkan lokasi aktif yang boleh ditulis user', async () => {
  const onChange = vi.fn();
  render(
    <ActiveLocationsProvider>
      <LocationField id="loc" module="handover" level="edit" value="" onChange={onChange} />
    </ActiveLocationsProvider>,
  );
  const options = await linkOptionNames(screen, 'Lokasi');
  expect(options).toContain('Jakarta (JKT)');
  expect(options).not.toContain('Bandung (BDG)');
  expect(options).not.toContain('Tambah Lokasi');
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
  expect(onChange).toHaveBeenCalledWith('l-a');
});

test('tanpa lokasi yang boleh ditulis, field dinonaktifkan dengan keterangan', () => {
  me = {
    ...me,
    businessUnits: [],
    locations: me.locations.map((l) => ({
      ...l,
      permissions: { ...l.permissions, handover: 'view' },
    })),
  };
  render(
    <ActiveLocationsProvider>
      <LocationField id="loc" module="handover" level="edit" value="" onChange={() => undefined} />
    </ActiveLocationsProvider>,
  );
  expect(screen.getByRole('combobox', { name: 'Lokasi' })).toBeDisabled();
  expect(screen.getByText('Tidak ada lokasi aktif yang boleh Anda ubah.')).toBeInTheDocument();
});

test('nilai di luar pilihan tulis tetap tampil sesuai lokasinya (mengubah baris yang sudah ada)', () => {
  render(
    <ActiveLocationsProvider>
      <LocationField
        id="loc"
        module="handover"
        level="edit"
        value="l-b"
        onChange={() => undefined}
      />
    </ActiveLocationsProvider>,
  );
  expect(screen.getByRole('combobox', { name: 'Lokasi' })).toHaveValue('Bandung (BDG)');
});

test('nilai lokasi yang sudah tidak tersedia ditandai, bukan diganti opsi lain', () => {
  render(
    <ActiveLocationsProvider>
      <LocationField
        id="loc"
        module="handover"
        level="edit"
        value="hilang"
        onChange={() => undefined}
      />
    </ActiveLocationsProvider>,
  );
  expect(screen.getByRole('combobox', { name: 'Lokasi' })).toHaveValue('(lokasi tidak tersedia)');
});
