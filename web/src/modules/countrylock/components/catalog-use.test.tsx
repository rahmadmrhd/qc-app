import type { CatalogStatus } from '@countrylock/bridge-contract';
import type { CatalogItemDto, DesktopCatalogDto } from '@shared/desktop-catalog';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { linkOptionNames, pickSelect } from '@/test/link-field';
import { createFakeBridge } from '../fake-bridge';
import { CountryLockPage } from './country-lock-page';

// Tipe katalog -> form inject (spek desktop §6.6, keputusan pemilik 2026-11-18; alur aplikasi lama: Merk -> Tipe ->
// Firmware): Tipe dipilih di dropdown form; Tipe dengan firmware yang ada di paket mengisi dan mengunci Firmware,
// yang tidak, menampilkan alasannya dan Firmware dipilih manual. Nama Tipe dicatat bersama serial di antrean pending.

afterEach(() => {
  vi.useRealTimers();
});

const OK: CatalogStatus = {
  state: 'ok',
  itemCount: 4,
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
    { ...baseItem, id: 'i4', brand: 'Mikrotik', model: 'Firmware Asing', firmware: 'ARM' },
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
  return bridge;
}

async function pickBrand(label = 'Mikrotik') {
  await screen.findByRole('combobox', { name: 'Merk' });
  await pickSelect(screen, 'Merk', label);
}

/** Dropdown Tipe baru terisi setelah potret katalog dimuat dari jembatan. */
async function pickTipe(name: string) {
  await waitFor(async () => expect(await linkOptionNames(screen, 'Tipe')).toContain(name));
  await pickSelect(screen, 'Tipe', name);
}

describe('Tipe katalog -> form inject', () => {
  test('dropdown Tipe hanya berisi Tipe milik merk terpilih (urut nama)', async () => {
    setup();
    await pickBrand('Mikrotik');
    await waitFor(async () =>
      expect(await linkOptionNames(screen, 'Tipe')).toEqual([
        'Firmware Asing',
        'RB-750',
        'Tanpa Firmware',
      ]),
    );
    await pickBrand('Ubiquiti');
    await waitFor(async () => expect(await linkOptionNames(screen, 'Tipe')).toEqual(['AF-5XHD']));
  });

  test('Tipe berfirmware yang ada di paket mengisi dan mengunci Firmware; mengosongkan Tipe membukanya', async () => {
    setup();
    await pickBrand();
    await pickTipe('RB-750');

    expect(screen.getByRole('combobox', { name: 'Firmware' })).toHaveValue('AC 6.x');
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toBeDisabled();
    // Merk tetap bebas diganti (daftar Tipe mengikuti merk), seperti aplikasi lama.
    expect(screen.getByRole('combobox', { name: 'Merk' })).toBeEnabled();
    // Instruksi Tipe terpilih tampil otomatis di panel katalog.
    expect(await screen.findByRole('region', { name: /Instruksi Mikrotik RB-750/ })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: /clear|hapus|kosongkan/i }));
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toBeEnabled();
  });

  test('firmware kosong atau tak ada di paket: alasan tampil dan Firmware dipilih manual', async () => {
    setup();
    await pickBrand();
    await pickTipe('Tanpa Firmware');
    expect(await screen.findByText(/Firmware belum diisi di Data Item/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toBeEnabled();
    await pickSelect(screen, 'Firmware', 'WA 7.x');
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toHaveValue('WA 7.x');

    await pickTipe('Firmware Asing');
    expect(await screen.findByText('Firmware "ARM" tidak ada di paket skrip.')).toBeInTheDocument();
    // Firmware dikosongkan saat Tipe berganti (aplikasi lama) dan tetap bebas dipilih.
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toBeEnabled();
  });

  test('mengganti merk membuang Tipe terpilih beserta kunci Firmware', async () => {
    setup();
    await pickBrand('Mikrotik');
    await pickTipe('RB-750');
    await pickBrand('Ubiquiti');
    expect(screen.getByRole('combobox', { name: 'Tipe' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toHaveValue('');
  });

  test('inject sukses mencatat nama Tipe bersama merk dan serial di antrean pending', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bridge = setup();
    await pickBrand();
    await pickTipe('RB-750');
    const inject = screen.getByRole('button', { name: 'Inject' });
    await waitFor(() => expect(inject).toBeEnabled());
    await userEvent.click(inject);

    await waitFor(() => expect(bridge.pendingList).toHaveLength(1));
    expect(bridge.pendingList[0]).toMatchObject({
      serial: 'ABC123',
      brand: 'mikrotik',
      tipe: 'RB-750',
    });
    // Kolom Tipe di daftar pending memuat nama itu (bukan "-").
    const table = await screen.findByRole('table');
    expect(within(table).getByText('RB-750')).toBeInTheDocument();
  });

  test('tanpa Tipe terpilih, pending tetap tercatat dengan tipe kosong (pilihan manual)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bridge = setup();
    await pickBrand();
    await pickSelect(screen, 'Firmware', 'AC 6.x');
    const inject = screen.getByRole('button', { name: 'Inject' });
    await waitFor(() => expect(inject).toBeEnabled());
    await userEvent.click(inject);
    await waitFor(() => expect(bridge.pendingList).toHaveLength(1));
    expect(bridge.pendingList[0]).toMatchObject({ tipe: '' });
  });

  test('build tanpa katalog (jembatan lama atau token kosong): dropdown Tipe tidak ada, form tetap manual', async () => {
    const bridge = createFakeBridge();
    render(<CountryLockPage bridge={bridge} />);
    await pickBrand();
    expect(screen.queryByRole('combobox', { name: 'Tipe' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toBeEnabled();
  });
});
