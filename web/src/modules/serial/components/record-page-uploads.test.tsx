import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mockMatchMedia } from '@/test/match-media';
import { addSerials, type StagingRow } from '../lib/draft';
import { loadDraft, saveDraft } from '../lib/draft-store';

const apiMock = vi.hoisted(() => vi.fn());
const prepareImageMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('@/modules/files/image', () => ({ prepareImage: prepareImageMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage } from './record-page';

type Release = { ok: () => void; fail: (message: string) => void };
let uploads: Release[] = [];
let uploadCounter = 0;
/** Panggilan serialProofs.upload yang sudah dibatalkan lewat AbortSignal. */
let aborted = 0;

function seedDraft(serials: string[]) {
  let n = 0;
  const rows: StagingRow[] = addSerials(
    [],
    serials.join('\n'),
    {
      itemId: 'i1',
      itemLabel: 'Cisco C9200',
      buId: 'b1',
      buLabel: 'BU1',
      testDate: '2026-11-12',
      locationId: 'l1',
      locationLabel: 'Jakarta (JKT)',
      sample: false,
      note: '',
      stickers: [],
    },
    () => `id-${String(++n).padStart(8, '0')}`,
    () => '2026-11-12T10:00:00.000Z',
  ).rows;
  saveDraft('a@gmail.com', rows);
}

beforeEach(() => {
  localStorage.clear();
  uploads = [];
  uploadCounter = 0;
  aborted = 0;
  prepareImageMock.mockReset();
  prepareImageMock.mockResolvedValue({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 10,
    height: 10,
  });
  apiMock.mockImplementation(
    (id: string, input: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
      if (id === 'serials.locationOptions') {
        return Promise.resolve({ locations: [{ id: 'l1', code: 'JKT', name: 'Jakarta' }] });
      }
      if (id === 'serials.itemOptions') return Promise.resolve({ items: [], nextCursor: null });
      if (id === 'serials.lookupMany') return Promise.resolve({ found: [] });
      if (id === 'serials.saveBatch') {
        const rows = input.rows as { clientId: string }[];
        return Promise.resolve({
          results: rows.map((row) => ({ clientId: row.clientId, result: 'created', message: '' })),
        });
      }
      if (id === 'serialProofs.remove') return Promise.resolve({ id: String(input.id) });
      if (id === 'serialProofs.upload') {
        return new Promise((resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            aborted += 1;
            reject(new DOMException('Dibatalkan', 'AbortError'));
          });
          uploads.push({
            ok: () => {
              uploadCounter += 1;
              resolve({
                id: `up${uploadCounter}`,
                state: 'draft',
                mime: 'image/webp',
                size: 100,
                width: 10,
                height: 10,
                filename: `bukti-up${uploadCounter}.webp`,
                error: null,
              });
            },
            fail: (message) => reject(new Error(message)),
          });
        });
      }
      return Promise.reject(new Error(`api tak dikenal: ${id}`));
    },
  );
  me = {
    email: 'a@gmail.com',
    name: 'A',
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
      serialwh: 'none',
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
});

function renderPage(
  extra: {
    onProofChange?: (hasProof: boolean) => void;
    onUploadsPendingChange?: (pending: boolean) => void;
  } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RecordPage {...extra} />
    </QueryClientProvider>,
  );
}

const removeCalls = () =>
  apiMock.mock.calls
    .filter((call) => call[0] === 'serialProofs.remove')
    .map((call) => (call[1] as { id: string }).id)
    .sort();

