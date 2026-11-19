import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pickLink } from '@/test/link-field';
import { mockMatchMedia } from '@/test/match-media';
import type { StagingRow } from '../lib/draft';
import { saveDraft } from '../lib/draft-store';
import { makeRow, optionsApi, proofRef, testMe } from '../test-support';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage } from './record-page';

let media: ReturnType<typeof mockMatchMedia> | undefined;

function seed(rows: StagingRow[]) {
  saveDraft('a@gmail.com', rows);
}

beforeEach(() => {
  localStorage.clear();
  apiMock.mockImplementation(optionsApi);
  me = testMe();
});

afterEach(() => {
  media?.restore();
  media = undefined;
  vi.restoreAllMocks();
  apiMock.mockReset();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

const saveCalls = () => apiMock.mock.calls.filter((call) => call[0] === 'serials.saveBatch');

test('tabel: baris item wajib foto yang fotonya kurang menampilkan "Butuh n foto lagi" dan memblokir Simpan', async () => {
  seed([
    makeRow('AAA111', { itemId: 'i3', proofMin: 3, proofPhotos: [proofRef('p1')] }),
    makeRow('BBB222'),
  ]);
  renderPage();
  expect(await screen.findByText('Butuh 2 foto lagi')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Simpan 2 serial/ }));
  expect(await screen.findByText(/1 baris belum lengkap/)).toBeInTheDocument();
  expect(saveCalls()).toHaveLength(0);
});

test('kartu: baris item wajib foto menampilkan "Butuh n foto lagi" dan memblokir Simpan', async () => {
  media = mockMatchMedia(false);
  seed([makeRow('AAA111', { itemId: 'i3', proofMin: 3, proofPhotos: [] })]);
  renderPage();
  const card = await screen.findByRole('listitem');
  expect(within(card).getByText('Butuh 3 foto lagi')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Simpan 1 serial/ }));
  expect(await screen.findByText(/1 baris belum lengkap/)).toBeInTheDocument();
  expect(saveCalls()).toHaveLength(0);
});

