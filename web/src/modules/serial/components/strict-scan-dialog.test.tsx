import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BarcodeEngine } from '../lib/barcode-engine';
import type { LocatedCode } from '../lib/scan-region';
import { type StrictInfo, StrictScanDialog, type StrictScanResult } from './strict-scan-dialog';

const apiMock = vi.hoisted(() => vi.fn());
const prepareImageMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('@/modules/files/image', () => ({ prepareImage: prepareImageMock }));

const INFO: StrictInfo = {
  itemLabel: 'Cisco C9200',
  buLabel: 'BU1',
  locationLabel: 'Jakarta (JKT)',
  testDate: '2026-11-18',
  proofMin: 2,
  stamp: {
    itemLabel: 'Cisco C9200',
    buLabel: 'BU1',
    locationLabel: 'Jakarta (JKT)',
    actorName: 'Budi',
    actorTeam: 'QC',
  },
};

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

function fakeEngine() {
  const state = { current: [] as string[] };
  const engine: BarcodeEngine = {
    kind: 'native',
    detect: vi.fn(async () => [...state.current]),
    detectCodes: vi.fn(
      async (): Promise<LocatedCode[]> => state.current.map((text) => ({ text, box: null })),
    ),
  };
  return { engine, state };
}

let uploadCounter = 0;
const removed = () =>
  apiMock.mock.calls
    .filter((call) => call[0] === 'serialProofs.remove')
    .map((call) => (call[1] as { id: string }).id)
    .sort();

beforeEach(() => {
  uploadCounter = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    get: () => 4,
    configurable: true,
  });
  prepareImageMock.mockReset();
  prepareImageMock.mockResolvedValue({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 10,
    height: 10,
  });
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'serialProofs.upload') {
      uploadCounter += 1;
      return {
        id: `p${uploadCounter}`,
        state: 'draft',
        mime: 'image/webp',
        size: 100,
        width: 10,
        height: 10,
        filename: `bukti-p${uploadCounter}.webp`,
        error: null,
      };
    }
    return { id: 'x' };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
  Reflect.deleteProperty(HTMLMediaElement.prototype, 'readyState');
});

