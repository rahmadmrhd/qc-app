import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  type BarcodeEngine,
  createBarcodeEngine,
  SCAN_FORMATS,
  ScannerLoadError,
} from '../lib/barcode-engine';
import { loadWasmBarcodeDetector } from '../lib/barcode-fallback';
import { CAMERA_DUPLICATE_WINDOW_MS } from '../lib/camera-payload';
import type { ScanFeedback } from '../lib/scan-feedback';
import { CAMERA_ERROR_TEXT } from '../lib/use-camera-scanner';
import { CameraScanDialog } from './camera-scan-dialog';

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  getCapabilities: () => Record<string, unknown>;
  getSettings: () => { deviceId: string };
  applyConstraints: ReturnType<typeof vi.fn>;
}

function fakeStream(options: { torch?: boolean } = {}) {
  const track: FakeTrack = {
    stop: vi.fn(),
    getCapabilities: () => (options.torch ? { torch: true } : {}),
    getSettings: () => ({ deviceId: 'cam-1' }),
    applyConstraints: vi.fn(async () => undefined),
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true });
}

const VIDEO_DEVICES = [
  { kind: 'videoinput', deviceId: 'cam-1', label: 'Kamera belakang' },
  { kind: 'videoinput', deviceId: 'cam-2', label: 'Kamera depan' },
  { kind: 'audioinput', deviceId: 'mic', label: 'Mikrofon' },
];

/** Mesin palsu: `queue` diisi tes; tiap `detect` mengembalikan isi antrean saat itu. */
function fakeEngine() {
  const state = { current: [] as string[] };
  const engine: BarcodeEngine = { kind: 'native', detect: vi.fn(async () => [...state.current]) };
  return { engine, state };
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    get: () => 4,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
  Reflect.deleteProperty(HTMLMediaElement.prototype, 'readyState');
  Reflect.deleteProperty(document, 'hidden');
});

interface SetupOptions {
  stream?: ReturnType<typeof fakeStream>;
  devices?: unknown[];
  result?: ScanFeedback;
  createEngine?: () => Promise<BarcodeEngine>;
  /** Tiap getUserMedia mengembalikan aliran baru (uji restart); semua tercatat di `streams`. */
  freshStreams?: boolean;
  torch?: boolean;
}

