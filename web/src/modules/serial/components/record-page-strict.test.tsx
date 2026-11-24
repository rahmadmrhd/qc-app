import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { expectLinkValue, pickLink } from '@/test/link-field';
import { loadDraft } from '../lib/draft-store';

const apiMock = vi.hoisted(() => vi.fn());
const prepareImageMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@/modules/files/image', () => ({ prepareImage: prepareImageMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage } from './record-page';

const ITEMS = [
  {
    id: 'i1',
    label: 'Cisco C9200',
    buIds: ['b1'],
    buOptions: [{ id: 'b1', code: 'BU1' }],
    proofRequired: false,
    proofMin: 1,
  },
  {
    id: 'i3',
    label: 'Aruba Wajib Foto',
    buIds: ['b1'],
    buOptions: [{ id: 'b1', code: 'BU1' }],
    proofRequired: true,
    proofMin: 2,
  },
];

let uploads = 0;
/** Saat menyala, unggahan ditahan sampai `held[i]()` dipanggil. */
let defer = false;
let held: Array<() => void> = [];
let saved: { rows: { serial: string; proofPhotoIds?: string[] }[] }[] = [];

beforeEach(() => {
  localStorage.clear();
  uploads = 0;
  defer = false;
  held = [];
  saved = [];
  prepareImageMock.mockReset();
  prepareImageMock.mockResolvedValue({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 10,
    height: 10,
  });
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.locationOptions') {
      return Promise.resolve({ locations: [{ id: 'l1', code: 'JKT', name: 'Jakarta' }] });
    }
    if (id === 'serials.itemOptions') {
      const ids = input.itemIds as string[] | undefined;
      return Promise.resolve({
        items: ids ? ITEMS.filter((item) => ids.includes(item.id)) : ITEMS,
        nextCursor: null,
      });
    }
    if (id === 'serials.stickerOptions') return Promise.resolve({ stickers: [] });
    if (id === 'serialProofs.upload') {
      uploads += 1;
      const dto = {
        id: `p${uploads}`,
        state: 'draft',
        mime: 'image/webp',
        size: 100,
        width: 10,
        height: 10,
        filename: `bukti-p${uploads}.webp`,
        error: null,
      };
      if (!defer) return Promise.resolve(dto);
      return new Promise((resolve) => held.push(() => resolve(dto)));
    }
    if (id === 'serialProofs.remove') return Promise.resolve({ id: String(input.id) });
    if (id === 'serials.saveBatch') {
      const rows = input.rows as { clientId: string; serial: string }[];
      saved.push({ rows });
      return Promise.resolve({
        results: rows.map((row) => ({ clientId: row.clientId, result: 'created', message: '' })),
      });
    }
    if (id === 'serials.lookupMany') return Promise.resolve({ found: [] });
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
  me = {
    email: 'a@gmail.com',
    name: 'Budi',
    isSuperAdmin: false,
    sharedAccount: false,
    canManageSerialSettings: false,
    permissions: {
      access: 'none',
      item: 'none',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
      serial: 'edit',
      serialservice: 'none',
      countrylock: 'none',
      dashboard: 'none',
    },
    businessUnits: [],
    locations: [],
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  apiMock.mockReset();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

async function pickStrictDefaults() {
  await pickLink(screen, 'Item', 'Aruba Wajib Foto');
  await expectLinkValue(screen, 'Lokasi', 'Jakarta (JKT)'); // satu lokasi: terkunci dan terisi otomatis
  await waitFor(() => expect(scanField()).toBeEnabled());
}

const scanField = () => screen.getByLabelText('Scan atau tempel serial (satu per baris)');

async function typeSerial(text: string) {
  await userEvent.click(scanField());
  await userEvent.paste(text);
  if (!text.includes(String.fromCharCode(10))) await userEvent.keyboard('{Enter}');
}

let fileCounter = 0;
function pickFiles(count: number) {
  const files = Array.from({ length: count }, () => {
    fileCounter += 1;
    return new File([new Uint8Array(4)], `foto-${fileCounter}.jpg`, { type: 'image/jpeg' });
  });
  const dialog = screen.getByRole('alertdialog', { name: 'Foto bukti' });
  const input = dialog.querySelector('input[type="file"]:not([capture])');
  fireEvent.change(input as HTMLInputElement, { target: { files } });
}

async function addPhotos(count: number) {
  await userEvent.click(screen.getByRole('button', { name: 'Tambah foto' }));
  await screen.findByRole('alertdialog', { name: 'Foto bukti' });
  pickFiles(count);
  await userEvent.click(await screen.findByRole('button', { name: `Tambahkan (${count})` }));
  await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Foto bukti' })).toBeNull());
}

test('item wajib foto: tempel satu serial membuka dialog di langkah 2; Simpan menambah baris dengan foto dan proofMin', async () => {
  renderPage();
  await pickStrictDefaults();
  await typeSerial('s1');
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('Wajib foto minimal 2');
  expect(screen.getByRole('textbox', { name: 'Serial Number' })).toHaveValue('S1');
  // Baris belum ada sebelum Simpan di dialog.
  expect(screen.queryByRole('textbox', { name: 'Serial S1' })).not.toBeInTheDocument();
  await addPhotos(2);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(await screen.findByRole('textbox', { name: 'Serial S1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Foto (2), S1' })).toBeInTheDocument();
  expect(screen.queryByText(/Butuh/)).not.toBeInTheDocument();
  await waitFor(() => expect(loadDraft('a@gmail.com')[0]?.proofMin).toBe(2));
  expect(loadDraft('a@gmail.com')[0]?.proofPhotos.map((photo) => photo.id)).toEqual(['p1', 'p2']);
  // Simpan semua: foto ikut terkirim.
  await userEvent.click(screen.getByRole('button', { name: /^Simpan 1 serial/ }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]?.rows[0]).toMatchObject({ serial: 'S1', proofPhotoIds: ['p1', 'p2'] });
});

test('item wajib foto: tempelan banyak serial ditolak dengan catatan dan tidak membuka dialog', async () => {
  renderPage();
  await pickStrictDefaults();
  await typeSerial(`A1${String.fromCharCode(10)}B2`);
  expect(await screen.findByText(/satu serial per kali/)).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: /^Serial A1/ })).not.toBeInTheDocument();
});

