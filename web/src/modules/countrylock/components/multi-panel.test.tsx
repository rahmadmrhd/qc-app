import type { CatalogStatus, MultiDeviceDto } from '@countrylock/bridge-contract';
import type { CatalogItemDto, DesktopCatalogDto } from '@shared/desktop-catalog';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { linkOptionNames, pickLink } from '@/test/link-field';
import { mockMatchMedia } from '@/test/match-media';
import {
  createFakeBridge,
  createFakeMultiDevice,
  type createFakeMultiSnapshot,
  createFakePackage,
  type FakeOverrides,
} from '../fake-bridge';
import { AUTO_INJECT_WARNING, CountryLockPage } from './country-lock-page';

// Mode Multi-Device di halaman Country Lock (spek 2026-11-19 §5): form Multi, tabel perangkat, aksi massal, kredensial.

let media: ReturnType<typeof mockMatchMedia>;

// Suite berat (banyak combobox dan portal): batas tunggu bawaan 1 dtk terlalu ketat saat mesin sibuk.
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  localStorage.clear();
  media = mockMatchMedia(true);
});

afterEach(() => {
  media.restore();
  vi.useRealTimers();
});

const OK: CatalogStatus = {
  state: 'ok',
  itemCount: 2,
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

const CATALOG: DesktopCatalogDto = {
  version: 1,
  items: [
    {
      ...baseItem,
      id: 'i-ubnt',
      brand: 'Ubiquiti',
      model: 'AF-5XHD',
      firmware: 'XW',
      businessUnits: [DEF],
    },
    { ...baseItem, id: 'i-mk', brand: 'Mikrotik', model: 'RB-750', firmware: 'AC' },
  ],
  businessUnits: [DEF],
  locations: [
    { id: 'loc-a', code: 'QC-A', name: 'QC A' },
    { id: 'loc-b', code: 'WH-B', name: 'Gudang B' },
  ],
  stickerTypes: [],
  stickers: [],
  files: [],
};

const MAC1 = 'AA:BB:CC:DD:EE:01';
const MAC2 = 'AA:BB:CC:DD:EE:02';
const MAC3 = 'AA:BB:CC:DD:EE:03';
const MAC4 = 'AA:BB:CC:DD:EE:04';

function bridgeWith(overrides: FakeOverrides = {}) {
  return createFakeBridge({
    catalog: {
      get: async () => ({ catalog: CATALOG, syncedAt: OK.syncedAt ?? '' }),
      status: async () => OK,
    },
    ...overrides,
  });
}

function renderPage(bridge = bridgeWith(), props: { canRecord?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CountryLockPage bridge={bridge} {...props} />
    </QueryClientProvider>,
  );
  return bridge;
}

async function openMulti(bridge = bridgeWith(), props: { canRecord?: boolean } = {}) {
  renderPage(bridge, props);
  await userEvent.click(await screen.findByRole('button', { name: 'Multi-Device' }));
  await screen.findByRole('button', { name: 'Mulai' });
  return bridge;
}

async function fillForm() {
  await waitFor(async () => expect(await linkOptionNames(screen, 'Tipe')).toContain('AF-5XHD'));
  await pickLink(screen, 'Tipe', 'AF-5XHD');
  await waitFor(async () =>
    expect(await linkOptionNames(screen, 'Lokasi')).toContain('QC-A - QC A'),
  );
  await pickLink(screen, 'Lokasi', 'QC-A - QC A');
}

async function startMulti(bridge: ReturnType<typeof bridgeWith>) {
  await fillForm();
  await userEvent.click(screen.getByRole('button', { name: 'Mulai' }));
  await waitFor(() => expect(bridge.multiState.running).toBe(true));
  await screen.findByRole('button', { name: 'Hentikan' });
}

const device = (mac: string, overrides: Partial<MultiDeviceDto> = {}) =>
  createFakeMultiDevice({
    mac,
    ip: `192.168.88.${Number.parseInt(mac.slice(-2), 16) + 20}`,
    ...overrides,
  });

const callsOf = (bridge: ReturnType<typeof bridgeWith>, name: string) =>
  bridge.multiCalls.filter((call) => call.name === name);

describe('tombol mode', () => {
  test('tampil hanya bila jembatan v9 dan paket memuat merk Ubiquiti', async () => {
    renderPage(bridgeWith());
    expect(await screen.findByRole('group', { name: 'Mode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tunggal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Multi-Device' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('jembatan di bawah v9: tombol mode tidak ada', async () => {
    renderPage(bridgeWith({ version: 8 }));
    await screen.findByRole('combobox', { name: 'Merk' });
    expect(screen.queryByRole('group', { name: 'Mode' })).toBeNull();
  });

  test('paket tanpa merk Ubiquiti: tombol mode tidak ada', async () => {
    const pkg = createFakePackage();
    const { ubiquiti: _ubiquiti, ...brands } = pkg.config.brands;
    renderPage(
      bridgeWith({
        package: { load: async () => ({ ...pkg, config: { ...pkg.config, brands } }) },
      }),
    );
    await screen.findByRole('combobox', { name: 'Merk' });
    expect(screen.queryByRole('group', { name: 'Mode' })).toBeNull();
  });

  test('memilih Multi menampilkan form Multi, menyembunyikan kartu Perangkat mode tunggal, dan menyisakan ringkasan draft', async () => {
    await openMulti(bridgeWith(), { canRecord: true });
    expect(screen.getByRole('button', { name: 'Multi-Device' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByText('Perangkat')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Inject' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Merk' })).toHaveValue('Ubiquiti');
    expect(screen.getByRole('combobox', { name: 'Merk' })).toBeDisabled();
    expect(await screen.findByRole('region', { name: 'Draft Serial Number' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Catat Serial Number' })).toBeInTheDocument();
    // Kembali ke Tunggal.
    await userEvent.click(screen.getByRole('button', { name: 'Tunggal' }));
    expect(await screen.findByText('Perangkat')).toBeInTheDocument();
  });

  test('Auto Inject mode tunggal dimatikan saat pindah ke Multi', async () => {
    const bridge = bridgeWith();
    renderPage(bridge);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Auto Inject' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Lanjut' }));
    expect(screen.getByRole('checkbox', { name: 'Auto Inject' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Multi-Device' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Tunggal' }));
    expect(await screen.findByRole('checkbox', { name: 'Auto Inject' })).not.toBeChecked();
  });

  test('batch sudah berjalan saat halaman dimuat (muat ulang): langsung ke mode Multi dan dikunci', async () => {
    const bridge = bridgeWith();
    bridge.emitMulti({ running: true, devices: [device(MAC1)] });
    renderPage(bridge);
    expect(await screen.findByRole('button', { name: 'Hentikan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tunggal' })).toBeDisabled();
  });
});

describe('form Multi', () => {
  test('Mulai nonaktif sampai Tipe, Firmware, Business Unit, dan Lokasi terisi', async () => {
    await openMulti();
    const start = screen.getByRole('button', { name: 'Mulai' });
    expect(start).toBeDisabled();
    expect(
      screen.getByText(/Wajib diisi sebelum Multi dimulai: Tipe, Firmware, Business Unit, Lokasi/),
    ).toBeInTheDocument();
    await waitFor(async () => expect(await linkOptionNames(screen, 'Tipe')).toEqual(['AF-5XHD']));
    await pickLink(screen, 'Tipe', 'AF-5XHD');
    // Firmware dan BU terisi dari Tipe; Lokasi masih kosong.
    expect(screen.getByRole('combobox', { name: 'Firmware' })).toHaveValue('XW');
    expect(screen.getByRole('combobox', { name: 'Business Unit' })).toHaveValue('DEF - BU Bawaan');
    expect(screen.getByText(/Wajib diisi sebelum Multi dimulai: Lokasi\./)).toBeInTheDocument();
    expect(start).toBeDisabled();
    await pickLink(screen, 'Lokasi', 'QC-A - QC A');
    expect(start).toBeEnabled();
  });

  test('Mulai mengirim konfigurasi batch (Tipe, BU, Lokasi) lalu mengunci field dan tombol mode', async () => {
    const bridge = await openMulti();
    await startMulti(bridge);
    expect(callsOf(bridge, 'start')[0]?.args[0]).toEqual({
      firmwareCode: 'XW',
      concurrency: 4,
      excludeIp: '',
      autoInject: false,
      target: {
        itemId: 'i-ubnt',
        itemLabel: 'AF-5XHD',
        buId: 'bu-def',
        buLabel: 'DEF - BU Bawaan',
        locationId: 'loc-a',
        locationLabel: 'QC-A - QC A',
      },
    });
    for (const name of ['Tipe', 'Firmware', 'Business Unit', 'Lokasi']) {
      expect(screen.getByRole('combobox', { name })).toBeDisabled();
    }
    expect(screen.getByRole('textbox', { name: 'Exclude IP' })).toBeDisabled();
    const single = screen.getByRole('button', { name: 'Tunggal' });
    expect(single).toBeDisabled();
    expect(screen.getByText(/Hentikan Multi dulu/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hentikan' }));
    await waitFor(() => expect(callsOf(bridge, 'stop')).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tunggal' })).toBeEnabled());
  });

  test('Concurrent dan Exclude IP diingat di localStorage dan dipulihkan', async () => {
    await openMulti();
    const concurrent = screen.getByRole('spinbutton', { name: 'Concurrent' });
    await userEvent.clear(concurrent);
    await userEvent.type(concurrent, '12');
    await userEvent.type(screen.getByRole('textbox', { name: 'Exclude IP' }), '192.168.88.1');
    expect(JSON.parse(localStorage.getItem('qc.countrylock.multi') ?? 'null')).toEqual({
      concurrency: 12,
      excludeIp: '192.168.88.1',
    });
    // Render ulang (jendela dimuat ulang): nilai dipulihkan.
    cleanup();
    await openMulti();
    expect(screen.getByRole('spinbutton', { name: 'Concurrent' })).toHaveValue(12);
    expect(screen.getByRole('textbox', { name: 'Exclude IP' })).toHaveValue('192.168.88.1');
  });

  test('Concurrent di luar 1 sampai 32 dan Exclude IP bukan IPv4 menahan Mulai', async () => {
    await openMulti();
    await fillForm();
    const start = screen.getByRole('button', { name: 'Mulai' });
    expect(start).toBeEnabled();
    const concurrent = screen.getByRole('spinbutton', { name: 'Concurrent' });
    await userEvent.clear(concurrent);
    await userEvent.type(concurrent, '33');
    expect(start).toBeDisabled();
    expect(screen.getByText(/Concurrent harus 1 sampai 32/)).toBeInTheDocument();
    await userEvent.clear(concurrent);
    await userEvent.type(concurrent, '32');
    expect(start).toBeEnabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Exclude IP' }), 'router');
    expect(start).toBeDisabled();
    expect(screen.getByText(/Exclude IP harus alamat IPv4 atau kosong/)).toBeInTheDocument();
  });

  test('Concurrent diubah saat berjalan langsung dikirim ke mesin', async () => {
    const bridge = await openMulti();
    await startMulti(bridge);
    const concurrent = screen.getByRole('spinbutton', { name: 'Concurrent' });
    await userEvent.clear(concurrent);
    await userEvent.type(concurrent, '8');
    await waitFor(() => expect(callsOf(bridge, 'setConcurrency').at(-1)?.args).toEqual([8]));
  });

  test('Auto Inject meminta konfirmasi; setelah Lanjut ikut dikirim di konfigurasi mulai', async () => {
    const bridge = await openMulti();
    await fillForm();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Auto Inject' }));
    expect(await screen.findByText(AUTO_INJECT_WARNING)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(screen.getByRole('checkbox', { name: 'Auto Inject' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Auto Inject' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Lanjut' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mulai' }));
    await waitFor(() => expect(callsOf(bridge, 'start')).toHaveLength(1));
    expect(callsOf(bridge, 'start')[0]?.args[0]).toMatchObject({ autoInject: true });
  });

  test('Auto Inject saat berjalan: dinyalakan setelah konfirmasi, dimatikan tanpa konfirmasi', async () => {
    const bridge = await openMulti();
    await startMulti(bridge);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Auto Inject' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Lanjut' }));
    await waitFor(() => expect(callsOf(bridge, 'setAutoInject').at(-1)?.args).toEqual([true]));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Auto Inject' }));
    await waitFor(() => expect(callsOf(bridge, 'setAutoInject').at(-1)?.args).toEqual([false]));
  });
});

describe('tabel perangkat', () => {
  async function runningWithDevices(
    extra: Partial<Parameters<typeof createFakeMultiSnapshot>[0]> = {},
  ) {
    const bridge = await openMulti();
    await startMulti(bridge);
    act(() =>
      bridge.emitMulti({
        devices: [
          device(MAC1, { status: 'ready', message: 'Siap inject' }),
          device(MAC2, { status: 'queued', message: 'Antri' }),
          device(MAC3, { status: 'failed', message: 'Gagal: SSH', serial: 'AABBCCDDEE03' }),
          device(MAC4, {
            status: 'success',
            message: 'Selesai',
            serial: 'AABBCCDDEE04',
            injectedThisSession: true,
            log: ['[10:00:01] Mulai inject', '[10:00:09] Selesai'],
          }),
        ],
        ...extra,
      }),
    );
    return bridge;
  }

  test('merender baris per perangkat dengan MAC, IP, model, serial, negara, sumber kredensial, dan status', async () => {
    await runningWithDevices();
    const row = await screen.findByRole('row', { name: new RegExp(MAC1) });
    expect(within(row).getByText('192.168.88.21')).toBeInTheDocument();
    expect(within(row).getByText('NanoStation M2')).toBeInTheDocument();
    expect(within(row).getByText('AABBCCDDEE01')).toBeInTheDocument();
    expect(within(row).getByText('indonesia')).toBeInTheDocument();
    expect(within(row).getByText('Default')).toBeInTheDocument();
    expect(within(row).getByText('Siap inject')).toBeInTheDocument();
    expect(within(row).getByLabelText('Merespon ping')).toBeInTheDocument();
    expect(screen.getByText('4 perangkat (4 aktif)')).toBeInTheDocument();
  });

  test('"N perangkat (M aktif)" tidak menghitung perangkat terputus sebagai aktif', async () => {
    const bridge = await runningWithDevices();
    bridge.emitMulti({
      devices: [
        device(MAC1, { status: 'ready' }),
        device(MAC2, { status: 'disconnected', message: 'Terputus' }),
      ],
    });
    expect(await screen.findByText('2 perangkat (1 aktif)')).toBeInTheDocument();
  });

  test('lencana ringkasan menampilkan jumlah dan menyaring tabel saat diklik', async () => {
    await runningWithDevices();
    const failed = screen.getByRole('button', { name: /^Gagal 1/ });
    expect(screen.getByRole('button', { name: /^Menunggu 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Antri 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Inject 0/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Selesai 1/ })).toBeInTheDocument();
    await userEvent.click(failed);
    expect(failed).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('row', { name: new RegExp(MAC1) })).toBeNull();
    expect(screen.getByRole('row', { name: new RegExp(MAC3) })).toBeInTheDocument();
    // Klik lagi melepas saringan.
    await userEvent.click(failed);
    expect(screen.getByRole('row', { name: new RegExp(MAC1) })).toBeInTheDocument();
  });

  test('aksi baris: Inject (siap), Cancel (antri), Retry (gagal), tanpa aksi inject pada yang selesai', async () => {
    const bridge = await runningWithDevices();
    await userEvent.click(await screen.findByRole('button', { name: `Inject ${MAC1}` }));
    await userEvent.click(screen.getByRole('button', { name: `Cancel ${MAC2}` }));
    await userEvent.click(screen.getByRole('button', { name: `Retry ${MAC3}` }));
    expect(callsOf(bridge, 'injectDevice').map((c) => c.args[0])).toEqual([MAC1, MAC3]);
    expect(callsOf(bridge, 'cancelDevice').map((c) => c.args[0])).toEqual([MAC2]);
    const done = screen.getByRole('row', { name: new RegExp(MAC4) });
    expect(within(done).queryByRole('button', { name: /^(Inject|Retry|Cancel) / })).toBeNull();
    expect(within(done).getByText(/Sudah di-inject di sesi ini/)).toBeInTheDocument();
  });

  test('perangkat waiting dengan kredensial habis menampilkan Retry (coba ulang kredensial dari awal)', async () => {
    const bridge = await openMulti();
    await startMulti(bridge);
    bridge.emitMulti({
      devices: [
        device(MAC1, {
          status: 'waiting',
          message: 'Permission denied!!!',
          credentialsExhausted: true,
        }),
        device(MAC2, { status: 'waiting', message: 'Menunggu' }),
      ],
    });
    await userEvent.click(await screen.findByRole('button', { name: `Retry ${MAC1}` }));
    expect(callsOf(bridge, 'injectDevice').map((c) => c.args[0])).toEqual([MAC1]);
    expect(screen.queryByRole('button', { name: `Retry ${MAC2}` })).toBeNull();
  });

  test('Buka web memakai MAC perangkat (IP divalidasi di proses utama)', async () => {
    const bridge = await runningWithDevices();
    await userEvent.click(await screen.findByRole('button', { name: `Buka web ${MAC1}` }));
    expect(callsOf(bridge, 'openWeb').map((c) => c.args[0])).toEqual([MAC1]);
  });

  test('log perangkat dapat dilipat dan berisi baris berstempel waktu', async () => {
    await runningWithDevices();
    const row = await screen.findByRole('row', { name: new RegExp(MAC4) });
    const summary = within(row).getByText(/Log \(2\)/);
    expect(row.querySelector('details')).not.toHaveAttribute('open');
    await userEvent.click(summary);
    expect(within(row).getByText(/\[10:00:01\] Mulai inject/)).toBeVisible();
  });

  test('layar sempit: kartu per perangkat, bukan tabel', async () => {
    media.set(false);
    await runningWithDevices();
    expect(screen.queryByRole('table', { name: /perangkat Multi/i })).toBeNull();
    const card = await screen.findByRole('article', { name: new RegExp(MAC1) });
    expect(within(card).getByText('NanoStation M2')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: `Inject ${MAC1}` }));
    expect(screen.getByText('4 perangkat (4 aktif)')).toBeInTheDocument();
  });

  test('snapshot.message, alasan blokir, dan penghentian antrean tampil', async () => {
    await runningWithDevices({
      message: 'Antrian sedang dihentikan operator',
      blockedReason: 'Draft penuh',
      queueStopped: true,
    });
    expect(await screen.findByText('Antrian sedang dihentikan operator')).toBeInTheDocument();
    expect(screen.getByText(/Draft menahan inject: Draft penuh/)).toBeInTheDocument();
  });
});

describe('peristiwa yang belum tercatat', () => {
  test('draft rusak: perangkat selesai ditandai "Belum tercatat di draft" dan peristiwanya tak di-ack', async () => {
    const bridge = bridgeWith({
      draft: {
        load: async () => {
          throw new Error('Draft tersimpan rusak: isinya tidak terbaca.');
        },
      },
    });
    bridge.multiEvents.push({
      eventId: 'evt-full',
      mac: MAC4,
      serial: 'BARU4',
      model: 'NanoStation M2',
      injectedAt: '2026-11-18T20:30:00.000Z',
      target: {
        itemId: 'i-ubnt',
        itemLabel: 'AF-5XHD',
        buId: 'bu-def',
        buLabel: 'DEF',
        locationId: 'loc-a',
        locationLabel: 'QC-A',
      },
    });
    await openMulti(bridge);
    await startMulti(bridge);
    act(() =>
      bridge.emitMulti({
        devices: [
          device(MAC3, { status: 'success', message: 'Selesai' }),
          device(MAC4, { status: 'success', message: 'Selesai', serial: 'BARU4' }),
        ],
      }),
    );
    const row = await screen.findByRole('row', { name: new RegExp(MAC4) });
    await waitFor(() =>
      expect(within(row).getByText('Belum tercatat di draft')).toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole('row', { name: new RegExp(MAC3) })).queryByText(
        'Belum tercatat di draft',
      ),
    ).toBeNull();
    expect(callsOf(bridge, 'ackInjected')).toHaveLength(0);
    expect(bridge.multiEvents).toHaveLength(1);
  });
});

describe('aksi massal dan bridge router', () => {
  test('Scan, Inject All, Stop Antrean, dan Cancel All memanggil kanal masing-masing saat berjalan', async () => {
    const bridge = await openMulti();
    for (const name of ['Scan', 'Inject All', 'Stop Antrean', 'Cancel All']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    await startMulti(bridge);
    await userEvent.click(screen.getByRole('button', { name: 'Scan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Inject All' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop Antrean' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel All' }));
    for (const name of ['scan', 'injectAll', 'stopQueue', 'cancelAll']) {
      expect(callsOf(bridge, name)).toHaveLength(1);
    }
  });

  test('Siapkan bridge router meminta konfirmasi yang menyebut perintahnya; baru dipanggil setelah dikonfirmasi', async () => {
    const bridge = await openMulti();
    await userEvent.click(screen.getByRole('button', { name: 'Siapkan bridge router' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/bridge1/)).toBeInTheDocument();
    expect(within(dialog).getByText(/ether1/)).toBeInTheDocument();
    expect(within(dialog).getByText(/ether2, ether3/)).toBeInTheDocument();
    // Teks dibangun dari rencana yang sama dengan perintah di proses utama: host SSH = server.ip, cakupan SEMUA bridge,
    // dan perintah persis (interfaceComp tidak ikut ditambahkan).
    const text = dialog.textContent ?? '';
    expect(text).toContain('192.168.88.1');
    expect(text).toContain('SEMUA bridge');
    expect(text).toContain('/interface bridge port remove [find interface!=ether1]');
    expect(text).toContain('/interface bridge port add bridge=bridge1 interface=ether2');
    expect(text).toContain('/interface bridge port add bridge=bridge1 interface=ether3');
    expect(text).not.toContain('interface=ether1');
    expect(callsOf(bridge, 'prepareBridge')).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
    expect(callsOf(bridge, 'prepareBridge')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Siapkan bridge router' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Siapkan' }),
    );
    await waitFor(() => expect(callsOf(bridge, 'prepareBridge')).toHaveLength(1));
  });

  test('Siapkan bridge router nonaktif dengan petunjuk saat ada perangkat injecting atau antri; aktif lagi setelahnya', async () => {
    const bridge = await openMulti();
    await startMulti(bridge);
    const button = screen.getByRole('button', { name: 'Siapkan bridge router' });
    expect(button).toBeEnabled();
    act(() =>
      bridge.emitMulti({ running: true, devices: [device(MAC1, { status: 'injecting' })] }),
    );
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute(
      'title',
      'Tidak dapat menyiapkan bridge saat inject sedang berjalan',
    );
    expect(
      screen.getByText('Tidak dapat menyiapkan bridge saat inject sedang berjalan.'),
    ).toBeInTheDocument();
    act(() => bridge.emitMulti({ running: true, devices: [device(MAC1, { status: 'queued' })] }));
    await waitFor(() => expect(button).toBeDisabled());
    act(() => bridge.emitMulti({ running: true, devices: [device(MAC1, { status: 'success' })] }));
    await waitFor(() => expect(button).toBeEnabled());
  });

  test('selama bridge disiapkan, Inject All dan tombol Siapkan nonaktif; aktif lagi setelah selesai', async () => {
    let finish: () => void = () => undefined;
    const bridge = await openMulti(
      bridgeWith({
        multi: {
          prepareBridge: () =>
            new Promise((resolve) => {
              finish = () => resolve({ ok: true, message: 'Bridge siap' });
            }),
        },
      }),
    );
    await startMulti(bridge);
    await userEvent.click(screen.getByRole('button', { name: 'Siapkan bridge router' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Siapkan' }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inject All' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Siapkan bridge router' })).toBeDisabled();
    expect(screen.getByText(/inject ditahan sampai selesai/)).toBeInTheDocument();
    act(() => finish());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inject All' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Siapkan bridge router' })).toBeEnabled();
  });

  test('Mulai tidak pernah menyiapkan bridge router sendiri', async () => {
    const bridge = await openMulti();
    await startMulti(bridge);
    expect(callsOf(bridge, 'prepareBridge')).toHaveLength(0);
  });

  test('galat dari proses utama tampil sebagai pesan', async () => {
    const bridge = bridgeWith({
      multi: {
        start: async () => {
          throw new Error(
            "Error invoking remote method 'qc:multi:start': Error: Hentikan inject tunggal dulu",
          );
        },
      },
    });
    await openMulti(bridge);
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Mulai' }));
    expect(await screen.findByText(/Hentikan inject tunggal dulu/)).toBeInTheDocument();
  });
});

describe('antrean kredensial', () => {
  test('tombol + menambah kredensial manual, mengosongkan isian, dan tak pernah menampilkan sandi', async () => {
    const bridge = await openMulti();
    await userEvent.type(screen.getByLabelText('Username kredensial'), 'admin2');
    await userEvent.type(screen.getByLabelText('Password kredensial'), 'rahasia-xyz');
    await userEvent.click(screen.getByRole('button', { name: 'Tambah kredensial' }));
    expect(callsOf(bridge, 'addCredential')[0]?.args[0]).toEqual({
      username: 'admin2',
      password: 'rahasia-xyz',
    });
    expect(screen.getByLabelText('Username kredensial')).toHaveValue('');
    expect(screen.getByLabelText('Password kredensial')).toHaveValue('');
    expect(screen.queryByText(/rahasia-xyz/)).toBeNull();
    expect(document.body.textContent).not.toContain('rahasia-xyz');
    await waitFor(() => expect(screen.getByText(/Antrian kredensial: 1/)).toBeInTheDocument());
  });

  test('username atau password kosong tidak dikirim', async () => {
    const bridge = await openMulti();
    await userEvent.type(screen.getByLabelText('Username kredensial'), 'admin2');
    expect(screen.getByRole('button', { name: 'Tambah kredensial' })).toBeDisabled();
    expect(callsOf(bridge, 'addCredential')).toHaveLength(0);
  });
});
