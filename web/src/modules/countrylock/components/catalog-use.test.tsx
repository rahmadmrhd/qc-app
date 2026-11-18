import type { CatalogStatus } from '@countrylock/bridge-contract';
import type { CatalogItemDto, DesktopCatalogDto } from '@shared/desktop-catalog';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { linkOptionNames, pickLink, pickSelect } from '@/test/link-field';
import { createFakeBridge } from '../fake-bridge';
import { CountryLockPage } from './country-lock-page';

// Tipe katalog -> form inject (spek desktop §6.6, keputusan pemilik 2026-11-18; alur aplikasi lama: Merk -> Tipe ->
// Firmware): Tipe dipilih di dropdown form; Tipe dengan firmware yang ada di paket mengisi dan mengunci Firmware,
// yang tidak, menampilkan alasannya dan Firmware dipilih manual. Nama Tipe dicatat bersama serial di antrean pending.

beforeEach(() => {
  localStorage.clear();
});

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

const DEF = { id: 'bu-def', code: 'DEF', name: 'BU Bawaan' };
const BBB = { id: 'bu-b', code: 'BBB', name: 'BU B' };

const CATALOG: DesktopCatalogDto = {
  version: 1,
  items: [
    {
      ...baseItem,
      id: 'i1',
      brand: 'Mikrotik',
      model: 'RB-750',
      firmware: 'AC',
      businessUnits: [DEF],
    },
    {
      ...baseItem,
      id: 'i2',
      brand: 'Ubiquiti',
      model: 'AF-5XHD',
      firmware: 'af5xhd',
      businessUnits: [DEF, BBB],
    },
    { ...baseItem, id: 'i3', brand: 'Mikrotik', model: 'Tanpa Firmware', firmware: '' },
    { ...baseItem, id: 'i4', brand: 'Mikrotik', model: 'Firmware Asing', firmware: 'ARM' },
  ],
  businessUnits: [BBB, DEF],
  locations: [
    { id: 'loc-a', code: 'QC-A', name: 'QC A' },
    { id: 'loc-b', code: 'WH-B', name: 'Gudang B' },
  ],
  stickerTypes: [],
  stickers: [],
  files: [],
};

function setupBridge(catalog: DesktopCatalogDto, version?: number) {
  return createFakeBridge({
    ...(version === undefined ? {} : { version }),
    catalog: {
      get: async () => ({ catalog, syncedAt: OK.syncedAt ?? '' }),
      status: async () => OK,
    },
  });
}

