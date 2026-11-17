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

vi.mock('sonner', () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }));

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

type ScanFeedbackCase = 'added' | 'duplicate' | 'rejected';

interface SetupOptions {
  stream?: ReturnType<typeof fakeStream>;
  devices?: unknown[];
  result?: ScanFeedback;
  createEngine?: () => Promise<BarcodeEngine>;
  /** Tiap getUserMedia mengembalikan aliran baru (uji restart); semua tercatat di `streams`. */
  freshStreams?: boolean;
  torch?: boolean;
  isKnown?: (serial: string) => boolean;
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
      isKnown={options.isKnown}
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

/** Teks semua kolom serial di tabel internal, menurut urutan baris. */
function tableSerials(): string[] {
  return screen
    .queryAllByRole('textbox', { name: /^Serial nomor/ })
    .map((input) => (input as HTMLInputElement).value);
}

test('mode berkelanjutan: payload banyak baris dipecah ke baris tabel, tidak langsung dikirim, bacaan sama tidak menambah baris', async () => {
  const ctx = setup();
  ctx.state.current = ['aaa111\nbbb222'];
  await waitFor(() => expect(tableSerials()).toEqual(['AAA111', 'BBB222']));
  // Belum ada yang dikirim ke pemakai: hanya masuk tabel internal.
  expect(ctx.onScan).not.toHaveBeenCalled();
  // Kamera tetap menyala dan terus membaca bingkai yang sama: tidak ada baris ganda.
  const calls = vi.mocked(ctx.engine.detectCodes).mock.calls.length;
  await waitFor(() =>
    expect(vi.mocked(ctx.engine.detectCodes).mock.calls.length).toBeGreaterThan(calls + 1),
  );
  expect(tableSerials()).toEqual(['AAA111', 'BBB222']);
  expect(ctx.track.stop).not.toHaveBeenCalled();

  // Hilang dari pandangan lebih lama dari jendela, lalu terlihat lagi: sudah ada di tabel, jadi "Sudah ada", tanpa baris baru.
  ctx.state.current = [];
  ctx.advance(CAMERA_DUPLICATE_WINDOW_MS + 1);
  const afterGap = vi.mocked(ctx.engine.detectCodes).mock.calls.length;
  await waitFor(() =>
    expect(vi.mocked(ctx.engine.detectCodes).mock.calls.length).toBeGreaterThan(afterGap),
  );
  ctx.state.current = ['AAA111'];
  expect(await screen.findByText('Sudah ada: AAA111')).toBeInTheDocument();
  expect(tableSerials()).toEqual(['AAA111', 'BBB222']);
  expect(ctx.onScan).not.toHaveBeenCalled();
});

test('umpan balik per bacaan: ditambahkan, sudah ada (di draft), ditolak', async () => {
  const cases: [ScanFeedbackCase, string, string][] = [
    ['added', 'SN1', 'Ditambahkan: SN1'],
    ['duplicate', 'SN1', 'Sudah ada: SN1'],
    ['rejected', 'SN\u00071', 'Ditolak: SN\u00071'],
  ];
  for (const [kind, text, expected] of cases) {
    const ctx = setup({ isKnown: kind === 'duplicate' ? (serial) => serial === 'SN1' : undefined });
    ctx.state.current = [text];
    expect(await screen.findByText(expected)).toBeInTheDocument();
    // Hanya yang ditambahkan menjadi baris.
    await waitFor(() => expect(tableSerials()).toEqual(kind === 'added' ? ['SN1'] : []));
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

test('tombol ganti kamera hanya bila ada lebih dari satu perangkat; menekannya memulai ulang aliran dengan kamera berikutnya', async () => {
  const single = setup({ devices: VIDEO_DEVICES.slice(0, 1) });
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /Ganti kamera/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  single.unmount();

  const multi = setup({ devices: VIDEO_DEVICES });
  const button = await screen.findByRole('button', { name: 'Ganti kamera' });
  // Nama kamera berikutnya tersedia sebagai tooltip.
  expect(button).toHaveAttribute('title', 'Ganti ke Kamera depan');
  await userEvent.click(button);
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

test('aliran dimatikan saat dialog ditutup (Batal tanpa hasil) dan saat unmount', async () => {
  const closed = setup();
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
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

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test('tab tersembunyi melepas kamera dan tab terlihat menyalakannya lagi tanpa galat; pilihan kamera dipertahankan', async () => {
  const ctx = setup({ freshStreams: true, devices: VIDEO_DEVICES });
  await userEvent.click(await screen.findByRole('button', { name: 'Ganti kamera' }));
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
  await userEvent.click(screen.getByRole('button', { name: 'Ganti kamera' }));
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

test('fokus awal jatuh ke cangkang dialog (bukan tombol Batal/kolom serial: papan ketik ponsel tidak muncul); tetap di dalam dialog', async () => {
  setup();
  const dialog = await screen.findByRole('alertdialog');
  await waitFor(() => expect(dialog).toHaveFocus());
  expect(screen.getByRole('button', { name: 'Batal' })).not.toHaveFocus();
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

test('area kamera selebar dialog (bukan persegi) dengan bingkai area scan 80% x 50% di tengah dan petunjuk di dalamnya', async () => {
  setup();
  const viewport = screen.getByTestId('camera-viewport');
  expect(viewport.className).not.toContain('aspect-square');
  expect(viewport.className).toContain('55dvh');
  expect(screen.getByLabelText('Pratinjau kamera').className).toContain('object-cover');
  const frame = screen.getByTestId('scan-frame');
  expect(frame).toHaveStyle({ width: '80%', height: '50%' });
  expect(viewport.contains(frame)).toBe(true);
  const tip = screen.getByText(/Arahkan kode ke dalam bingkai/);
  expect(viewport.contains(tip)).toBe(true);
  // Petunjuk tidak berada di dalam elemen bingkai (tidak menutupinya).
  expect(frame.contains(tip)).toBe(false);
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
});

test('dialog = AlertDialog layar penuh dengan judul dan deskripsi untuk pembaca layar', async () => {
  setup();
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveAttribute('data-size', 'full');
  expect(dialog).toHaveAccessibleName('Scan serial');
  expect(dialog).toHaveAccessibleDescription(/Hasil scan masuk ke tabel/);
  // Tombol tutup (X) bawaan tidak ada: keluar lewat Batal.
  expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Batal' })).toBeInTheDocument();
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
  await waitFor(() => expect(tableSerials()).toEqual(['TENGAH']));
  const calls = vi.mocked(ctx.engine.detectCodes).mock.calls.length;
  await waitFor(() =>
    expect(vi.mocked(ctx.engine.detectCodes).mock.calls.length).toBeGreaterThan(calls + 1),
  );
  expect(tableSerials()).toEqual(['TENGAH']);
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
  expect(tableSerials()).toEqual([]);

  vi.mocked(ctx.engine.detectCodes).mockImplementation(async () => [
    { text: '602232C88836', format: 'code_128', box: null },
  ]);
  await waitFor(() => expect(tableSerials()).toEqual(['602232C88836']));
});

test.each([
  ['qr_code', 2],
  ['data_matrix', 2],
  ['code_128', 3],
  [undefined, 3],
] as const)('format %s diterima pada bingkai ke-%i yang sama', async (format, frames) => {
  // Jumlah panggilan pembaca saat bacaan pertama diteruskan (dicatat lewat `isKnown`, yang dipanggil saat menambah baris).
  let callsAtScan = 0;
  let detectCodes: { mock: { calls: unknown[] } } | undefined;
  const ctx = setup({
    isKnown: () => {
      if (callsAtScan === 0) callsAtScan = detectCodes?.mock.calls.length ?? 0;
      return false;
    },
  });
  detectCodes = vi.mocked(ctx.engine.detectCodes);
  vi.mocked(ctx.engine.detectCodes).mockImplementation(async () => [
    { text: 'SN-1', ...(format ? { format } : {}), box: null },
  ]);
  await waitFor(() => expect(tableSerials()).toEqual(['SN-1']));
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
  await userEvent.click(await screen.findByRole('button', { name: 'Ganti kamera' }));
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
  expect(slider).toHaveAttribute('aria-orientation', 'vertical');
  expect(screen.getByTestId('zoom-value')).toHaveTextContent('1x');
  expect(stream.track.applyConstraints).not.toHaveBeenCalled();

  fireEvent.change(slider, { target: { value: '1.5' } });
  expect(stream.track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 1.5 }] });
  expect(screen.getByTestId('zoom-value')).toHaveTextContent('1,5x');
  expect(slider).toHaveAttribute('aria-valuetext', '1,5x');

  fireEvent.change(slider, { target: { value: '3' } });
  expect(stream.track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 3 }] });
  expect(screen.getByTestId('zoom-value')).toHaveTextContent('3x');
});

test('zoom: mengetuk label zoom mengembalikan ke 1x', async () => {
  const stream = fakeStream({ caps: { zoom: { min: 1, max: 5, step: 0.1 } } });
  setup({ stream });
  const slider = await screen.findByRole('slider', { name: 'Zoom' });
  fireEvent.change(slider, { target: { value: '2.5' } });
  expect(screen.getByTestId('zoom-value')).toHaveTextContent('2,5x');
  await userEvent.click(screen.getByTestId('zoom-value'));
  expect(stream.track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 1 }] });
  expect(screen.getByTestId('zoom-value')).toHaveTextContent('1x');
});

test('zoom: tanpa dukungan kontrol zoom tersembunyi; zoom yang gagal diterapkan dikembalikan', async () => {
  const none = setup();
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  expect(screen.queryByRole('slider', { name: 'Zoom' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('zoom-value')).not.toBeInTheDocument();
  none.unmount();

  const stream = fakeStream({ caps: { zoom: { min: 1, max: 4, step: 0.5 } } });
  stream.track.applyConstraints.mockRejectedValue(new Error('x'));
  setup({ stream });
  fireEvent.change(await screen.findByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });
  await waitFor(() => expect(screen.getByTestId('zoom-value')).toHaveTextContent('1x'));
});

test('zoom kembali ke 1x saat kamera dimulai ulang (ganti kamera)', async () => {
  const caps = { zoom: { min: 1, max: 5, step: 0.1 } };
  const ctx = setup({ stream: fakeStream({ caps }), devices: VIDEO_DEVICES, freshStreams: true });
  fireEvent.change(await screen.findByRole('slider', { name: 'Zoom' }), {
    target: { value: '1.5' },
  });
  expect(screen.getByTestId('zoom-value')).toHaveTextContent('1,5x');
  await userEvent.click(screen.getByRole('button', { name: 'Ganti kamera' }));
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

test('ketuk-untuk-fokus: fokus sekali ke titik ketukan (memperhitungkan cover), cincin tampil, lalu kembali ke kontinu dengan titik tengah', async () => {
  stubVideoGeometry({ w: 1280, h: 720 }, { w: 300, h: 300 });
  stubVideoRect(300, 300);
  const stream = fakeStream({ caps: { focusMode: ['continuous', 'single-shot'] } });
  setup({ stream });
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  const continuous = () =>
    stream.track.applyConstraints.mock.calls.filter((call) => focusModeOf(call) === 'continuous');
  expect(continuous()).toHaveLength(1);

  // Timer palsa dinyalakan hanya setelah kamera siap: timer pemindaian yang sudah berjalan tak terganggu.
  vi.useFakeTimers();
  try {
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

    // Single-shot yang lambat tidak dipotong: belum kembali ke kontinu sebelum jedanya habis.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TAP_FOCUS_RESTORE_MS - 1);
    });
    expect(continuous()).toHaveLength(1);
    expect(screen.queryByTestId('focus-ring')).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(continuous()).toHaveLength(2);
    const restore = continuous()[1]?.[0] as {
      advanced: { focusMode: string; pointsOfInterest?: { x: number; y: number }[] }[];
    };
    expect(restore.advanced[0]?.pointsOfInterest).toEqual([{ x: 0.5, y: 0.5 }]);
    expect(restore.advanced[1]).toEqual({ focusMode: 'continuous' });
  } finally {
    vi.useRealTimers();
  }
});

test('ketukan kedua sebelum jeda habis menjadwalkan ulang kembali ke kontinu (tidak ganda)', async () => {
  stubVideoGeometry({ w: 1280, h: 720 }, { w: 300, h: 300 });
  stubVideoRect(300, 300);
  const stream = fakeStream({ caps: { focusMode: ['continuous', 'single-shot'] } });
  setup({ stream });
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  const continuous = () =>
    stream.track.applyConstraints.mock.calls.filter((call) => focusModeOf(call) === 'continuous');
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByTestId('camera-viewport'), { clientX: 100, clientY: 100 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TAP_FOCUS_RESTORE_MS - 500);
    });
    fireEvent.click(screen.getByTestId('camera-viewport'), { clientX: 120, clientY: 120 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TAP_FOCUS_RESTORE_MS - 1);
    });
    expect(continuous()).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(continuous()).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
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

test('label kamera Android dijadikan nama yang mudah dipahami di tooltip tombol ganti kamera', async () => {
  setup({
    devices: [
      { kind: 'videoinput', deviceId: 'cam-1', label: 'camera2 0, facing back' },
      { kind: 'videoinput', deviceId: 'cam-2', label: 'camera2 1, facing front' },
    ],
  });
  expect(await screen.findByRole('button', { name: 'Ganti kamera' })).toHaveAttribute(
    'title',
    'Ganti ke Kamera depan',
  );
});

test('petunjuk buram menyesuaikan dukungan: ketuk layar bila bisa, atur zoom bila hanya zoom', async () => {
  const tap = setup({ stream: fakeStream({ caps: { focusMode: ['single-shot'] } }) });
  expect(await screen.findByText(/ketuk layar untuk fokus/)).toBeInTheDocument();
  tap.unmount();
  setup({ stream: fakeStream({ caps: { zoom: { min: 1, max: 4, step: 0.1 } } }) });
  expect(await screen.findByText(/lalu atur zoom kalau buram/)).toBeInTheDocument();
  expect(screen.queryByText(/ketuk layar untuk fokus/)).not.toBeInTheDocument();
});

test('kontrol mengambang: slider zoom terbaca (aria-valuetext) dan semua tombol berukuran sentuh 44 px', async () => {
  setup({
    stream: fakeStream({ torch: true, caps: { zoom: { min: 1, max: 5, step: 0.1 } } }),
    devices: VIDEO_DEVICES,
  });
  const slider = await screen.findByRole('slider', { name: 'Zoom' });
  expect(slider).toHaveAttribute('aria-valuetext', '1x');
  for (const name of [/senter/, 'Ganti kamera', /^Zoom 1x/]) {
    expect((await screen.findByRole('button', { name })).className).toContain('size-11');
  }
});

test('kontrol mengambang berada di atas area kamera: zoom kanan bawah, senter dan ganti kamera kiri bawah', async () => {
  setup({
    stream: fakeStream({ torch: true, caps: { zoom: { min: 1, max: 5, step: 0.1 } } }),
    devices: VIDEO_DEVICES,
  });
  const viewport = screen.getByTestId('camera-viewport');
  const zoom = await screen.findByTestId('camera-controls-zoom');
  const left = await screen.findByTestId('camera-controls-left');
  expect(viewport.contains(zoom) && viewport.contains(left)).toBe(true);
  for (const token of ['absolute', 'right-3', 'bottom-3']) expect(zoom.className).toContain(token);
  for (const token of ['absolute', 'left-3', 'bottom-3']) expect(left.className).toContain(token);
  expect(left.contains(screen.getByRole('button', { name: 'Nyalakan senter' }))).toBe(true);
  expect(left.contains(screen.getByRole('button', { name: 'Ganti kamera' }))).toBe(true);
});

test('ketukan pada kontrol mengambang tidak memicu ketuk-untuk-fokus', async () => {
  stubVideoGeometry({ w: 1280, h: 720 }, { w: 300, h: 300 });
  stubVideoRect(300, 300);
  const stream = fakeStream({
    torch: true,
    caps: { focusMode: ['continuous', 'single-shot'], zoom: { min: 1, max: 5, step: 0.1 } },
  });
  setup({ stream, devices: VIDEO_DEVICES });
  await waitFor(() => expect(screen.queryByText(/Menyiapkan kamera/)).not.toBeInTheDocument());
  const shots = () =>
    stream.track.applyConstraints.mock.calls.filter((call) => focusModeOf(call) === 'single-shot');
  // Slider dan pembungkus kontrol (bukan hanya tombol) menahan ketukan.
  fireEvent.click(await screen.findByRole('slider', { name: 'Zoom' }), {
    clientX: 10,
    clientY: 10,
  });
  fireEvent.click(screen.getByTestId('camera-controls-zoom'), { clientX: 10, clientY: 10 });
  fireEvent.click(screen.getByTestId('camera-controls-left'), { clientX: 10, clientY: 10 });
  fireEvent.click(screen.getByRole('button', { name: 'Nyalakan senter' }), {
    clientX: 10,
    clientY: 10,
  });
  expect(shots()).toHaveLength(0);
  expect(screen.queryByTestId('focus-ring')).not.toBeInTheDocument();
  // Ketukan di area video biasa tetap memfokus.
  fireEvent.click(screen.getByTestId('camera-viewport'), { clientX: 100, clientY: 100 });
  expect(shots()).toHaveLength(1);
});

test('petunjuk berada di area kamera (bukan di header yang menempel)', async () => {
  setup({ stream: fakeStream({ caps: { focusMode: ['single-shot'] } }) });
  const tip = await screen.findByText(/ketuk layar untuk fokus/);
  expect(tip.closest('[data-slot="alert-dialog-header"]')).toBeNull();
  expect(screen.getByTestId('camera-viewport').contains(tip)).toBe(true);
});