test('item wajib foto: serial yang sudah ada di draft memberi "Ditolak/Sudah ada" tanpa dialog', async () => {
  renderPage();
  await pickStrictDefaults();
  await typeSerial('s1');
  await screen.findByRole('alertdialog');
  await addPhotos(2);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await screen.findByRole('textbox', { name: 'Serial S1' });
  await typeSerial('s1');
  expect(await screen.findByText('Sudah ada')).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});

test('Batal di dialog tidak menambah baris dan membuang foto yang sudah naik', async () => {
  renderPage();
  await pickStrictDefaults();
  await typeSerial('s1');
  await screen.findByRole('alertdialog');
  await addPhotos(1);
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Buang' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(screen.queryByRole('textbox', { name: 'Serial S1' })).not.toBeInTheDocument();
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('serialProofs.remove', { id: 'p1' }));
});

test('tombol kamera pada item wajib foto membuka dialog dua langkah (bukan dialog scan batch)', async () => {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => ({}),
    getSettings: () => ({}),
    applyConstraints: vi.fn(),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(async () => stream), enumerateDevices: vi.fn(async () => []) },
    configurable: true,
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  renderPage();
  await pickStrictDefaults();
  await userEvent.click(screen.getByRole('button', { name: 'Scan dengan kamera' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('Scan serial item wajib foto');
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /^Simpan/ })).not.toBeInTheDocument();
});

test('item biasa tidak berubah: tempel langsung menambah baris tanpa dialog', async () => {
  renderPage();
  await pickLink(screen, 'Item', 'Cisco C9200');
  await expectLinkValue(screen, 'Lokasi', 'Jakarta (JKT)'); // satu lokasi: terkunci dan terisi otomatis
  await waitFor(() => expect(scanField()).toBeEnabled());
  await typeSerial('n1');
  expect(await screen.findByRole('textbox', { name: 'Serial N1' })).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(loadDraft('a@gmail.com')[0]?.proofMin).toBeUndefined();
});

test('Simpan di dialog saat 1 foto masih diunggah: baris masuk dengan foto selesai, unggahan lanjut ke baris itu dan menahan Simpan halaman', async () => {
  renderPage();
  await pickStrictDefaults();
  await typeSerial('s1');
  await screen.findByRole('alertdialog');
  await addPhotos(1);
  defer = true;
  await addPhotos(1);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(await screen.findByRole('textbox', { name: 'Serial S1' })).toBeInTheDocument();
  // Satu foto selesai menempel; satu lagi masih berjalan di bawah baris yang sama.
  expect(screen.getByRole('button', { name: 'Foto (2), S1' })).toBeInTheDocument();
  expect(screen.getByTestId('attachment-pending')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Simpan 1 serial/ })).toBeDisabled();
  await waitFor(() => expect(held).toHaveLength(1));
  held[0]?.();
  await waitFor(() => expect(screen.queryByTestId('attachment-pending')).not.toBeInTheDocument());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Simpan 1 serial/ })).toBeEnabled(),
  );
  await waitFor(() =>
    expect(loadDraft('a@gmail.com')[0]?.proofPhotos.map((photo) => photo.id)).toEqual(['p1', 'p2']),
  );
});