function setup(catalog: DesktopCatalogDto = CATALOG, version?: number) {
  const bridge = setupBridge(catalog, version);
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

/** Lokasi wajib sebelum inject; opsinya baru ada setelah potret katalog dimuat. */
async function pickLocation(name = 'QC-A - QC A') {
  await waitFor(async () => expect(await linkOptionNames(screen, 'Lokasi')).toContain(name));
  await pickLink(screen, 'Lokasi', name);
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
    // Panel "Katalog Tipe" sudah dihapus (keputusan pemilik 2026-11-18): tak ada lagi panel instruksi di halaman.
    expect(screen.queryByText(/Katalog Tipe/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Kosongkan Tipe' }));
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
    await pickLocation();
    const inject = screen.getByRole('button', { name: 'Inject' });
    await waitFor(() => expect(inject).toBeEnabled());
    await userEvent.click(inject);

    await waitFor(() => expect(bridge.pendingList).toHaveLength(1));
    expect(bridge.pendingList[0]).toMatchObject({
      serial: 'ABC123',
      brand: 'mikrotik',
      tipe: 'RB-750',
      // Bahan unggah (jembatan v7): id Tipe katalog dan kunci idempoten per baris.
      itemId: 'i1',
      clientId: expect.stringMatching(/^[A-Za-z0-9-]{8,100}$/),
    });
    // Kolom Tipe di daftar pending memuat nama itu (bukan "-").
    const table = await screen.findByRole('table');
    expect(within(table).getByText('RB-750')).toBeInTheDocument();
  });

  test('semua field wajib: tanpa Tipe (katalog aktif) Inject nonaktif dan petunjuk menyebut yang kurang', async () => {
    const bridge = setup();
    await pickBrand();
    await pickSelect(screen, 'Firmware', 'AC 6.x');
    await waitFor(() =>
      expect(
        screen.getByText(/Wajib diisi sebelum inject: Tipe, Business Unit, Lokasi\./),
      ).toBeVisible(),
    );
    expect(screen.getByRole('button', { name: 'Inject' })).toBeDisabled();
    expect(bridge.pendingList).toHaveLength(0);
  });

  test('build tanpa katalog (jembatan lama atau token kosong): dropdown Tipe tidak ada, form tetap manual', async () => {
    const bridge = createFakeBridge();
    render(<CountryLockPage bridge={bridge} />);
    await pickBrand();
    expect(screen.queryByRole('combobox', { name: 'Tipe' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toBeEnabled();
  });
});

// BU dan Lokasi tujuan (keputusan pemilik 2026-11-18): dipilih di form dari katalog offline dan dicatat bersama serial.
describe('BU dan Lokasi -> form inject', () => {
  async function waitForLocations() {
    await waitFor(async () =>
      expect(await linkOptionNames(screen, 'Lokasi')).toEqual(['QC-A - QC A', 'WH-B - Gudang B']),
    );
  }

  const bu = () => screen.getByRole('combobox', { name: 'Business Unit' });
  const location = () => screen.getByRole('combobox', { name: 'Lokasi' });

  test('menawarkan semua BU aktif dan lokasi aktif dari katalog; tanpa Tipe, BU tidak dibatasi', async () => {
    setup();
    await pickBrand();
    await waitForLocations();
    expect(await linkOptionNames(screen, 'Business Unit')).toEqual([
      'BBB - BU B',
      'DEF - BU Bawaan',
    ]);
  });

  test('Tipe berBU tunggal mengisi BU sendiri', async () => {
    setup();
    await pickBrand('Mikrotik');
    await pickTipe('RB-750');
    expect(bu()).toHaveValue('DEF - BU Bawaan');
    expect(await linkOptionNames(screen, 'Business Unit')).toEqual(['DEF - BU Bawaan']);
  });

  test('Tipe berBU dua tanpa pilihan sebelumnya: BU kosong sampai dipilih', async () => {
    setup();
    await pickBrand('Ubiquiti');
    await pickTipe('AF-5XHD');
    expect(bu()).toHaveValue('');
    await pickLink(screen, 'Business Unit', 'BBB - BU B');
    expect(bu()).toHaveValue('BBB - BU B');
  });

  test('Tipe tanpa BU: tak ada BU yang ditawarkan dan BU terpilih sebelumnya dilepas', async () => {
    setup();
    await pickBrand();
    await pickLink(screen, 'Business Unit', 'DEF - BU Bawaan');
    await pickTipe('Tanpa Firmware');
    expect(bu()).toHaveValue('');
    expect(bu()).toBeDisabled();
  });

  test('inject sukses mencatat BU dan lokasi (id dan label) bersama serial; tabel menampilkannya', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bridge = setup();
    await pickBrand();
    await pickTipe('RB-750');
    await waitForLocations();
    await pickLink(screen, 'Lokasi', 'WH-B - Gudang B');
    const inject = screen.getByRole('button', { name: 'Inject' });
    await waitFor(() => expect(inject).toBeEnabled());
    await userEvent.click(inject);

    await waitFor(() => expect(bridge.pendingList).toHaveLength(1));
    expect(bridge.pendingList[0]).toMatchObject({
      tipe: 'RB-750',
      buId: 'bu-def',
      buLabel: 'DEF - BU Bawaan',
      locationId: 'loc-b',
      locationLabel: 'WH-B - Gudang B',
    });
    const table = await screen.findByRole('table');
    expect(within(table).getByText('DEF - BU Bawaan')).toBeInTheDocument();
    expect(within(table).getByText('WH-B - Gudang B')).toBeInTheDocument();
  });

  test('BU dan Lokasi wajib: Inject nonaktif sampai keduanya terisi; petunjuk menyebut yang kurang', async () => {
    setup();
    await pickBrand('Ubiquiti');
    await pickTipe('AF-5XHD');
    // Firmware 'af5xhd' tak ada di paket palsu: dipilih manual. Tipe berBU dua tidak mengisi BU sendiri.
    await pickSelect(screen, 'Firmware', 'XW');
    await waitFor(() =>
      expect(screen.getByText(/Wajib diisi sebelum inject: Business Unit, Lokasi\./)).toBeVisible(),
    );
    const inject = screen.getByRole('button', { name: 'Inject' });
    expect(inject).toBeDisabled();
    await pickLocation();
    expect(screen.getByText(/Wajib diisi sebelum inject: Business Unit\./)).toBeVisible();
    expect(inject).toBeDisabled();
    await pickLink(screen, 'Business Unit', 'BBB - BU B');
    await waitFor(() => expect(inject).toBeEnabled());
    expect(screen.queryByText(/Wajib diisi sebelum inject/)).not.toBeInTheDocument();
  });

  test('katalog belum tersinkron: Inject nonaktif dan petunjuk menyuruh menekan tombol sinkron', async () => {
    const bridge = createFakeBridge({
      catalog: { get: async () => null, status: async () => OK },
    });
    render(<CountryLockPage bridge={bridge} />);
    await pickBrand();
    expect(await screen.findByText(/Katalog belum tersinkron: tekan tombol sinkron/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Inject' })).toBeDisabled();
  });

  test('Auto Inject juga menunggu form lengkap, lalu jalan sendiri begitu dilengkapi', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bridge = setup();
    await pickBrand();
    await pickTipe('RB-750');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Auto Inject' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Lanjut' }),
    );
    // Lokasi masih kosong: perangkat terbaca tetapi tidak di-inject.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(bridge.pendingList).toHaveLength(0);
    await pickLocation();
    await waitFor(() => expect(bridge.pendingList).toHaveLength(1));
  });

  test('pilihan terakhir diingat saat halaman dibuka lagi; yang sudah tak ada di katalog dibuang', async () => {
    const first = render(<CountryLockPage bridge={setupBridge(CATALOG)} />);
    await pickBrand();
    await waitForLocations();
    await pickLink(screen, 'Lokasi', 'QC-A - QC A');
    await pickLink(screen, 'Business Unit', 'BBB - BU B');
    first.unmount();

    const second = render(<CountryLockPage bridge={setupBridge(CATALOG)} />);
    await pickBrand();
    await waitFor(() => expect(location()).toHaveValue('QC-A - QC A'));
    expect(bu()).toHaveValue('BBB - BU B');
    second.unmount();

    // Lokasi QC-A dihapus dari katalog (tersisa satu): pilihan lama tidak dipakai, yang tersisa terisi sendiri.
    const trimmed: DesktopCatalogDto = {
      ...CATALOG,
      locations: [{ id: 'loc-b', code: 'WH-B', name: 'Gudang B' }],
    };
    render(<CountryLockPage bridge={setupBridge(trimmed)} />);
    await pickBrand();
    await waitFor(() => expect(location()).toHaveValue('WH-B - Gudang B'));
  });

  test('hanya ada satu lokasi aktif: terisi sendiri', async () => {
    const single: DesktopCatalogDto = {
      ...CATALOG,
      locations: [{ id: 'loc-a', code: 'QC-A', name: 'QC A' }],
    };
    setup(single);
    await pickBrand();
    await waitFor(() => expect(location()).toHaveValue('QC-A - QC A'));
  });

  test('katalog lama tanpa daftar BU/lokasi: bidang tampil tetapi kosong dan nonaktif', async () => {
    const { businessUnits: _bu, locations: _loc, ...legacy } = CATALOG;
    setup(legacy);
    await pickBrand();
    await waitFor(() => expect(location()).toBeDisabled());
    expect(bu()).toBeDisabled();
  });

  test('jembatan v5 (belum menerima BU/lokasi di pending): bidang tidak tampil dan pending tak memuatnya', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bridge = setup(CATALOG, 5);
    await pickBrand();
    await pickTipe('RB-750');
    expect(screen.queryByRole('combobox', { name: 'Lokasi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Business Unit' })).not.toBeInTheDocument();
    const inject = screen.getByRole('button', { name: 'Inject' });
    await waitFor(() => expect(inject).toBeEnabled());
    await userEvent.click(inject);
    await waitFor(() => expect(bridge.pendingList).toHaveLength(1));
    expect(bridge.pendingList[0]).not.toHaveProperty('buId');
    // Jembatan v5 juga belum menerima bahan unggah.
    expect(bridge.pendingList[0]).not.toHaveProperty('itemId');
    expect(bridge.pendingList[0]).not.toHaveProperty('clientId');
  });
});
