import type {
  DeviceRequest,
  InjectRequest,
  InjectResult,
  QcBridge,
} from '@countrylock/bridge-contract';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { pickSelect } from '@/test/link-field';
import {
  createFakeBridge,
  createFakePackage,
  FAKE_BRAND_PASSWORD,
  type FakeOverrides,
} from '../fake-bridge';
import { useCountryLock } from '../use-country-lock';
import { CountryLockPage } from './country-lock-page';

afterEach(() => {
  vi.useRealTimers();
});

function setup(overrides: FakeOverrides = {}) {
  const bridge = createFakeBridge(overrides);
  const view = render(<CountryLockPage bridge={bridge} />);
  return { bridge, ...view };
}

async function selectBrandAndFirmware(firmware = 'AC 6.x') {
  await screen.findByRole('combobox', { name: 'Merk' });
  await pickSelect(screen, 'Merk', 'Mikrotik');
  await pickSelect(screen, 'Firmware', firmware);
}

function injectButton() {
  return screen.getByRole('button', { name: 'Inject' });
}

/** Promise yang diselesaikan dari luar (menahan `inject.run` agar dialog progres dapat diperiksa). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('CountryLockPage', () => {
  test('tanpa paket menampilkan keadaan belum ada paket dan tombol pilih folder', async () => {
    const chooseDir = vi.fn(async () => createFakePackage());
    setup({ package: { load: async () => null, chooseDir } });
    expect(await screen.findByText(/belum ada paket skrip/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pilih folder paket' }));
    expect(chooseDir).toHaveBeenCalledTimes(1);
    // Setelah paket dipilih, kontrol merk muncul.
    expect(await screen.findByRole('combobox', { name: 'Merk' })).toBeInTheDocument();
  });

  test('tombol Inject nonaktif sebelum firmware dipilih dan serial terbaca', async () => {
    setup();
    await screen.findByRole('combobox', { name: 'Merk' });
    expect(injectButton()).toBeDisabled();

    await pickSelect(screen, 'Merk', 'Mikrotik');
    // Serial terbaca dari ping + info perangkat, tetapi firmware belum dipilih.
    expect(await screen.findByText('ABC123')).toBeInTheDocument();
    expect(injectButton()).toBeDisabled();

    await pickSelect(screen, 'Firmware', 'AC 6.x');
    await waitFor(() => expect(injectButton()).toBeEnabled());
  });

  test('Auto Inject meminta konfirmasi hanya saat dinyalakan', async () => {
    setup();
    const checkbox = await screen.findByRole('checkbox', { name: 'Auto Inject' });

    await userEvent.click(checkbox);
    const confirm = await screen.findByRole('alertdialog');
    expect(
      within(confirm).getByText(
        'Harap berhati-hati saat menggunakan "Auto Inject". Pastikan kembali tipe dan firmware cocok dengan perangkat yang akan di Country Lock. Yakin untuk lanjut?',
      ),
    ).toBeInTheDocument();
    // Batal: tidak menyala.
    await userEvent.click(within(confirm).getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(checkbox).not.toBeChecked();

    // Lanjut: menyala.
    await userEvent.click(checkbox);
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Lanjut' }),
    );
    await waitFor(() => expect(checkbox).toBeChecked());

    // Mematikan tanpa konfirmasi.
    await userEvent.click(checkbox);
    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  test('inject sukses: dialog progres menutup otomatis 1 dtk setelah sukses dan mencatat pending', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { bridge } = setup();
    await selectBrandAndFirmware();
    await waitFor(() => expect(injectButton()).toBeEnabled());

    await userEvent.click(injectButton());
    expect(await screen.findByText('Selesai.')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    // Progres dari jembatan tampil sebagai teks log.
    expect(within(dialog).getByText('Skrip berjalan')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();

    // Pending tercatat hanya setelah inject sukses (serial huruf besar, merk terpilih).
    expect(bridge.pendingList).toHaveLength(1);
    expect(bridge.pendingList[0]).toMatchObject({ serial: 'ABC123', brand: 'mikrotik' });
    expect(bridge.injectRequests[0]).toMatchObject({
      brand: 'mikrotik',
      firmwareCode: 'AC',
      target: { ip: '192.168.1.20', username: 'admin', password: FAKE_BRAND_PASSWORD },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Daftar pending di halaman memuat serial yang baru dicatat.
    const pendingTable = screen.getByRole('table');
    expect(within(pendingTable).getByText('ABC123')).toBeInTheDocument();
  });

  test('inject gagal: dialog tetap terbuka dengan pesan galat', async () => {
    const failure: InjectResult = {
      ok: false,
      stage: 'failed',
      message: 'Perangkat tidak menjawab dalam batas waktu',
    };
    const { bridge } = setup({ inject: { run: async () => failure } });
    await selectBrandAndFirmware();
    await waitFor(() => expect(injectButton()).toBeEnabled());

    await userEvent.click(injectButton());
    expect(await screen.findByText('Gagal.')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(failure.message)).toBeInTheDocument();
    expect(bridge.pendingList).toHaveLength(0);

    // Tetap terbuka (tidak menutup sendiri) sampai pengguna menekan Close.
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Tombol Inject aktif lagi (penjaga re-entry dilepas).
    await waitFor(() => expect(injectButton()).toBeEnabled());
  });

  test('selama berjalan tombol Cancel merah memanggil cancel dengan id inject', async () => {
    const gate = deferred<InjectResult>();
    const cancel = vi.fn(async () => {
      gate.resolve({ ok: false, stage: 'cancelled', message: 'Inject dibatalkan' });
    });
    const { bridge } = setup({ inject: { run: () => gate.promise, cancel } });
    await selectBrandAndFirmware();
    await waitFor(() => expect(injectButton()).toBeEnabled());

    await userEvent.click(injectButton());
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Menghubungkan...')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledWith(bridge.injectRequests[0]?.id);
    expect(await screen.findByText('Dibatalkan.')).toBeInTheDocument();
  });

  test('Permission denied membuka dialog kredensial berisi kredensial bawaan merk', async () => {
    const calls: DeviceRequest[] = [];
    const readInfo: QcBridge['device']['readInfo'] = async (req) => {
      calls.push(req);
      return req.password === 'sandi-baru'
        ? { ok: true, info: { model: 'RB941', serial: 'XYZ789', country: 'indonesia' } }
        : { ok: false, error: 'PERMISSION_DENIED' };
    };
    setup({ device: { readInfo } });
    await screen.findByRole('combobox', { name: 'Merk' });
    await pickSelect(screen, 'Merk', 'Mikrotik');

    const dialog = await screen.findByRole('alertdialog', { name: /kredensial perangkat/i });
    expect(within(dialog).getByLabelText('Username')).toHaveValue('admin');
    expect(within(dialog).getByLabelText('Password')).toHaveValue(FAKE_BRAND_PASSWORD);
    // Percobaan pertama memakai kredensial bawaan merk.
    expect(calls[0]).toMatchObject({ username: 'admin', password: FAKE_BRAND_PASSWORD });

    await userEvent.clear(within(dialog).getByLabelText('Password'));
    await userEvent.type(within(dialog).getByLabelText('Password'), 'sandi-baru');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gunakan' }));

    expect(await screen.findByText('XYZ789')).toBeInTheDocument();
    expect(
      screen.queryByRole('alertdialog', { name: /kredensial perangkat/i }),
    ).not.toBeInTheDocument();
    expect(calls.at(-1)).toMatchObject({ username: 'admin', password: 'sandi-baru' });
  });

  test('kata sandi tidak tampil di log dan dialog progres', async () => {
    const gate = deferred<InjectResult>();
    const bridgeRef: { current?: ReturnType<typeof createFakeBridge> } = {};
    const run = (req: InjectRequest) => {
      // Simulasi kebocoran: progres memuat sandi mentah (proses utama seharusnya sudah menyamarkan).
      bridgeRef.current?.emitProgress(
        { stage: 'running', message: `login password=${req.target.password} berhasil` },
        req.id,
      );
      return gate.promise;
    };
    const bridge = createFakeBridge({ inject: { run } });
    bridgeRef.current = bridge;
    render(<CountryLockPage bridge={bridge} />);
    await selectBrandAndFirmware();
    await waitFor(() => expect(injectButton()).toBeEnabled());

    await userEvent.click(injectButton());
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/login password=\*\*\* berhasil/)).toBeInTheDocument();
    expect(dialog.textContent).not.toContain(FAKE_BRAND_PASSWORD);

    gate.resolve({
      ok: false,
      stage: 'failed',
      message: `Gagal dengan sandi ${FAKE_BRAND_PASSWORD}`,
    });
    expect(await within(dialog).findByText('Gagal.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(FAKE_BRAND_PASSWORD);
  });

  test('keluaran jembatan dirender sebagai teks, bukan HTML', async () => {
    const gate = deferred<InjectResult>();
    const bridgeRef: { current?: ReturnType<typeof createFakeBridge> } = {};
    const bridge = createFakeBridge({
      inject: {
        run: (req) => {
          bridgeRef.current?.emitProgress(
            { stage: 'running', message: '<img src=x onerror="window.__xss = 1">' },
            req.id,
          );
          return gate.promise;
        },
      },
    });
    bridgeRef.current = bridge;
    render(<CountryLockPage bridge={bridge} />);
    await selectBrandAndFirmware();
    await waitFor(() => expect(injectButton()).toBeEnabled());
    await userEvent.click(injectButton());
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/<img src=x/)).toBeInTheDocument();
    expect(dialog.querySelector('img')).toBeNull();
  });

  test('tombol unggah nonaktif dengan penjelasan', async () => {
    setup();
    const upload = await screen.findByRole('button', { name: /unggah ke server/i });
    expect(upload).toBeDisabled();
    expect(screen.getByText(/daftar serial number/i)).toBeInTheDocument();
  });
});

describe('useCountryLock', () => {
  test('loop ping berhenti saat komponen di-unmount', async () => {
    vi.useFakeTimers();
    let pings = 0;
    let reads = 0;
    const bridge = createFakeBridge({
      device: {
        ping: async () => {
          pings += 1;
          return { ok: true, kind: 'success' as const };
        },
        readInfo: async () => {
          reads += 1;
          return { ok: true as const, info: { model: 'M', serial: 'S1', country: 'id' } };
        },
      },
    });
    const { result, unmount } = renderHook(() => useCountryLock(bridge));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.pkg).not.toBeNull();
    act(() => result.current.actions.select('mikrotik', 'AC'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(pings).toBeGreaterThanOrEqual(3);
    expect(reads).toBe(1);

    unmount();
    const pingsAtUnmount = pings;
    const readsAtUnmount = reads;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pings).toBe(pingsAtUnmount);
    expect(reads).toBe(readsAtUnmount);
  });

  test('penjaga re-entry: dua panggilan inject beruntun hanya menjalankan satu inject', async () => {
    const gate = deferred<InjectResult>();
    const run = vi.fn((_req: InjectRequest) => gate.promise);
    const bridge = createFakeBridge({ inject: { run } });
    const { result } = renderHook(() => useCountryLock(bridge));
    await waitFor(() => expect(result.current.pkg).not.toBeNull());
    act(() => result.current.actions.select('mikrotik', 'AC'));
    await waitFor(() => expect(result.current.state.serial).toBe('ABC123'));

    act(() => {
      result.current.actions.inject();
      result.current.actions.inject();
    });
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve({ ok: true, stage: 'completed', message: 'Inject selesai' });
    });
  });

  test('Auto Inject menjalankan inject sekali untuk serial baru dan tidak mengulang serial tercatat', async () => {
    const run = vi.fn(
      async (_req: InjectRequest): Promise<InjectResult> => ({
        ok: true,
        stage: 'completed',
        message: 'Inject selesai',
      }),
    );
    const bridge = createFakeBridge({ inject: { run } });
    const { result } = renderHook(() => useCountryLock(bridge));
    await waitFor(() => expect(result.current.pkg).not.toBeNull());
    act(() => result.current.actions.select('mikrotik', 'AC'));
    await waitFor(() => expect(result.current.state.serial).toBe('ABC123'));
    act(() => result.current.actions.toggleAuto(true));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pending).toHaveLength(1));
    // Perangkat yang sama terbaca lagi setelah inject: sudah tercatat, tidak di-inject ulang.
    await waitFor(() => expect(result.current.state.serial).toBe('ABC123'));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