function setup(options: SetupOptions = {}) {
  const media = options.stream ?? fakeStream();
  const streams = [media];
  const getUserMedia = vi.fn(async (_constraints?: unknown) => {
    if (!options.freshStreams || getUserMedia.mock.calls.length === 1) return media.stream;
    const fresh = fakeStream({ torch: options.torch === true });
    streams.push(fresh);
    return fresh.stream;
  });
  setMediaDevices({
    getUserMedia,
    enumerateDevices: vi.fn(async () => options.devices ?? VIDEO_DEVICES.slice(0, 1)),
  });
  const { engine, state } = fakeEngine();
  let time = 5_000_000;
  const onScan = vi.fn((_text: string): ScanFeedback => options.result ?? 'added');
  const onOpenChange = vi.fn();
  const view = render(
    <CameraScanDialog
      open
      onOpenChange={onOpenChange}
      onScan={onScan}
      createEngine={options.createEngine ?? (async () => engine)}
      now={() => time}
    />,
  );
  return {
    ...media,
    ...view,
    streams,
    state,
    engine,
    onScan,
    onOpenChange,
    getUserMedia,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

test('mode berkelanjutan: payload banyak baris dipecah, bacaan sama dalam jendela tidak diteruskan dua kali', async () => {
  const ctx = setup();
  ctx.state.current = ['aaa111\nbbb222'];
  await waitFor(() => expect(ctx.onScan).toHaveBeenCalledTimes(1));
  expect(ctx.onScan).toHaveBeenCalledWith('AAA111\nBBB222');
  // Kamera tetap menyala dan terus membaca bingkai yang sama: tidak ada pengiriman ulang.
  const calls = vi.mocked(ctx.engine.detect).mock.calls.length;
  await waitFor(() =>
    expect(vi.mocked(ctx.engine.detect).mock.calls.length).toBeGreaterThan(calls + 1),
  );
  expect(ctx.onScan).toHaveBeenCalledTimes(1);
  expect(ctx.track.stop).not.toHaveBeenCalled();

  // Hilang dari pandangan lebih lama dari jendela, lalu terlihat lagi: diteruskan lagi.
  ctx.state.current = [];
  ctx.advance(CAMERA_DUPLICATE_WINDOW_MS + 1);
  const afterGap = vi.mocked(ctx.engine.detect).mock.calls.length;
  await waitFor(() =>
    expect(vi.mocked(ctx.engine.detect).mock.calls.length).toBeGreaterThan(afterGap),
  );
  ctx.state.current = ['AAA111'];
  await waitFor(() => expect(ctx.onScan).toHaveBeenCalledTimes(2));
  expect(ctx.onScan).toHaveBeenLastCalledWith('AAA111');
});

test('umpan balik per bacaan: diterima, duplikat, ditolak', async () => {
  for (const [result, text] of [
    ['added', 'Ditambahkan'],
    ['duplicate', 'Sudah ada'],
    ['rejected', 'Ditolak'],
  ] as const) {
    const ctx = setup({ result });
    ctx.state.current = ['SN1'];
    expect(await screen.findByText(`${text}: SN1`)).toBeInTheDocument();
    ctx.unmount();
  }
});

test('senter tampil hanya bila trek mendukung dan menerapkan constraint torch', async () => {
  const supported = setup({ stream: fakeStream({ torch: true }) });
  const button = await screen.findByRole('button', { name: 'Nyalakan senter' });
  await userEvent.click(button);
  expect(supported.track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
  expect(await screen.findByRole('button', { name: 'Matikan senter' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  supported.unmount();

  const unsupported = setup({ stream: fakeStream() });
  await waitFor(() => expect(unsupported.getUserMedia).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /senter/ })).not.toBeInTheDocument();
});

test('pemilih kamera hanya bila ada lebih dari satu perangkat; memilih memulai ulang aliran', async () => {
  const single = setup({ devices: VIDEO_DEVICES.slice(0, 1) });
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  expect(screen.queryByRole('combobox', { name: 'Kamera' })).not.toBeInTheDocument();
  single.unmount();

  const multi = setup({ devices: VIDEO_DEVICES });
  await userEvent.click(await screen.findByRole('combobox', { name: 'Kamera' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Kamera depan' }));
  await waitFor(() => expect(multi.getUserMedia).toHaveBeenCalledTimes(2));
  expect(multi.getUserMedia.mock.calls[1]?.[0]).toMatchObject({
    video: { deviceId: { exact: 'cam-2' } },
  });
  // Aliran lama dimatikan saat berpindah kamera.
  expect(multi.track.stop).toHaveBeenCalled();
});

test.each([
  ['NotAllowedError', 'denied'],
  ['NotFoundError', 'notfound'],
  ['NotReadableError', 'busy'],
  ['Aneh', 'unknown'],
] as const)('galat getUserMedia %s menampilkan pesan jelas', async (name, kind) => {
  const getUserMedia = vi.fn(async () => {
    throw Object.assign(new Error('x'), { name });
  });
  setMediaDevices({ getUserMedia });
  render(<CameraScanDialog open onOpenChange={() => undefined} onScan={() => 'added'} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(CAMERA_ERROR_TEXT[kind]);
  expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
});

test('konteks tidak aman (bukan HTTPS) dan peramban tanpa kamera: pesan jelas tanpa Coba lagi', async () => {
  Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
  render(<CameraScanDialog open onOpenChange={() => undefined} onScan={() => 'added'} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTPS');
  expect(screen.queryByRole('button', { name: 'Coba lagi' })).not.toBeInTheDocument();
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});

test('pemuat pemindai gagal: pesan jelas dan aliran kamera dimatikan', async () => {
  const ctx = setup({
    createEngine: async () => {
      throw new ScannerLoadError();
    },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(CAMERA_ERROR_TEXT.loader);
  expect(ctx.track.stop).toHaveBeenCalled();
});

test('keadaan memuat tampil sebelum kamera siap', async () => {
  let resolveEngine: (engine: BarcodeEngine) => void = () => undefined;
  const ctx = setup({
    createEngine: () =>
      new Promise<BarcodeEngine>((resolve) => {
        resolveEngine = resolve;
      }),
  });
  expect(screen.getByRole('status')).toHaveTextContent('Menyiapkan kamera');
  resolveEngine(ctx.engine);
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
});

test('aliran dimatikan saat dialog ditutup (Tutup) dan saat unmount', async () => {
  const closed = setup();
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Tutup' }));
  expect(closed.onOpenChange).toHaveBeenCalledWith(false);
  closed.unmount();
  expect(closed.track.stop).toHaveBeenCalled();

  const unmounted = setup();
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  expect(unmounted.track.stop).not.toHaveBeenCalled();
  unmounted.unmount();
  expect(unmounted.track.stop).toHaveBeenCalledTimes(1);
});

test('dialog ditutup lewat prop open=false mematikan aliran', async () => {
  const ctx = setup();
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  ctx.rerender(
    <CameraScanDialog open={false} onOpenChange={() => undefined} onScan={() => 'added'} />,
  );
  await waitFor(() => expect(ctx.track.stop).toHaveBeenCalled());
});

test('ketik manual + Enter memakai jalur onScan yang sama dan mengosongkan kolom', async () => {
  const ctx = setup();
  const input = screen.getByLabelText('Ketik serial manual');
  await userEvent.type(input, 'manual-1{Enter}');
  expect(ctx.onScan).toHaveBeenCalledWith('manual-1');
  expect(input).toHaveValue('');
  expect(await screen.findByText('Ditambahkan: manual-1')).toBeInTheDocument();
  // Ketik manual tidak terkena jendela bacaan ulang: pengguna sengaja mengirimnya lagi.
  await userEvent.type(input, 'manual-1{Enter}');
  expect(ctx.onScan).toHaveBeenCalledTimes(2);
  await userEvent.type(input, '{Enter}');
  expect(ctx.onScan).toHaveBeenCalledTimes(2);
});

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test('tab tersembunyi melepas kamera dan tab terlihat menyalakannya lagi tanpa galat; pilihan kamera dipertahankan', async () => {
  const ctx = setup({ freshStreams: true, devices: VIDEO_DEVICES });
  await userEvent.click(await screen.findByRole('combobox', { name: 'Kamera' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Kamera depan' }));
  await waitFor(() => expect(ctx.getUserMedia).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  const running = ctx.streams[1];
  expect(running?.track.stop).not.toHaveBeenCalled();

  setHidden(true);
  await waitFor(() => expect(running?.track.stop).toHaveBeenCalled());
  expect(ctx.getUserMedia).toHaveBeenCalledTimes(2);

  setHidden(false);
  await waitFor(() => expect(ctx.getUserMedia).toHaveBeenCalledTimes(3));
  expect(ctx.getUserMedia.mock.calls[2]?.[0]).toMatchObject({
    video: { deviceId: { exact: 'cam-2' } },
  });
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('tab tersembunyi lalu dialog ditutup: tidak ada aliran baru dan tidak ada yang bocor', async () => {
  const ctx = setup({ freshStreams: true });
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  setHidden(true);
  await waitFor(() => expect(ctx.track.stop).toHaveBeenCalledTimes(1));
  ctx.unmount();
  setHidden(false);
  expect(ctx.getUserMedia).toHaveBeenCalledTimes(1);
  expect(ctx.streams).toHaveLength(1);
  expect(ctx.track.stop).toHaveBeenCalledTimes(1);
});

test('senter default MATI dan kembali mati setiap kamera dimulai ulang', async () => {
  const ctx = setup({
    freshStreams: true,
    torch: true,
    stream: fakeStream({ torch: true }),
    devices: VIDEO_DEVICES,
  });
  const toggle = await screen.findByRole('button', { name: 'Nyalakan senter' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(toggle);
  expect(await screen.findByRole('button', { name: 'Matikan senter' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Ganti kamera = restart: senter mati lagi.
  await userEvent.click(screen.getByRole('combobox', { name: 'Kamera' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Kamera depan' }));
  await waitFor(() => expect(ctx.getUserMedia).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('button', { name: 'Nyalakan senter' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  // Kembali dari tab tersembunyi = restart: tetap mati.
  await userEvent.click(screen.getByRole('button', { name: 'Nyalakan senter' }));
  await screen.findByRole('button', { name: 'Matikan senter' });
  setHidden(true);
  setHidden(false);
  await waitFor(() => expect(ctx.getUserMedia).toHaveBeenCalledTimes(3));
  expect(await screen.findByRole('button', { name: 'Nyalakan senter' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('galat unduh WASM sungguhan sampai ke "Fitur scan gagal dimuat" dengan Coba lagi, tanpa loop diam-diam', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let failing = true;
  const purge = vi.fn();
  class Detector {
    detect = vi.fn(async () => []);
  }
  const createEngine = () =>
    createBarcodeEngine({
      native: undefined,
      formats: SCAN_FORMATS,
      loadFallback: () =>
        loadWasmBarcodeDetector(async () => ({
          BarcodeDetector: Detector,
          purgeZXingModule: purge,
          prepareZXingModule: async () => {
            if (failing) throw new Error('wasm 404');
            return {};
          },
        })),
    });
  const ctx = setup({ createEngine });
  expect(await screen.findByRole('alert')).toHaveTextContent(CAMERA_ERROR_TEXT.loader);
  expect(CAMERA_ERROR_TEXT.loader).toContain('Fitur scan gagal dimuat');
  expect(purge).toHaveBeenCalledTimes(1);
  expect(ctx.track.stop).toHaveBeenCalled();
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(consoleError).not.toHaveBeenCalled();

  failing = false;
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  consoleError.mockRestore();
});

test('konteks aman tetapi tanpa getUserMedia: pesan "tidak mendukung", tanpa Coba lagi', async () => {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
  render(<CameraScanDialog open onOpenChange={() => undefined} onScan={() => 'added'} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(CAMERA_ERROR_TEXT.unsupported);
  expect(screen.queryByRole('button', { name: 'Coba lagi' })).not.toBeInTheDocument();
});

test('fokus awal tidak jatuh ke kolom ketik manual (papan ketik ponsel); tetap di dalam dialog', async () => {
  setup();
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(dialog).toHaveFocus());
  expect(screen.getByLabelText('Ketik serial manual')).not.toHaveFocus();
  expect(dialog.contains(document.activeElement)).toBe(true);
});

test('dalam keadaan galat, tab tersembunyi lalu terlihat TIDAK memicu percobaan lagi; Coba lagi tetap jalan', async () => {
  const getUserMedia = vi.fn(async () => {
    throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
  });
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  render(<CameraScanDialog open onOpenChange={() => undefined} onScan={() => 'added'} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(CAMERA_ERROR_TEXT.denied);
  expect(getUserMedia).toHaveBeenCalledTimes(1);

  setHidden(true);
  setHidden(false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(getUserMedia).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toHaveTextContent(CAMERA_ERROR_TEXT.denied);

  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
});

test('batas waktu memuat pemindai: gagal dimuat dengan Coba lagi; hasil terlambat tidak menimpa keadaan galat', async () => {
  let finishLate: () => void = () => undefined;
  let hang = true;
  const purge = vi.fn();
  class Detector {
    detect = vi.fn(async () => []);
  }
  const createEngine = () =>
    createBarcodeEngine({
      native: undefined,
      formats: SCAN_FORMATS,
      loadFallback: () =>
        loadWasmBarcodeDetector(
          async () => ({
            BarcodeDetector: Detector,
            purgeZXingModule: purge,
            prepareZXingModule: () =>
              hang
                ? new Promise((resolve) => {
                    finishLate = () => resolve({});
                  })
                : Promise.resolve({}),
          }),
          60,
        ),
    });
  const ctx = setup({ createEngine });
  expect(await screen.findByRole('alert')).toHaveTextContent(CAMERA_ERROR_TEXT.loader);
  expect(purge).toHaveBeenCalledTimes(1);
  expect(ctx.track.stop).toHaveBeenCalled();

  // Pemuatan yang lambat akhirnya selesai: keadaan galat tetap, kamera tidak menyala sendiri.
  finishLate();
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(screen.getByRole('alert')).toHaveTextContent(CAMERA_ERROR_TEXT.loader);
  expect(ctx.getUserMedia).toHaveBeenCalledTimes(1);

  hang = false;
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

test('restart cepat: pemuatan run lama yang selesai terlambat tidak menimpa pratinjau, trek, atau senter run baru', async () => {
  const first = fakeStream({ torch: true });
  const second = fakeStream({ torch: true });
  let resolveFirst: (stream: MediaStream) => void = () => undefined;
  const getUserMedia = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValueOnce(second.stream);
  setMediaDevices({ getUserMedia, enumerateDevices: vi.fn(async () => []) });
  const { engine } = fakeEngine();
  render(
    <CameraScanDialog
      open
      onOpenChange={() => undefined}
      onScan={() => 'added'}
      createEngine={async () => engine}
    />,
  );
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
  // Run pertama masih menunggu izin; tab disembunyikan dan ditampilkan lagi = run kedua.
  setHidden(true);
  setHidden(false);
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  const toggle = await screen.findByRole('button', { name: 'Nyalakan senter' });
  const video = screen.getByLabelText('Pratinjau kamera') as HTMLVideoElement;
  expect(video.srcObject).toBe(second.stream);

  // Run pertama baru selesai sekarang: alirannya dihentikan, milik run kedua tidak disentuh.
  await act(async () => {
    resolveFirst(first.stream);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(first.track.stop).toHaveBeenCalled();
  expect(second.track.stop).not.toHaveBeenCalled();
  expect(video.srcObject).toBe(second.stream);
  await userEvent.click(toggle);
  expect(second.track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
  expect(first.track.applyConstraints).not.toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: 'Matikan senter' })).toBeInTheDocument();
});

test('senter: applyConstraints yang selesai setelah restart tidak mengubah tombol senter run baru', async () => {
  const first = fakeStream({ torch: true });
  const second = fakeStream({ torch: true });
  let finishConstraint: () => void = () => undefined;
  first.track.applyConstraints.mockImplementation(
    () =>
      new Promise<undefined>((resolve) => {
        finishConstraint = () => resolve(undefined);
      }),
  );
  const getUserMedia = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValue(second.stream);
  setMediaDevices({ getUserMedia, enumerateDevices: vi.fn(async () => []) });
  const { engine } = fakeEngine();
  render(
    <CameraScanDialog
      open
      onOpenChange={() => undefined}
      onScan={() => 'added'}
      createEngine={async () => engine}
    />,
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Nyalakan senter' }));
  setHidden(true);
  setHidden(false);
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  await screen.findByRole('button', { name: 'Nyalakan senter' });
  await act(async () => {
    finishConstraint();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(screen.getByRole('button', { name: 'Nyalakan senter' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
