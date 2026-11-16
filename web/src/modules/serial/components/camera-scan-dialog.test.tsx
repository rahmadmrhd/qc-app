import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import type { LocatedCode } from '../lib/scan-region';
import { CAMERA_ERROR_TEXT, TAP_FOCUS_RESTORE_MS } from '../lib/use-camera-scanner';
import { CameraScanDialog } from './camera-scan-dialog';

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  getCapabilities: () => Record<string, unknown>;
  getSettings: () => Record<string, unknown>;
  applyConstraints: ReturnType<typeof vi.fn>;
}

function fakeStream(
  options: {
    torch?: boolean;
    caps?: Record<string, unknown>;
    settings?: Record<string, unknown>;
  } = {},
) {
  const track: FakeTrack = {
    stop: vi.fn(),
    getCapabilities: () => ({ ...(options.torch ? { torch: true } : {}), ...options.caps }),
    getSettings: () => ({ deviceId: 'cam-1', ...options.settings }),
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
  const state = { current: [] as string[], located: null as LocatedCode[] | null };
  const engine: BarcodeEngine = {
    kind: 'native',
    detect: vi.fn(async () => [...state.current]),
    detectCodes: vi.fn(
      async () => state.located ?? state.current.map((text) => ({ text, box: null })),
    ),
  };
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
  const calls = vi.mocked(ctx.engine.detectCodes).mock.calls.length;
  await waitFor(() =>
    expect(vi.mocked(ctx.engine.detectCodes).mock.calls.length).toBeGreaterThan(calls + 1),
  );
  expect(ctx.onScan).toHaveBeenCalledTimes(1);
  expect(ctx.track.stop).not.toHaveBeenCalled();

  // Hilang dari pandangan lebih lama dari jendela, lalu terlihat lagi: diteruskan lagi.
  ctx.state.current = [];
  ctx.advance(CAMERA_DUPLICATE_WINDOW_MS + 1);
  const afterGap = vi.mocked(ctx.engine.detectCodes).mock.calls.length;
  await waitFor(() =>
    expect(vi.mocked(ctx.engine.detectCodes).mock.calls.length).toBeGreaterThan(afterGap),
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

function stubVideoGeometry(video: { w: number; h: number }, box: { w: number; h: number }) {
  const define = (name: string, value: number) =>
    Object.defineProperty(HTMLVideoElement.prototype, name, {
      configurable: true,
      get: () => value,
    });
  define('videoWidth', video.w);
  define('videoHeight', video.h);
  define('clientWidth', box.w);
  define('clientHeight', box.h);
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  return drawImage;
}

afterEach(() => {
  for (const key of ['videoWidth', 'videoHeight', 'clientWidth', 'clientHeight']) {
    Reflect.deleteProperty(HTMLVideoElement.prototype, key);
  }
});

test('viewport persegi 1:1 dengan bingkai area scan 80% x 50% di tengah dan petunjuk', async () => {
  setup();
  const viewport = screen.getByTestId('camera-viewport');
  expect(viewport.className).toContain('aspect-square');
  expect(viewport.className).toContain('55dvh');
  expect(screen.getByLabelText('Pratinjau kamera').className).toContain('object-cover');
  const frame = screen.getByTestId('scan-frame');
  expect(frame).toHaveStyle({ width: '80%', height: '50%' });
  expect(viewport.contains(frame)).toBe(true);
  expect(screen.getByText('Arahkan kode ke dalam bingkai')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
});

test('pembaca menerima potongan bingkai (kanvas), bukan seluruh video; kanvas dipakai ulang', async () => {
  // Video landscape 1280x720 di kotak persegi 300x300: sisi kiri-kanan terpotong oleh `cover`.
  const drawImage = stubVideoGeometry({ w: 1280, h: 720 }, { w: 300, h: 300 });
  const ctx = setup();
  await waitFor(() =>
    expect(vi.mocked(ctx.engine.detectCodes).mock.calls.length).toBeGreaterThan(2),
  );
  const sources = vi.mocked(ctx.engine.detectCodes).mock.calls.map((call) => call[0]);
  const video = screen.getByLabelText('Pratinjau kamera');
  for (const source of sources) {
    expect(source).toBeInstanceOf(HTMLCanvasElement);
    expect(source).not.toBe(video);
  }
  expect(new Set(sources).size).toBe(1);
  const [src, sx, sy, sw, sh, dx, dy, dw, dh] = drawImage.mock.calls[0] ?? [];
  expect(src).toBe(video);
  // Bingkai 240x150 di layar = 576x360 piksel video (skala 300/720), di tengah video.
  expect(sw).toBeGreaterThanOrEqual(576);
  expect(sw).toBeLessThanOrEqual(578);
  expect(sh).toBeGreaterThanOrEqual(360);
  expect(sh).toBeLessThanOrEqual(362);
  expect(sx + sw / 2).toBeCloseTo(640, 0);
  expect(sy + sh / 2).toBeCloseTo(360, 0);
  expect([dx, dy, dw, dh]).toEqual([0, 0, sw, sh]);
  expect((sources[0] as HTMLCanvasElement).width).toBe(sw);
});

test('dua kode dalam satu bingkai: hanya yang paling dekat pusat bingkai diteruskan', async () => {
  stubVideoGeometry({ w: 720, h: 1280 }, { w: 300, h: 300 });
  const ctx = setup();
  // Potongan 576x360: pusat (288, 180).
  ctx.state.located = [
    { text: 'JAUH', box: { x: 0, y: 0, width: 60, height: 60 } },
    { text: 'TENGAH', box: { x: 258, y: 150, width: 60, height: 60 } },
  ];
  await waitFor(() => expect(ctx.onScan).toHaveBeenCalledTimes(1));
  expect(ctx.onScan).toHaveBeenCalledWith('TENGAH');
  const calls = vi.mocked(ctx.engine.detectCodes).mock.calls.length;
  await waitFor(() =>
    expect(vi.mocked(ctx.engine.detectCodes).mock.calls.length).toBeGreaterThan(calls + 1),
  );
  expect(ctx.onScan).toHaveBeenCalledTimes(1);
});

test('bacaan parsial yang berganti-ganti (bingkai buram) tidak pernah diteruskan; yang stabil diteruskan', async () => {
  const ctx = setup();
  const partial = ['602232C88836', '602232106', '602232183W'];
  let index = 0;
  vi.mocked(ctx.engine.detectCodes).mockImplementation(async () => [
    { text: partial[index++ % partial.length] as string, format: 'code_128', box: null },
  ]);
  await waitFor(
    () => expect(vi.mocked(ctx.engine.detectCodes).mock.calls.length).toBeGreaterThanOrEqual(8),
    { timeout: 3000 },
  );
  expect(ctx.onScan).not.toHaveBeenCalled();

  vi.mocked(ctx.engine.detectCodes).mockImplementation(async () => [
    { text: '602232C88836', format: 'code_128', box: null },
  ]);
  await waitFor(() => expect(ctx.onScan).toHaveBeenCalledTimes(1));
  expect(ctx.onScan).toHaveBeenCalledWith('602232C88836');
});

test.each([
  ['qr_code', 2],
  ['data_matrix', 2],
  ['code_128', 3],
  [undefined, 3],
] as const)('format %s diterima pada bingkai ke-%i yang sama', async (format, frames) => {
  const ctx = setup();
  let callsAtScan = 0;
  ctx.onScan.mockImplementation(() => {
    callsAtScan = vi.mocked(ctx.engine.detectCodes).mock.calls.length;
    return 'added';
  });
  vi.mocked(ctx.engine.detectCodes).mockImplementation(async () => [
    { text: 'SN-1', ...(format ? { format } : {}), box: null },
  ]);
  await waitFor(() => expect(ctx.onScan).toHaveBeenCalledTimes(1));
  expect(callsAtScan).toBe(frames);
});

test('getUserMedia meminta resolusi ideal 1920x1080 (ideal, bukan exact), baik tanpa maupun dengan pilihan kamera', async () => {
  const ctx = setup({ devices: VIDEO_DEVICES });
  await waitFor(() => expect(ctx.getUserMedia).toHaveBeenCalledTimes(1));
  expect(ctx.getUserMedia.mock.calls[0]?.[0]).toEqual({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
  await userEvent.click(await screen.findByRole('combobox', { name: 'Kamera' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Kamera depan' }));
  await waitFor(() => expect(ctx.getUserMedia).toHaveBeenCalledTimes(2));
  expect(ctx.getUserMedia.mock.calls[1]?.[0]).toEqual({
    audio: false,
    video: { deviceId: { exact: 'cam-2' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
});

test('fokus kontinu diterapkan bila trek mendukung; tanpa dukungan tidak ada yang diterapkan', async () => {
  const supported = setup({
    stream: fakeStream({ caps: { focusMode: ['manual', 'single-shot', 'continuous'] } }),
  });
  await waitFor(() =>
    expect(supported.track.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ focusMode: 'continuous' }],
    }),
  );
  supported.unmount();

  const plain = setup();
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  expect(plain.track.applyConstraints).not.toHaveBeenCalled();
});

test('fokus kontinu yang ditolak peramban tidak menjadi galat', async () => {
  const stream = fakeStream({ caps: { focusMode: ['continuous'] } });
  stream.track.applyConstraints.mockRejectedValue(new Error('tidak didukung'));
  setup({ stream });
  await waitFor(() => expect(stream.track.applyConstraints).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('zoom: kontrol tampil hanya bila didukung, mulai 1x tanpa menerapkan apa pun, dan menerapkan constraint zoom', async () => {
  const stream = fakeStream({ caps: { zoom: { min: 1, max: 5, step: 0.1 } } });
  setup({ stream });
  const slider = await screen.findByRole('slider', { name: 'Zoom' });
  expect(slider).toHaveValue('1');
  expect(screen.getByTestId('zoom-value')).toHaveTextContent('1x');
  expect(stream.track.applyConstraints).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Perkecil zoom' })).toBeDisabled();

  await userEvent.click(screen.getByRole('button', { name: 'Perbesar zoom' }));
  expect(stream.track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 1.5 }] });
  expect(screen.getByTestId('zoom-value')).toHaveTextContent('1,5x');
  expect(screen.getByRole('button', { name: 'Perkecil zoom' })).toBeEnabled();

  fireEvent.change(slider, { target: { value: '3' } });
  expect(stream.track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 3 }] });
  expect(screen.getByTestId('zoom-value')).toHaveTextContent('3x');

  await userEvent.click(screen.getByRole('button', { name: 'Perkecil zoom' }));
  expect(stream.track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 2.5 }] });
});

test('zoom: tanpa dukungan kontrol zoom tersembunyi; zoom yang gagal diterapkan dikembalikan', async () => {
  const none = setup();
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  expect(screen.queryByRole('slider', { name: 'Zoom' })).not.toBeInTheDocument();
  none.unmount();

  const stream = fakeStream({ caps: { zoom: { min: 1, max: 4, step: 0.5 } } });
  stream.track.applyConstraints.mockRejectedValue(new Error('x'));
  setup({ stream });
  await userEvent.click(await screen.findByRole('button', { name: 'Perbesar zoom' }));
  await waitFor(() => expect(screen.getByTestId('zoom-value')).toHaveTextContent('1x'));
});

test('zoom kembali ke 1x saat kamera dimulai ulang (ganti kamera)', async () => {
  const caps = { zoom: { min: 1, max: 5, step: 0.1 } };
  const ctx = setup({ stream: fakeStream({ caps }), devices: VIDEO_DEVICES, freshStreams: true });
  await userEvent.click(await screen.findByRole('button', { name: 'Perbesar zoom' }));
  expect(screen.getByTestId('zoom-value')).toHaveTextContent('1,5x');
  await userEvent.click(screen.getByRole('combobox', { name: 'Kamera' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Kamera depan' }));
  await waitFor(() => expect(ctx.getUserMedia).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  expect(screen.queryByTestId('zoom-value')).not.toBeInTheDocument();
});

function stubVideoRect(width: number, height: number) {
  vi.spyOn(HTMLVideoElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    width,
    height,
    toJSON: () => ({}),
  });
}

function focusModeOf(call: unknown[]): string | undefined {
  return (call[0] as { advanced: { focusMode?: string }[] }).advanced[0]?.focusMode;
}

test('ketuk-untuk-fokus: fokus sekali ke titik ketukan (memperhitungkan cover), cincin tampil, lalu kembali ke kontinu', async () => {
  stubVideoGeometry({ w: 1280, h: 720 }, { w: 300, h: 300 });
  stubVideoRect(300, 300);
  const stream = fakeStream({ caps: { focusMode: ['continuous', 'single-shot'] } });
  setup({ stream });
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  const continuous = () =>
    stream.track.applyConstraints.mock.calls.filter((call) => focusModeOf(call) === 'continuous')
      .length;
  expect(continuous()).toBe(1);

  fireEvent.click(screen.getByTestId('camera-viewport'), { clientX: 0, clientY: 150 });
  const shot = stream.track.applyConstraints.mock.calls.find(
    (call) => focusModeOf(call) === 'single-shot',
  );
  expect(shot).toBeDefined();
  const point = (
    shot?.[0] as { advanced: { pointsOfInterest: { x: number; y: number }[] }[] } | undefined
  )?.advanced[0]?.pointsOfInterest[0];
  // Tepi kiri kotak = 116,67 dari 533,33 lebar video tampil; tengah vertikal = 0,5.
  expect(point?.x).toBeCloseTo(116.6667 / 533.3333, 4);
  expect(point?.y).toBeCloseTo(0.5, 5);
  expect(screen.getByTestId('focus-ring')).toHaveStyle({ left: '0px', top: '150px' });

  await waitFor(() => expect(continuous()).toBe(2), { timeout: TAP_FOCUS_RESTORE_MS + 1500 });
  await waitFor(() => expect(screen.queryByTestId('focus-ring')).not.toBeInTheDocument());
});

test('ketuk-untuk-fokus tanpa dukungan single-shot: ketukan tidak melakukan apa-apa', async () => {
  stubVideoGeometry({ w: 1280, h: 720 }, { w: 300, h: 300 });
  stubVideoRect(300, 300);
  const stream = fakeStream({ caps: { focusMode: ['continuous'] } });
  setup({ stream });
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  const before = stream.track.applyConstraints.mock.calls.length;
  fireEvent.click(screen.getByTestId('camera-viewport'), { clientX: 100, clientY: 100 });
  expect(stream.track.applyConstraints.mock.calls.length).toBe(before);
  expect(screen.queryByTestId('focus-ring')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('ketukan di atas tombol di dalam viewport (mis. Coba lagi) tidak memicu fokus', async () => {
  stubVideoGeometry({ w: 1280, h: 720 }, { w: 300, h: 300 });
  stubVideoRect(300, 300);
  const stream = fakeStream({ caps: { focusMode: ['single-shot'] } });
  setup({ stream });
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  const button = document.createElement('button');
  screen.getByTestId('camera-viewport').appendChild(button);
  fireEvent.click(button, { clientX: 10, clientY: 10 });
  expect(stream.track.applyConstraints).not.toHaveBeenCalled();
  expect(screen.queryByTestId('focus-ring')).not.toBeInTheDocument();
});

test('label kamera Android dijadikan nama yang mudah dipahami di pemilih kamera', async () => {
  setup({
    devices: [
      { kind: 'videoinput', deviceId: 'cam-1', label: 'camera2 0, facing back' },
      { kind: 'videoinput', deviceId: 'cam-2', label: 'camera2 1, facing front' },
    ],
  });
  await userEvent.click(await screen.findByRole('combobox', { name: 'Kamera' }));
  expect(await screen.findByRole('option', { name: 'Kamera belakang' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Kamera depan' })).toBeInTheDocument();
});

test('petunjuk buram menyesuaikan dukungan: ketuk layar bila bisa, atur zoom bila hanya zoom', async () => {
  const tap = setup({ stream: fakeStream({ caps: { focusMode: ['single-shot'] } }) });
  expect(await screen.findByText(/ketuk layar untuk fokus/)).toBeInTheDocument();
  tap.unmount();
  setup({ stream: fakeStream({ caps: { zoom: { min: 1, max: 4, step: 0.1 } } }) });
  expect(await screen.findByText(/lalu atur zoom/)).toBeInTheDocument();
  expect(screen.queryByText(/ketuk layar untuk fokus/)).not.toBeInTheDocument();
});