/** Membuka dialog foto sebuah baris, memilih satu berkas, dan menekan Tambahkan. */
async function addPhoto(serial: string, name = 'baru') {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: new RegExp(`^Foto \\(\\d+\\), ${serial}$`) }),
  );
  const dialog = await screen.findByRole('alertdialog');
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array(4)], `${name}.jpg`, { type: 'image/jpeg' })] },
  });
  await user.click(await screen.findByRole('button', { name: /^Tambahkan \(1\)/ }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
}

const saveButton = () => screen.getByRole('button', { name: /^Simpan \d+ serial|^Coba lagi/ });

test('foto selesai masuk ke proofPhotos baris dan draft; kartu progres hilang', async () => {
  seedDraft(['AAA111', 'BBB222']);
  renderPage();
  await addPhoto('AAA111');
  await waitFor(() => expect(uploads).toHaveLength(1));
  const row = screen.getAllByRole('row')[1] as HTMLElement;
  expect(within(row).getByTestId('attachment-pending')).toBeInTheDocument();
  await act(async () => uploads[0]?.ok());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Foto (1), AAA111' })).toBeInTheDocument(),
  );
  expect(screen.queryByTestId('attachment-pending')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Foto bukti 1, AAA111' })).toHaveAttribute(
    'src',
    '/api/v1/serial-proofs/up1',
  );
  // Draf hanya menyimpan foto yang selesai.
  await waitFor(() =>
    expect(loadDraft('a@gmail.com')[0]?.proofPhotos.map((photo) => photo.id)).toEqual(['up1']),
  );
  expect(screen.getByRole('button', { name: 'Foto (0), BBB222' })).toBeInTheDocument();
});

test('Simpan ditahan selagi ada unggahan berjalan, dengan pesan jumlahnya, dan aktif lagi setelah selesai', async () => {
  seedDraft(['AAA111']);
  renderPage();
  expect(await screen.findByRole('button', { name: /^Simpan 1 serial/ })).toBeEnabled();
  await addPhoto('AAA111');
  await waitFor(() => expect(saveButton()).toBeDisabled());
  expect(screen.getByText(/1 foto masih diunggah atau gagal/)).toBeInTheDocument();
  await act(async () => uploads[0]?.ok());
  await waitFor(() => expect(saveButton()).toBeEnabled());
  expect(screen.queryByText(/foto masih diunggah atau gagal/)).not.toBeInTheDocument();
});

test('unggahan gagal juga menahan Simpan sampai diulang (lalu selesai) atau dibuang', async () => {
  seedDraft(['AAA111']);
  renderPage();
  await addPhoto('AAA111');
  await waitFor(() => expect(uploads).toHaveLength(1));
  await act(async () => uploads[0]?.fail('Server menolak'));
  expect(await screen.findByText('Server menolak')).toBeInTheDocument();
  expect(saveButton()).toBeDisabled();
  expect(screen.getByText(/1 foto masih diunggah atau gagal/)).toBeInTheDocument();

  // Ulangi: berjalan lagi (masih menahan), selesai membuka Simpan.
  await userEvent.click(screen.getByRole('button', { name: /^Ulangi / }));
  await waitFor(() => expect(uploads).toHaveLength(2));
  expect(saveButton()).toBeDisabled();
  await act(async () => uploads[1]?.ok());
  await waitFor(() => expect(saveButton()).toBeEnabled());

  // Gagal lagi pada foto kedua lalu dibuang: Simpan aktif kembali.
  await addPhoto('AAA111', 'kedua');
  await waitFor(() => expect(uploads).toHaveLength(3));
  await act(async () => uploads[2]?.fail('Gagal lagi'));
  await waitFor(() => expect(saveButton()).toBeDisabled());
  await userEvent.click(screen.getByRole('button', { name: /^Buang kedua/ }));
  await waitFor(() => expect(saveButton()).toBeEnabled());
});

test('menghapus baris membatalkan unggahannya; hasil yang tetap tiba dibuang di server', async () => {
  seedDraft(['AAA111', 'BBB222']);
  renderPage();
  await addPhoto('AAA111');
  await waitFor(() => expect(uploads).toHaveLength(1));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus AAA111' }));
  await waitFor(() => expect(aborted).toBe(1));
  expect(screen.queryByTestId('attachment-pending')).not.toBeInTheDocument();
  // Simpan tidak lagi ditahan (entri dibuang bersama barisnya).
  await waitFor(() => expect(saveButton()).toBeEnabled());
  expect(removeCalls()).toEqual([]);
});

