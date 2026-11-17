import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Fragment, StrictMode } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BarcodeEngine } from '../lib/barcode-engine';
import { resetScanAudio, type ScanFeedback } from '../lib/scan-feedback';
import { CAMERA_ERROR_TEXT } from '../lib/use-camera-scanner';
import { CameraScanDialog } from './camera-scan-dialog';

vi.mock('sonner', () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }));

// Tes tabel hasil scan, Simpan/Batal, dan keadaan galat pada dialog kamera layar penuh. Perilaku kamera (zoom, senter,
// fokus, pembaca) diuji di camera-scan-dialog.test.tsx.

function fakeStream() {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => ({}),
    getSettings: () => ({ deviceId: 'cam-1' }),
    applyConstraints: vi.fn(async () => undefined),
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    get: () => 4,
    configurable: true,
  });
  vi.mocked(toast.warning).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
  Reflect.deleteProperty(HTMLMediaElement.prototype, 'readyState');
});

interface SetupOptions {
  results?: ScanFeedback[] | ((text: string) => ScanFeedback);
  isKnown?: (serial: string) => boolean;
  single?: boolean;
  draftCapacity?: () => number;
  strict?: boolean;
  onSaved?: (results: { serial: string; feedback: ScanFeedback }[]) => void;
  devices?: unknown[];
}

function setup(options: SetupOptions = {}) {
  const media = fakeStream();
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn(async () => media.stream),
      enumerateDevices: vi.fn(async () => options.devices ?? []),
    },
    configurable: true,
  });
  const state = { current: [] as string[] };
  const engine: BarcodeEngine = {
    kind: 'native',
    detect: vi.fn(async () => [...state.current]),
    detectCodes: vi.fn(async () => state.current.map((text) => ({ text, box: null }))),
  };
  let time = 5_000_000;
  const queue = Array.isArray(options.results) ? [...options.results] : undefined;
  const onScan = vi.fn((text: string): ScanFeedback => {
    if (typeof options.results === 'function') return options.results(text);
    return queue?.shift() ?? 'added';
  });
  const onOpenChange = vi.fn();
  const Wrapper = options.strict ? StrictMode : Fragment;
  const view = render(
    <Wrapper>
      <CameraScanDialog
        open
        onOpenChange={onOpenChange}
        onScan={onScan}
        isKnown={options.isKnown}
        single={options.single}
        draftCapacity={options.draftCapacity}
        onSaved={options.onSaved}
        createEngine={async () => engine}
        now={() => time}
      />
    </Wrapper>,
  );
  return {
    ...view,
    ...media,
    state,
    engine,
    onScan,
    onOpenChange,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

function serials(): string[] {
  return screen
    .queryAllByRole('textbox', { name: /^Serial nomor/ })
    .map((input) => (input as HTMLInputElement).value);
}

const NL = String.fromCharCode(10);

/** Seperti `serials` tetapi juga membaca dialog yang sedang tertutup konfirmasi (aria-hidden). */
function hiddenSerials(): string[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[aria-label^="Serial nomor"]')].map(
    (input) => input.value,
  );
}

/** Memindai satu serial: engine melihatnya sampai muncul di tabel, lalu dikosongkan (tidak terbaca lagi). */
async function scan(ctx: ReturnType<typeof setup>, text: string, expected: string[]) {
  ctx.state.current = [text];
  await waitFor(() => expect(serials()).toEqual(expected));
  ctx.state.current = [];
}

