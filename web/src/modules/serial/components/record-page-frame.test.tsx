import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { longPress } from '@/test/long-press';
import { mockMatchMedia } from '@/test/match-media';
import { addSerials, type StagingRow } from '../lib/draft';
import { saveDraft } from '../lib/draft-store';
import { optionsApi, testMe } from '../test-support';

// `RecordPage` dalam `FormPage` (rute /serial/new; keputusan pemilik 2026-11-21): judul + Batal + Simpan di bar judul
// (desktop) atau bar bawah berisi Batal, kamera, Impor/Ekspor, dan Simpan (ponsel); Simpan ditahan selama unggahan foto.

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('@/modules/files/image', () => ({
  prepareImage: vi.fn(async () => ({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 10,
    height: 10,
  })),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage } from './record-page';

let media: ReturnType<typeof mockMatchMedia>;
/** Unggahan foto yang menggantung (belum selesai) agar Simpan tetap ditahan. */
let pendingUploads = 0;

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
  pendingUploads = 0;
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serialProofs.upload') {
      pendingUploads += 1;
      return new Promise(() => undefined);
    }
    return optionsApi(id, input);
  });
  me = testMe();
});

afterEach(() => {
  media?.restore();
  vi.restoreAllMocks();
  apiMock.mockReset();
});

function renderPage(onCancel = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RecordPage frame={{ title: 'Catat Serial Number', formId: 'record-form', onCancel }} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return onCancel;
}

test('desktop: judul, Batal, dan Simpan ada di bar judul; tidak ada bar bawah ponsel', async () => {
  media = mockMatchMedia(true);
  seedDraft(['AAA111', 'BBB222']);
  const onCancel = renderPage();
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Catat Serial Number' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Simpan 2 serial/ })).toBeEnabled();
  // Satu-satunya tombol Simpan (bukan juga di bawah tabel) dan satu judul.
  expect(screen.getAllByRole('button', { name: /^Simpan \d+ serial/ })).toHaveLength(1);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.queryByRole('region', { name: 'Aksi form' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Aksi draft' })).toBeNull();
  // Impor/Ekspor dan Kosongkan draft tetap di baris Draft.
  expect(screen.getByRole('button', { name: 'Kosongkan draft' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('Simpan di bar judul mengirim draft (lewat form kosong), bukan lewat Enter di kolom scan', async () => {
  media = mockMatchMedia(true);
  seedDraft(['AAA111']);
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.saveBatch') {
      const rows = input.rows as { clientId: string }[];
      return Promise.resolve({
        results: rows.map((row) => ({ clientId: row.clientId, result: 'created', message: '' })),
      });
    }
    return optionsApi(id, input);
  });
  renderPage();
  const save = await screen.findByRole('button', { name: /^Simpan 1 serial/ });
  // Enter di kolom scan tidak mengirim form halaman.
  await userEvent.type(screen.getByRole('textbox', { name: /Scan atau tempel serial/ }), '{Enter}');
  expect(apiMock.mock.calls.some((call) => call[0] === 'serials.saveBatch')).toBe(false);
  await userEvent.click(save);
  await waitFor(() =>
    expect(apiMock.mock.calls.some((call) => call[0] === 'serials.saveBatch')).toBe(true),
  );
});

test('ponsel: bar bawah memuat Batal, Simpan, Pindai dengan kamera, dan menu Impor/Ekspor; bar atas tanpa aksi', async () => {
  media = mockMatchMedia(false);
  seedDraft(['AAA111']);
  renderPage();
  const bar = await screen.findByRole('region', { name: 'Aksi form' });
  expect(within(bar).getByRole('button', { name: 'Batal' })).toBeInTheDocument();
  expect(within(bar).getByRole('button', { name: /^Simpan 1 serial/ })).toBeEnabled();
  expect(within(bar).getByRole('button', { name: 'Pindai dengan kamera' })).toBeInTheDocument();
  expect(within(bar).getByRole('button', { name: 'Menu draft' })).toBeInTheDocument();
  // Bar "Aksi draft" lama tidak lagi dirender (tak ada dua bar bawah).
  expect(screen.queryByRole('region', { name: 'Aksi draft' })).toBeNull();
  expect(screen.getAllByRole('button', { name: /^Simpan \d+ serial/ })).toHaveLength(1);
});

test('ponsel: mode pilih mengganti bar bawah dengan bar aksi pilihan; keluar dari mode pilih mengembalikannya', async () => {
  media = mockMatchMedia(false);
  seedDraft(['AAA111', 'BBB222']);
  renderPage();
  await screen.findByRole('region', { name: 'Aksi form' });
  await longPress(screen.getAllByRole('listitem')[0] as HTMLElement);
  expect(screen.queryByRole('region', { name: 'Aksi form' })).toBeNull();
  expect(screen.getAllByText('1 dipilih').length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: 'Batalkan pilihan' }));
  expect(await screen.findByRole('region', { name: 'Aksi form' })).toBeInTheDocument();
});

test('Simpan ditahan selama unggahan foto berjalan, dengan alasan tampil; tanpa foto aktif lagi', async () => {
  media = mockMatchMedia(true);
  seedDraft(['AAA111']);
  renderPage();
  expect(await screen.findByRole('button', { name: /^Simpan 1 serial/ })).toBeEnabled();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /^Foto \(\d+\), AAA111$/ }));
  const dialog = await screen.findByRole('alertdialog');
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array(4)], 'baru.jpg', { type: 'image/jpeg' })] },
  });
  await user.click(await screen.findByRole('button', { name: /^Tambahkan \(1\)/ }));
  await waitFor(() => expect(pendingUploads).toBe(1));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Simpan 1 serial/ })).toBeDisabled(),
  );
  expect(screen.getByText(/1 foto masih diunggah atau gagal/)).toBeInTheDocument();
});

test('tanpa frame (dialog Country Lock): bar Simpan sendiri tetap dipakai, tanpa heading atau FormPage', async () => {
  media = mockMatchMedia(true);
  seedDraft(['AAA111']);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RecordPage hideTitle />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('button', { name: /^Simpan 1 serial/ })).toBeEnabled();
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Batal' })).toBeNull();
  act(() => media.set(false));
  expect(await screen.findByRole('region', { name: 'Aksi draft' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Aksi form' })).toBeNull();
});

test('704-767 px (viewport ponsel, <main> lebar): Batal dan Simpan tetap ada di bar atas, kamera dan Impor/Ekspor tidak hilang', async () => {
  window.innerWidth = 744;
  media = mockMatchMedia(true);
  seedDraft(['AAA111']);
  const onCancel = renderPage();
  expect(await screen.findByRole('button', { name: /^Simpan 1 serial/ })).toBeEnabled();
  expect(screen.getAllByRole('button', { name: /^Simpan \d+ serial/ })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Batal' })).toHaveLength(1);
  expect(screen.queryByRole('region', { name: 'Aksi form' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Kosongkan draft' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  window.innerWidth = 1024;
});