test('onProofChange true selama ada unggahan berjalan walau belum ada baris berfoto; false setelah dibuang', async () => {
  seedDraft(['AAA111']);
  const onProofChange = vi.fn();
  renderPage({ onProofChange });
  await waitFor(() => expect(onProofChange).toHaveBeenLastCalledWith(false));
  await addPhoto('AAA111');
  await waitFor(() => expect(onProofChange).toHaveBeenLastCalledWith(true));
  await userEvent.click(await screen.findByRole('button', { name: /^Batalkan / }));
  await waitFor(() => expect(onProofChange).toHaveBeenLastCalledWith(false));
});

test('beralih dari tabel ke kartu saat unggahan berjalan tidak menghentikannya; kartu menampilkan progresnya', async () => {
  const real = window.matchMedia;
  let matches = true;
  const listeners: Array<() => void> = [];
  window.matchMedia = vi.fn(() => ({
    get matches() {
      return matches;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  try {
    seedDraft(['AAA111']);
    renderPage();
    await addPhoto('AAA111');
    await waitFor(() => expect(uploads).toHaveLength(1));
    matches = false;
    act(() => {
      for (const listener of listeners) listener();
    });
    expect(await screen.findByTestId('attachment-pending')).toBeInTheDocument();
    expect(aborted).toBe(0);
    await act(async () => uploads[0]?.ok());
    expect(await screen.findByText('1 foto')).toBeInTheDocument();
    expect(screen.queryByTestId('attachment-pending')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(loadDraft('a@gmail.com')[0]?.proofPhotos.map((photo) => photo.id)).toEqual(['up1']),
    );
  } finally {
    window.matchMedia = real;
  }
});

test('F5: foto yang mulai diunggah selagi Simpan menunggu pencarian serial membuat Simpan batal (tanpa kirim)', async () => {
  seedDraft(['AAA111']);
  let finishLookup: () => void = () => undefined;
  const base = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>, options?: unknown) => {
    if (id === 'serials.lookupMany') {
      return new Promise((resolve) => {
        finishLookup = () => resolve({ found: [] });
      });
    }
    return base?.(id, input, options);
  });
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /^Simpan 1 serial/ }));
  // Selama pencarian berjalan, tabel belum `saving`: foto masih bisa ditambahkan.
  await addPhoto('AAA111');
  await waitFor(() => expect(uploads).toHaveLength(1));
  await act(async () => finishLookup());
  expect(
    await screen.findByText(/Masih ada foto yang diunggah atau gagal diunggah/),
  ).toBeInTheDocument();
  expect(apiMock.mock.calls.some((call) => call[0] === 'serials.saveBatch')).toBe(false);
});

test('F2: di layar sempit unggahan gagal pada kartu dapat dibuang atau diulang (Simpan tidak macet)', async () => {
  const media = mockMatchMedia(true);
  try {
    seedDraft(['AAA111']);
    renderPage();
    await addPhoto('AAA111');
    await waitFor(() => expect(uploads).toHaveLength(1));
    await act(async () => uploads[0]?.fail('Server menolak'));
    media.set(false);
    // Kartu: kendali Ulangi/Buang tersedia pada baris itu sendiri.
    const list = await screen.findByRole('list', { name: 'Draft serial yang akan disimpan' });
    const card = within(list).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(card).getByText('Server menolak')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    await userEvent.click(within(card).getByRole('button', { name: /^Ulangi / }));
    await waitFor(() => expect(uploads).toHaveLength(2));
    await act(async () => uploads[1]?.fail('Gagal lagi'));
    await userEvent.click(await screen.findByRole('button', { name: /^Buang / }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
  } finally {
    media.restore();
  }
});

test('onUploadsPendingChange true selama unggahan berjalan atau gagal, false setelah selesai atau dibuang', async () => {
  seedDraft(['AAA111']);
  const onPending = vi.fn();
  renderPage({ onUploadsPendingChange: onPending });
  await addPhoto('AAA111');
  await waitFor(() => expect(onPending).toHaveBeenLastCalledWith(true));
  await act(async () => uploads[0]?.fail('Server menolak'));
  expect(await screen.findByText('Server menolak')).toBeInTheDocument();
  expect(onPending).toHaveBeenLastCalledWith(true);
  await userEvent.click(screen.getByRole('button', { name: /^Buang / }));
  await waitFor(() => expect(onPending).toHaveBeenLastCalledWith(false));
});
