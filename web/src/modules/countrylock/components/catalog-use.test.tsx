import type { CatalogStatus } from '@countrylock/bridge-contract';
import type { CatalogItemDto, DesktopCatalogDto } from '@shared/desktop-catalog';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { createFakeBridge } from '../fake-bridge';
import { CountryLockPage } from './country-lock-page';

// Tipe katalog -> form inject (spek desktop §6.6, keputusan pemilik 2026-11-18): Tipe dengan firmware yang ada di
// paket mengisi dan mengunci Merk + Firmware; yang tidak, menampilkan alasannya tanpa tombol.

const OK: CatalogStatus = {
  state: 'ok',
  itemCount: 3,
  syncedAt: '2026-11-18T10:00:00.000Z',
  error: null,
};

const baseItem = {
  aliases: [],
  businessUnits: [],
  stickerIds: [],
  stickerPhotos: [],
} satisfies Partial<CatalogItemDto>;

const CATALOG: DesktopCatalogDto = {
  version: 1,
  items: [
    { ...baseItem, id: 'i1', brand: 'Mikrotik', model: 'RB-750', firmware: 'AC' },
    { ...baseItem, id: 'i2', brand: 'Ubiquiti', model: 'AF-5XHD', firmware: 'af5xhd' },
    { ...baseItem, id: 'i3', brand: 'Mikrotik', model: 'Tanpa Firmware', firmware: '' },
  ],
  stickerTypes: [],
  stickers: [],
  files: [],
};

function setup() {
  const bridge = createFakeBridge({
    catalog: {
      get: async () => ({ catalog: CATALOG, syncedAt: OK.syncedAt ?? '' }),
      status: async () => OK,
    },
  });
  render(<CountryLockPage bridge={bridge} />);
}

describe('Tipe katalog -> form inject', () => {
  test('Tipe berfirmware yang ada di paket: Pakai untuk inject mengisi dan mengunci Merk + Firmware; Lepas kunci membukanya', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /Mikrotik RB-750/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Pakai untuk inject' }));

    expect(screen.getByRole('combobox', { name: 'Merk' })).toHaveValue('Mikrotik');
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toHaveValue('AC 6.x');
    expect(screen.getByRole('combobox', { name: 'Merk' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toBeDisabled();
    expect(screen.getByText(/merk dan firmware terkunci/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Lepas kunci' }));
    expect(screen.getByRole('combobox', { name: 'Merk' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toBeEnabled();
    // Pilihan tetap bertahan setelah kunci dilepas.
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toHaveValue('AC 6.x');
  });

  test('firmware tak ada di paket atau belum diisi: alasan tampil, tanpa tombol', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /Ubiquiti AF-5XHD/ }));
    expect(
      await screen.findByText('Firmware "af5xhd" tidak ada di paket skrip.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pakai untuk inject' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Mikrotik Tanpa Firmware/ }));
    expect(await screen.findByText(/Firmware belum diisi di Data Item/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pakai untuk inject' })).not.toBeInTheDocument();
    // Form inject tetap bebas dipilih manual.
    expect(screen.getByRole('combobox', { name: 'Merk' })).toBeEnabled();
  });
});