test('keadaan kosong: teks petunjuk, Simpan nonaktif, Batal langsung menutup tanpa konfirmasi', async () => {
  const ctx = setup();
  expect(screen.getByText('Belum ada hasil. Arahkan kamera ke kode.')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'No' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Serial Number' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Action' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
  expect(screen.queryByText(/Buang .* serial/)).not.toBeInTheDocument();
});

test('hasil scan masuk tabel berurutan (No, serial, hapus) dan label Simpan memuat jumlah baris', async () => {
  const ctx = setup();
  await scan(ctx, 'aaa1', ['AAA1']);
  await scan(ctx, 'bbb2\nccc3', ['AAA1', 'BBB2', 'CCC3']);
  const rows = screen.getAllByRole('row').slice(1);
  expect(rows).toHaveLength(3);
  expect(within(rows[2] as HTMLElement).getByText('3')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Hapus serial' })).toHaveLength(3);
  expect(screen.getByRole('button', { name: 'Simpan (3)' })).toBeEnabled();
  expect(ctx.onScan).not.toHaveBeenCalled();
});

test('baris terbaru disorot sebentar dan tabel menggulir ke sana', async () => {
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  const ctx = setup();
  await scan(ctx, 'aaa1', ['AAA1']);
  const row = screen.getAllByRole('row')[1] as HTMLElement;
  expect(row).toHaveAttribute('data-highlight', 'true');
  // Efek gulir berjalan setelah render: tunggu, jangan anggap sudah terpanggil.
  await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  await waitFor(() => expect(row).not.toHaveAttribute('data-highlight'), { timeout: 3000 });
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

test('serial yang sudah ada di tabel tidak ditambahkan lagi (umpan balik "Sudah ada")', async () => {
  const ctx = setup();
  await scan(ctx, 'aaa1', ['AAA1']);
  // Hilang dari pandangan melewati jendela bacaan ulang, lalu terbaca lagi.
  ctx.advance(10_000);
  ctx.state.current = ['AAA1'];
  expect(await screen.findByText('Sudah ada: AAA1')).toBeInTheDocument();
  expect(serials()).toEqual(['AAA1']);
});

test('serial yang sudah ada di draft (isKnown) tidak ditambahkan: "Sudah ada", tanpa baris', async () => {
  const ctx = setup({ isKnown: (serial) => serial === 'DRAFT1' });
  ctx.state.current = ['draft1'];
  expect(await screen.findByText('Sudah ada: DRAFT1')).toBeInTheDocument();
  expect(serials()).toEqual([]);
});

test('hapus baris lewat tombol Hapus serial', async () => {
  const ctx = setup();
  await scan(ctx, 'aaa1\nbbb2', ['AAA1', 'BBB2']);
  await userEvent.click(screen.getAllByRole('button', { name: 'Hapus serial' })[0] as HTMLElement);
  expect(serials()).toEqual(['BBB2']);
  expect(screen.getByRole('button', { name: 'Simpan (1)' })).toBeInTheDocument();
});

test('edit nilai baris; bentuk kanonis (huruf besar) ditetapkan saat selesai mengetik', async () => {
  const ctx = setup();
  await scan(ctx, 'aaa1', ['AAA1']);
  const input = screen.getByRole('textbox', { name: 'Serial nomor 1' });
  await userEvent.clear(input);
  await userEvent.type(input, 'xyz9');
  expect(input).toHaveValue('xyz9');
  await userEvent.tab();
  expect(input).toHaveValue('XYZ9');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan (1)' }));
  expect(ctx.onScan).toHaveBeenCalledWith('XYZ9');
});

test('baris kosong, tidak valid, atau duplikat ditandai dengan pesan dan Simpan nonaktif sampai diperbaiki', async () => {
  const ctx = setup();
  await scan(ctx, 'aaa1\nbbb2', ['AAA1', 'BBB2']);
  const [first, second] = screen.getAllByRole('textbox', {
    name: /^Serial nomor/,
  }) as HTMLInputElement[];
  if (!first || !second) throw new Error('baris tidak ditemukan');
  const save = () => screen.getByRole('button', { name: /^Simpan/ });

  await userEvent.clear(second);
  expect(second).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('Isi serial dulu');
  expect(save()).toBeDisabled();

  // Menjadi duplikat baris lain.
  await userEvent.type(second, 'aaa1');
  expect(second).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('Sama dengan baris lain');
  expect(first).not.toHaveAttribute('aria-invalid', 'true');
  expect(save()).toBeDisabled();

  // Terlalu panjang.
  await userEvent.clear(second);
  await userEvent.type(second, 'x'.repeat(65));
  expect(screen.getByRole('alert')).toHaveTextContent('Terlalu panjang');
  expect(save()).toBeDisabled();

  // Diperbaiki.
  await userEvent.clear(second);
  await userEvent.type(second, 'bbb2');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(save()).toBeEnabled();
  expect(ctx.onScan).not.toHaveBeenCalled();
});

test('baris yang diedit menjadi sama dengan serial di draft ditandai dan memblokir Simpan; menghapusnya memperbaiki', async () => {
  const ctx = setup({ isKnown: (serial) => serial === 'DRAFT1' });
  await scan(ctx, 'aaa1', ['AAA1']);
  const input = screen.getByRole('textbox', { name: 'Serial nomor 1' });
  await userEvent.clear(input);
  await userEvent.type(input, 'draft1');
  expect(screen.getByRole('alert')).toHaveTextContent('Sudah ada di draft');
  expect(screen.getByRole('button', { name: 'Simpan (1)' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus serial' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled();
});

test('Simpan memanggil onScan berurutan per baris (urutan tabel), lalu menutup dialog tanpa toast bila semua ditambahkan', async () => {
  const ctx = setup();
  await scan(ctx, 'aaa1\nbbb2\nccc3', ['AAA1', 'BBB2', 'CCC3']);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan (3)' }));
  expect(ctx.onScan.mock.calls.map((call) => call[0])).toEqual(['AAA1', 'BBB2', 'CCC3']);
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
  expect(toast.warning).not.toHaveBeenCalled();
});

test('Simpan dengan hasil campuran: toast ringkasan "n ditambahkan, m dilewati"', async () => {
  const ctx = setup({ results: ['added', 'duplicate', 'rejected'] });
  await scan(ctx, 'aaa1\nbbb2\nccc3', ['AAA1', 'BBB2', 'CCC3']);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan (3)' }));
  expect(toast.warning).toHaveBeenCalledWith('1 ditambahkan, 2 dilewati');
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
});

test('Batal dengan hasil: konfirmasi bertumpuk; "Lanjut scan" mempertahankan tabel, "Buang" menutup tanpa onScan', async () => {
  const ctx = setup();
  await scan(ctx, 'aaa1\nbbb2', ['AAA1', 'BBB2']);
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  const confirm = await screen.findByRole('alertdialog', { name: 'Buang 2 serial hasil scan?' });
  expect(ctx.onOpenChange).not.toHaveBeenCalled();

  await userEvent.click(within(confirm).getByRole('button', { name: 'Lanjut scan' }));
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog', { name: /Buang/ })).not.toBeInTheDocument(),
  );
  expect(serials()).toEqual(['AAA1', 'BBB2']);
  expect(ctx.onOpenChange).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  await userEvent.click(
    within(await screen.findByRole('alertdialog', { name: /Buang/ })).getByRole('button', {
      name: 'Buang',
    }),
  );
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
  expect(ctx.onScan).not.toHaveBeenCalled();
});

test('Escape = Batal: dengan hasil menampilkan konfirmasi, tanpa hasil langsung menutup', async () => {
  const empty = setup();
  await userEvent.keyboard('{Escape}');
  expect(empty.onOpenChange).toHaveBeenCalledWith(false);
  empty.unmount();

  const ctx = setup();
  await scan(ctx, 'aaa1', ['AAA1']);
  await userEvent.keyboard('{Escape}');
  expect(await screen.findByRole('alertdialog', { name: /Buang 1 serial/ })).toBeInTheDocument();
  expect(ctx.onOpenChange).not.toHaveBeenCalled();
});

test('kamera mati setelah dialog ditutup lewat Simpan', async () => {
  const ctx = setup();
  await scan(ctx, 'aaa1', ['AAA1']);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan (1)' }));
  // Pemakai menutup dialog (open=false): isi dilepas dan aliran dimatikan.
  ctx.rerender(
    <CameraScanDialog open={false} onOpenChange={ctx.onOpenChange} onScan={ctx.onScan} />,
  );
  await waitFor(() => expect(ctx.track.stop).toHaveBeenCalled());
});

test('galat kamera: pesan dan Coba lagi di area kamera, kontrol mengambang hilang, tabel dan footer tetap ada', async () => {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn(async () => {
        throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
      }),
    },
    configurable: true,
  });
  const onOpenChange = vi.fn();
  render(<CameraScanDialog open onOpenChange={onOpenChange} onScan={() => 'added'} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(CAMERA_ERROR_TEXT.denied);
  const viewport = screen.getByTestId('camera-viewport');
  expect(viewport.contains(screen.getByRole('button', { name: 'Coba lagi' }))).toBe(true);
  expect(screen.queryByTestId('camera-controls-zoom')).not.toBeInTheDocument();
  expect(screen.queryByTestId('camera-controls-left')).not.toBeInTheDocument();
  expect(screen.getByText('Belum ada hasil. Arahkan kamera ke kode.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('onSaved menerima hasil SEMUA baris (urutan tabel) dan menggantikan toast ringkasan', async () => {
  const onSaved = vi.fn();
  const ctx = setup({ results: ['added', 'duplicate', 'rejected'], onSaved });
  await scan(ctx, 'aaa1\nbbb2\nccc3', ['AAA1', 'BBB2', 'CCC3']);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan (3)' }));
  expect(onSaved).toHaveBeenCalledWith([
    { serial: 'AAA1', feedback: 'added' },
    { serial: 'BBB2', feedback: 'duplicate' },
    { serial: 'CCC3', feedback: 'rejected' },
  ]);
  expect(toast.warning).not.toHaveBeenCalled();
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
});

const TWO_CAMERAS = [
  { kind: 'videoinput', deviceId: 'cam-1', label: 'camera2 0, facing back' },
  { kind: 'videoinput', deviceId: 'cam-2', label: 'camera2 1, facing front' },
];

test('berganti kamera menampilkan nama kamera aktif sementara, lalu hilang sendiri', async () => {
  setup({ devices: TWO_CAMERAS });
  const toggle = await screen.findByRole('button', { name: 'Ganti kamera' });
  expect(screen.queryByTestId('camera-name')).not.toBeInTheDocument();
  await userEvent.click(toggle);
  const label = await screen.findByTestId('camera-name');
  expect(label).toHaveTextContent('Kamera depan');
  expect(label).toHaveAttribute('aria-live', 'polite');
  await waitFor(() => expect(screen.queryByTestId('camera-name')).not.toBeInTheDocument(), {
    timeout: 5000,
  });
});

test('sisa kapasitas draft: baris yang melebihinya ditolak di tabel dengan teks batas draft, Simpan tidak menjatuhkan baris', async () => {
  const onSaved = vi.fn();
  const ctx = setup({ draftCapacity: () => 2, onSaved });
  ctx.state.current = [`aaa1${String.fromCharCode(10)}bbb2${String.fromCharCode(10)}ccc3`];
  await waitFor(() => expect(serials()).toEqual(['AAA1', 'BBB2']));
  expect(await screen.findByText(/Ditolak: batas 1000 baris draft tercapai/)).toBeInTheDocument();
  ctx.state.current = [];
  await userEvent.click(screen.getByRole('button', { name: 'Simpan (2)' }));
  expect(onSaved).toHaveBeenCalledWith([
    { serial: 'AAA1', feedback: 'added' },
    { serial: 'BBB2', feedback: 'added' },
  ]);
});

test('baris tak sah dalam satu payload: umpan balik Ditolak, serial sah tetap masuk', async () => {
  const ctx = setup();
  ctx.state.current = [`aaa1${String.fromCharCode(10)}${'x'.repeat(100)}`];
  await waitFor(() => expect(serials()).toEqual(['AAA1']));
  expect(await screen.findByText(/^Ditolak:/)).toBeInTheDocument();
});

test('selama konfirmasi Buang tampil, bacaan baru diabaikan; setelah Lanjut scan pemindaian normal lagi', async () => {
  const ctx = setup();
  await scan(ctx, 'aaa1', ['AAA1']);
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  const confirm = await screen.findByRole('alertdialog', { name: 'Buang 1 serial hasil scan?' });
  // Kode baru terlihat kamera selagi konfirmasi terbuka: tidak masuk tabel, judul tetap.
  ctx.state.current = ['bbb2'];
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(hiddenSerials()).toEqual(['AAA1']);
  expect(confirm).toHaveAccessibleName('Buang 1 serial hasil scan?');
  await userEvent.click(within(confirm).getByRole('button', { name: 'Lanjut scan' }));
  // Bacaan yang jatuh selama konfirmasi dibuang (bukan ditunda): setelah kode dihadirkan lagi, ia terbaca.
  ctx.state.current = [];
  ctx.advance(10_000);
  await new Promise((resolve) => setTimeout(resolve, 300));
  ctx.state.current = ['bbb2'];
  await waitFor(() => expect(serials()).toEqual(['AAA1', 'BBB2']));
});

test('klik dan sentuhan di dialog menyiapkan audio (bukan hanya pointerdown)', async () => {
  const resume = vi.fn(async () => undefined);
  class FakeAudio {
    state = 'suspended';
    resume = resume;
    close = vi.fn(async () => undefined);
  }
  vi.stubGlobal('AudioContext', FakeAudio);
  setup();
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(dialog);
  const afterClick = resume.mock.calls.length;
  expect(afterClick).toBeGreaterThan(0);
  fireEvent.touchEnd(dialog);
  expect(resume.mock.calls.length).toBeGreaterThan(afterClick);
  vi.unstubAllGlobals();
  resetScanAudio();
});

test('footer tanpa sudut membulat pada dialog layar penuh', async () => {
  setup();
  const footer = (await screen.findByRole('alertdialog')).querySelector(
    '[data-slot="alert-dialog-footer"]',
  );
  expect(footer?.className).toContain('rounded-none');
});

test('StrictMode: Escape dengan hasil tetap menampilkan konfirmasi (tindakan dialog dipasang lewat efek)', async () => {
  const ctx = setup({ strict: true });
  await scan(ctx, 'aaa1', ['AAA1']);
  await userEvent.keyboard('{Escape}');
  expect(await screen.findByRole('alertdialog', { name: /Buang 1 serial/ })).toBeInTheDocument();
  expect(ctx.onOpenChange).not.toHaveBeenCalled();
});

test('tata letak: 2 kolom (kamera kiri, tabel kanan) pada md ATAU landscape; 1 kolom pada portrait sempit', async () => {
  setup();
  const viewport = screen.getByTestId('camera-viewport');
  const layout = screen.getByTestId('scan-layout');
  const tableColumn = screen.getByTestId('scan-results').parentElement;
  expect(layout.className).toContain('flex-col');
  for (const variant of ['md', 'landscape']) {
    expect(layout.className).toContain(`${variant}:flex-row`);
    expect(viewport.className).toContain(`${variant}:h-auto`);
    expect(viewport.parentElement?.className).toContain(`${variant}:w-1/2`);
    expect(tableColumn?.className).toContain(`${variant}:w-1/2`);
  }
});

test('Lapor Rusak (single): tanpa tabel dan tanpa Simpan, hanya kamera layar penuh dengan tombol Tutup', async () => {
  const ctx = setup({ single: true });
  expect(screen.queryByTestId('scan-results')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Simpan/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Batal' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tutup' })).toBeInTheDocument();
  expect(screen.getByTestId('camera-viewport')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Tutup' }));
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
  expect(ctx.onScan).not.toHaveBeenCalled();
});

test('Lapor Rusak (single): bacaan sah pertama langsung diteruskan ke onScan lalu dialog menutup', async () => {
  const ctx = setup({ single: true });
  ctx.state.current = ['aaa1'];
  await waitFor(() => expect(ctx.onScan).toHaveBeenCalledWith('AAA1'));
  await waitFor(() => expect(ctx.onOpenChange).toHaveBeenCalledWith(false));
  expect(ctx.onScan).toHaveBeenCalledTimes(1);
});

test('Lapor Rusak (single): serial yang sama dengan pencarian aktif (duplicate) tetap menutup dialog', async () => {
  const ctx = setup({ single: true, results: ['duplicate'] });
  ctx.state.current = ['aaa1'];
  await waitFor(() => expect(ctx.onOpenChange).toHaveBeenCalledWith(false));
});

test('Lapor Rusak (single): payload lebih dari satu serial ditolak utuh dengan catatan, kamera tetap hidup', async () => {
  const ctx = setup({ single: true });
  ctx.state.current = [`aaa1${NL}bbb2`];
  expect(await screen.findByText(/Ditolak: satu serial saja per laporan/)).toBeInTheDocument();
  expect(ctx.onScan).not.toHaveBeenCalled();
  expect(ctx.onOpenChange).not.toHaveBeenCalled();
  expect(ctx.track.stop).not.toHaveBeenCalled();
});

test('Lapor Rusak (single): serial tak sah ditolak tanpa catatan "satu serial"; hasil rejected dari pemakai tidak menutup', async () => {
  const bad = setup({ single: true });
  bad.state.current = ['x'.repeat(100)];
  expect(await screen.findByText(/^Ditolak:/)).toBeInTheDocument();
  expect(screen.queryByText(/satu serial saja/)).not.toBeInTheDocument();
  expect(bad.onScan).not.toHaveBeenCalled();
  bad.unmount();

  const refused = setup({ single: true, results: ['rejected'] });
  refused.state.current = ['aaa1'];
  await waitFor(() => expect(refused.onScan).toHaveBeenCalledWith('AAA1'));
  expect(await screen.findByText(/^Ditolak:/)).toBeInTheDocument();
  expect(refused.onOpenChange).not.toHaveBeenCalled();
});

test('Lapor Rusak (single): Escape menutup langsung tanpa konfirmasi', async () => {
  const ctx = setup({ single: true });
  await userEvent.keyboard('{Escape}');
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
});