test('ubah massal: ganti ke item wajib foto memunculkan "Butuh n foto lagi", ganti ke item biasa menghilangkannya', async () => {
  seed([makeRow('AAA111'), makeRow('BBB222')]);
  renderPage();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih baris AAA111' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await pickLink(screen, 'Item (ubah massal)', 'Strict Router');
  await userEvent.click(screen.getByRole('button', { name: 'Terapkan ke 1 baris' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getAllByText('Butuh 3 foto lagi')).toHaveLength(1);

  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await pickLink(screen, 'Item (ubah massal)', 'Aruba 2930');
  await userEvent.click(screen.getByRole('button', { name: 'Terapkan ke 1 baris' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByText(/Butuh \d foto lagi/)).toBeNull();
});

test('Ubah baris: ganti item ke item wajib foto memunculkan "Butuh n foto lagi" dan hilang lagi bila item biasa', async () => {
  media = mockMatchMedia(false);
  seed([makeRow('AAA111')]);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah baris AAA111' }));
  let dialog = await screen.findByRole('dialog');
  await pickLink(within(dialog), 'Item baris', 'Strict Router');
  let apply = within(dialog).getByRole('button', { name: 'Terapkan' });
  await waitFor(() => expect(apply).toBeEnabled());
  await userEvent.click(apply);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByText('Butuh 3 foto lagi')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Ubah baris AAA111' }));
  dialog = await screen.findByRole('dialog');
  await pickLink(within(dialog), 'Item baris', 'Aruba 2930');
  apply = within(dialog).getByRole('button', { name: 'Terapkan' });
  await waitFor(() => expect(apply).toBeEnabled());
  await userEvent.click(apply);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByText(/Butuh \d foto lagi/)).toBeNull();
});

test('Ubah baris: menerapkan tanpa mengganti item mempertahankan proofMin baris', async () => {
  seed([makeRow('AAA111', { itemId: 'i3', proofMin: 3, proofPhotos: [proofRef('p1')] })]);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Detail AAA111' }));
  const dialog = await screen.findByRole('dialog');
  const apply = within(dialog).getByRole('button', { name: 'Terapkan' });
  await waitFor(() => expect(apply).toBeEnabled());
  await userEvent.click(apply);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByText('Butuh 2 foto lagi')).toBeInTheDocument();
});

test('Default kosong: draft yang dimuat tetap bisa dipilih, diedit, dan dihapus lewat bar aksi', async () => {
  media = mockMatchMedia(true);
  seed([makeRow('AAA111'), makeRow('BBB222')]);
  renderPage();
  expect(await screen.findByLabelText('Scan atau tempel serial (satu per baris)')).toBeDisabled();
  expect(screen.getByText(/Isi Default dulu/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris AAA111' }));
  expect(screen.getByText('1 dipilih')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const dialog = await screen.findByRole('dialog', { name: 'Ubah 1 baris' });
  await userEvent.type(within(dialog).getByLabelText('Catatan (ubah massal)'), 'tanpa default');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Terapkan ke 1 baris' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByText('Catatan: tanpa default')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Hapus 1 baris' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Serial AAA111' })).toBeNull());
  expect(screen.getByRole('textbox', { name: 'Serial BBB222' })).toBeInTheDocument();
});

test('Default kosong: Ubah baris dari kartu tetap berfungsi', async () => {
  media = mockMatchMedia(false);
  seed([makeRow('AAA111')]);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah baris AAA111' }));
  expect(await screen.findByRole('dialog', { name: 'Ubah baris AAA111' })).toBeInTheDocument();
});

const itemOptionCalls = () =>
  apiMock.mock.calls.filter((call) => call[0] === 'serials.itemOptions');

test('draft lama tanpa proofMin: item wajib foto disegarkan saat dibuka dan langsung "Butuh n foto lagi" sebelum Simpan', async () => {
  seed([
    makeRow('AAA111', { itemId: 'i3', itemLabel: 'Strict Router', proofPhotos: [proofRef('p1')] }),
    makeRow('BBB222'),
  ]);
  renderPage();
  expect(await screen.findByText('Butuh 2 foto lagi')).toBeInTheDocument();
  // Hanya satu permintaan untuk kumpulan item unik (bukan per baris).
  expect(
    itemOptionCalls().filter((call) => (call[1] as { itemIds?: string[] }).itemIds),
  ).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: /^Simpan 2 serial/ }));
  expect(await screen.findByText(/1 baris belum lengkap/)).toBeInTheDocument();
  expect(saveCalls()).toHaveLength(0);
});

test('draft lama: nilai yang disegarkan dipakai setelah foto bertambah (status memakai minimum item)', async () => {
  seed([
    makeRow('AAA111', { itemId: 'i3', itemLabel: 'Strict Router', proofPhotos: [proofRef('p1')] }),
  ]);
  renderPage();
  expect(await screen.findByText('Butuh 2 foto lagi')).toBeInTheDocument();
  // Simpan draft sesudah segar: minimum ikut tersimpan di perangkat.
  await waitFor(() => {
    const raw = localStorage.getItem('qc.serial.draft:a@gmail.com') ?? '';
    expect(raw).toContain('"proofMin":3');
  });
});

test('draft lama: item yang kini tak wajib foto menghapus proofMin basi', async () => {
  seed([makeRow('AAA111', { proofMin: 3, proofPhotos: [proofRef('p1')] })]);
  renderPage();
  await waitFor(() => expect(screen.queryByText(/Butuh \d foto lagi/)).toBeNull());
  expect(await screen.findByRole('textbox', { name: 'Serial AAA111' })).toBeInTheDocument();
});

test('draft lama: permintaan item gagal = baris tetap seperti semula, tanpa galat', async () => {
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.itemOptions' && Array.isArray(input.itemIds)
      ? Promise.reject(new Error('putus'))
      : optionsApi(id, input),
  );
  seed([makeRow('AAA111', { itemId: 'i3', itemLabel: 'Strict Router' })]);
  renderPage();
  expect(await screen.findByRole('textbox', { name: 'Serial AAA111' })).toBeInTheDocument();
  await waitFor(() => expect(itemOptionCalls().length).toBeGreaterThan(0));
  expect(screen.queryByText(/Butuh \d foto lagi/)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('balapan: penyegaran proofMin selesai selagi Ubah baris terbuka; Terapkan tanpa ganti item tidak menimpanya dengan nilai usang', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  apiMock.mockImplementation(async (id: string, input: Record<string, unknown>) => {
    if (id === 'serials.itemOptions' && Array.isArray(input.itemIds)) await gate;
    return optionsApi(id, input);
  });
  seed([
    makeRow('AAA111', { itemId: 'i3', itemLabel: 'Strict Router', proofPhotos: [proofRef('p1')] }),
  ]);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Detail AAA111' }));
  const dialog = await screen.findByRole('dialog');
  const apply = within(dialog).getByRole('button', { name: 'Terapkan' });
  await waitFor(() => expect(apply).toBeEnabled());
  expect(screen.queryByText(/Butuh \d foto lagi/)).toBeNull();
  release();
  await waitFor(() => expect(screen.getByText('Butuh 2 foto lagi')).toBeInTheDocument());
  await userEvent.click(apply);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByText('Butuh 2 foto lagi')).toBeInTheDocument();
});