function setup(
  options: {
    initialSerial?: string;
    isKnown?: (serial: string) => boolean;
    info?: StrictInfo;
  } = {},
) {
  const media = fakeStream();
  const getUserMedia = vi.fn(async () => media.stream);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia, enumerateDevices: vi.fn(async () => []) },
    configurable: true,
  });
  const { engine, state } = fakeEngine();
  let time = 5_000_000;
  const onConfirm = vi.fn((_result: StrictScanResult) => undefined);
  const onOpenChange = vi.fn();
  const view = render(
    <StrictScanDialog
      open
      onOpenChange={onOpenChange}
      initialSerial={options.initialSerial}
      info={options.info ?? INFO}
      isKnown={options.isKnown ?? (() => false)}
      onConfirm={onConfirm}
      createEngine={async () => engine}
      now={() => time}
    />,
  );
  return {
    ...view,
    ...media,
    state,
    engine,
    onConfirm,
    onOpenChange,
    getUserMedia,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

let fileCounter = 0;
function pickFiles(count: number) {
  const files = Array.from({ length: count }, () => {
    fileCounter += 1;
    return new File([new Uint8Array(4)], `foto-${fileCounter}.jpg`, { type: 'image/jpeg' });
  });
  const input = document.body.querySelector('input[type="file"]:not([capture])');
  fireEvent.change(input as HTMLInputElement, { target: { files } });
}

/** Menambah `count` foto lewat tombol Tambah foto, dialog Foto bukti, dan Telusuri. */
async function addPhotos(count: number) {
  await userEvent.click(screen.getByRole('button', { name: 'Tambah foto' }));
  await screen.findByRole('dialog', { name: 'Foto bukti' });
  pickFiles(count);
  await userEvent.click(await screen.findByRole('button', { name: `Tambahkan (${count})` }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Foto bukti' })).toBeNull());
}

const serialField = () => screen.getByRole('textbox', { name: 'Serial Number' });
const save = () => screen.getByRole('button', { name: 'Simpan' });

test('langkah 1: bacaan sah pertama membawa ke langkah 2 dengan serial terisi; tanpa tabel hasil', async () => {
  const ctx = setup();
  expect(await screen.findByRole('alertdialog')).toHaveAttribute('data-size', 'full');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Pratinjau kamera')).toBeInTheDocument();
  ctx.state.current = ['ABC123'];
  await waitFor(() => expect(serialField()).toHaveValue('ABC123'));
  expect(screen.getByRole('region', { name: 'Informasi item' })).toHaveTextContent('Cisco C9200');
});

test('langkah 1: serial yang sudah ada di draft memberi "Sudah ada" dan tetap di langkah 1', async () => {
  const ctx = setup({ isKnown: (serial) => serial === 'ABC123' });
  await screen.findByLabelText('Pratinjau kamera');
  ctx.state.current = ['ABC123'];
  await waitFor(() =>
    expect(screen.getByText(/Sudah ada: sudah ada di draft/)).toBeInTheDocument(),
  );
  expect(screen.queryByRole('textbox', { name: 'Serial Number' })).not.toBeInTheDocument();
});

test('langkah 1: kode berisi banyak serial ditolak utuh dan kamera tetap hidup', async () => {
  const ctx = setup();
  await screen.findByLabelText('Pratinjau kamera');
  ctx.state.current = [`A1${String.fromCharCode(10)}B2`];
  await waitFor(() => expect(screen.getByText(/satu serial per kali/)).toBeInTheDocument());
  expect(screen.queryByRole('textbox', { name: 'Serial Number' })).not.toBeInTheDocument();
});

test('langkah 2 langsung (initialSerial): kamera tidak dinyalakan; kartu info, serial, dan syarat foto tampil', async () => {
  const ctx = setup({ initialSerial: 'ABC123' });
  expect(await screen.findByRole('textbox', { name: 'Serial Number' })).toHaveValue('ABC123');
  expect(ctx.getUserMedia).not.toHaveBeenCalled();
  const card = screen.getByRole('region', { name: 'Informasi item' });
  expect(card).toHaveTextContent('Cisco C9200');
  expect(card).toHaveTextContent('BU1');
  expect(card).toHaveTextContent('Jakarta (JKT)');
  expect(card).toHaveTextContent('2026-11-18');
  expect(card).toHaveTextContent('Wajib foto minimal 2');
  expect(save()).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Butuh 2 foto lagi');
  expect(screen.getByText('0 dari minimal 2 (maks. 5)')).toBeInTheDocument();
});

test('kamera dilepas begitu pindah ke langkah 2', async () => {
  const ctx = setup();
  await screen.findByLabelText('Pratinjau kamera');
  expect(ctx.track.stop).not.toHaveBeenCalled();
  ctx.state.current = ['ABC123'];
  await screen.findByRole('textbox', { name: 'Serial Number' });
  expect(ctx.track.stop).toHaveBeenCalled();
});

test('Simpan aktif hanya setelah foto mencapai minimum, lalu memanggil onConfirm dan menutup', async () => {
  const ctx = setup({ initialSerial: 'abc123' });
  await screen.findByRole('textbox', { name: 'Serial Number' });
  await addPhotos(1);
  expect(screen.getByText('1 dari minimal 2 (maks. 5)')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Butuh 1 foto lagi');
  expect(save()).toBeDisabled();
  await addPhotos(1);
  expect(screen.getByRole('status')).toHaveTextContent('Siap disimpan');
  expect(save()).toBeEnabled();
  await userEvent.click(save());
  expect(ctx.onConfirm).toHaveBeenCalledTimes(1);
  const result = ctx.onConfirm.mock.calls[0]?.[0] as StrictScanResult;
  expect(result.serial).toBe('ABC123');
  expect(result.photos.map((photo) => photo.id)).toEqual(['p1', 'p2']);
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
  // Foto yang dikonfirmasi tidak dibuang saat dialog ditutup.
  ctx.unmount();
  expect(removed()).toEqual([]);
});

test('serial diedit menjadi tak sah atau duplikat memblokir Simpan; foto tetap terpasang', async () => {
  const ctx = setup({ initialSerial: 'ABC123', isKnown: (serial) => serial === 'DUP999' });
  await screen.findByRole('textbox', { name: 'Serial Number' });
  await addPhotos(2);
  expect(save()).toBeEnabled();

  fireEvent.change(serialField(), { target: { value: 'DUP999' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Sudah ada di draft.');
  expect(save()).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Sudah ada di draft.');

  fireEvent.change(serialField(), { target: { value: 'AB\u0007C' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Ada karakter yang tidak boleh dipakai.');
  expect(save()).toBeDisabled();

  fireEvent.change(serialField(), { target: { value: '   ' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Isi serial dulu.');
  expect(save()).toBeDisabled();

  fireEvent.change(serialField(), { target: { value: 'xyz789' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('2 dari minimal 2 (maks. 5)')).toBeInTheDocument();
  expect(save()).toBeEnabled();
  await userEvent.click(save());
  const result = ctx.onConfirm.mock.calls[0]?.[0] as StrictScanResult;
  expect(result.serial).toBe('XYZ789');
  expect(result.photos).toHaveLength(2);
});

test('Tambah foto nonaktif di batas 5 foto', async () => {
  setup({ initialSerial: 'ABC123', info: { ...INFO, proofMin: 1 } });
  await screen.findByRole('textbox', { name: 'Serial Number' });
  await addPhotos(3);
  await addPhotos(2);
  expect(screen.getByText('5 dari minimal 1 (maks. 5)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tambah foto' })).toBeDisabled();
});

test('buang foto di langkah 2 membuangnya di server dan menurunkan hitungan', async () => {
  setup({ initialSerial: 'ABC123' });
  await screen.findByRole('textbox', { name: 'Serial Number' });
  await addPhotos(2);
  await userEvent.click(screen.getByRole('button', { name: 'Buang foto 1, serial ini' }));
  expect(removed()).toEqual(['p1']);
  expect(screen.getByText('1 dari minimal 2 (maks. 5)')).toBeInTheDocument();
  expect(save()).toBeDisabled();
});

test('Scan ulang tanpa foto langsung kembali ke langkah 1 dengan kamera menyala lagi', async () => {
  const ctx = setup({ initialSerial: 'ABC123' });
  await screen.findByRole('textbox', { name: 'Serial Number' });
  await userEvent.click(screen.getByRole('button', { name: 'Scan ulang' }));
  expect(await screen.findByLabelText('Pratinjau kamera')).toBeInTheDocument();
  await waitFor(() => expect(ctx.getUserMedia).toHaveBeenCalledTimes(1));
});

test('Scan ulang dengan foto meminta konfirmasi, lalu membuang foto dan kembali ke langkah 1', async () => {
  const ctx = setup({ initialSerial: 'ABC123' });
  await screen.findByRole('textbox', { name: 'Serial Number' });
  await addPhotos(2);
  await userEvent.click(screen.getByRole('button', { name: 'Scan ulang' }));
  await screen.findByText('Scan ulang dan buang foto?');
  // Kembali: tidak ada yang dibuang.
  await userEvent.click(screen.getByRole('button', { name: 'Kembali' }));
  expect(removed()).toEqual([]);
  expect(screen.getByRole('textbox', { name: 'Serial Number' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Scan ulang' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Scan ulang dan buang foto?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Scan ulang' }));
  await waitFor(() => expect(removed()).toEqual(['p1', 'p2']));
  expect(await screen.findByLabelText('Pratinjau kamera')).toBeInTheDocument();
  expect(ctx.onConfirm).not.toHaveBeenCalled();
});

test('Batal dengan foto meminta konfirmasi; Buang membuang foto dan menutup tanpa onConfirm', async () => {
  const ctx = setup({ initialSerial: 'ABC123' });
  await screen.findByRole('textbox', { name: 'Serial Number' });
  await addPhotos(2);
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(ctx.onOpenChange).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('alertdialog', { name: 'Buang 2 foto?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Buang' }));
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
  ctx.unmount();
  expect(removed()).toEqual(['p1', 'p2']);
  expect(ctx.onConfirm).not.toHaveBeenCalled();
});

test('Esc dengan foto meminta konfirmasi (tidak langsung menutup)', async () => {
  const ctx = setup({ initialSerial: 'ABC123' });
  await screen.findByRole('textbox', { name: 'Serial Number' });
  await addPhotos(1);
  await userEvent.keyboard('{Escape}');
  expect(await screen.findByRole('alertdialog', { name: 'Buang 1 foto?' })).toBeInTheDocument();
  expect(ctx.onOpenChange).not.toHaveBeenCalled();
});

test('Batal tanpa foto menutup langsung; Batal di langkah 1 juga', async () => {
  const first = setup({ initialSerial: 'ABC123' });
  await screen.findByRole('textbox', { name: 'Serial Number' });
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(first.onOpenChange).toHaveBeenCalledWith(false);
  first.unmount();

  const second = setup();
  await screen.findByLabelText('Pratinjau kamera');
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(second.onOpenChange).toHaveBeenCalledWith(false);
});

test('pratinjau cap di kamera foto memakai serial yang sedang diedit', async () => {
  setup({ initialSerial: 'ABC123' });
  await screen.findByRole('textbox', { name: 'Serial Number' });
  fireEvent.change(serialField(), { target: { value: 'edit-77' } });
  await userEvent.click(screen.getByRole('button', { name: 'Tambah foto' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Kamera' }));
  const note = await screen.findByRole('note', { name: 'Pratinjau cap' });
  expect(note).toHaveTextContent('SN: EDIT-77');
  expect(note).toHaveTextContent('Disimpan saat Simpan · Budi (QC)');
});
