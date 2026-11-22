import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { longPress } from '@/test/long-press';
import { mockMatchMedia } from '@/test/match-media';
import { addSerials, type StagingRow } from '../lib/draft';
import { saveDraft } from '../lib/draft-store';
import { optionsApi, proofRef, testMe } from '../test-support';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage } from './record-page';

let media: ReturnType<typeof mockMatchMedia>;

function seedDraft(entries: { serial: string; photos?: string[] }[]) {
  let n = 0;
  const rows: StagingRow[] = addSerials(
    [],
    entries.map((entry) => entry.serial).join('\n'),
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
  ).rows.map((row, index) => ({
    ...row,
    proofPhotos: (entries[index]?.photos ?? []).map(proofRef),
  }));
  saveDraft('a@gmail.com', rows);
}

beforeEach(() => {
  localStorage.clear();
  apiMock.mockImplementation(optionsApi);
  me = testMe();
});

afterEach(() => {
  media?.restore();
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

const removedIds = () =>
  apiMock.mock.calls
    .filter((call) => call[0] === 'serialProofs.remove')
    .map((call) => (call[1] as { id: string }).id)
    .sort();

test('layar lebar: hanya tabel yang terender (tanpa kartu)', async () => {
  media = mockMatchMedia(true);
  seedDraft([{ serial: 'AAA111' }, { serial: 'BBB222' }]);
  renderPage();
  expect(await screen.findAllByRole('row')).toHaveLength(3);
  expect(screen.queryByRole('button', { name: 'Ubah baris AAA111' })).toBeNull();
  expect(screen.getAllByRole('checkbox', { name: 'Pilih baris AAA111' })).toHaveLength(1);
});

test('layar sempit: hanya kartu yang terender (tanpa elemen table)', async () => {
  media = mockMatchMedia(false);
  seedDraft([{ serial: 'AAA111' }, { serial: 'BBB222' }]);
  renderPage();
  expect(await screen.findByRole('button', { name: 'Ubah baris AAA111' })).toBeInTheDocument();
  expect(document.querySelector('table')).toBeNull();
  // Ponsel: tanpa kotak centang sampai mode pilih (tekan lama).
  expect(screen.queryAllByRole('checkbox', { name: 'Pilih baris AAA111' })).toHaveLength(0);
});

test('200 baris: hanya satu tampilan yang terender pada tiap lebar', async () => {
  media = mockMatchMedia(true);
  seedDraft(Array.from({ length: 200 }, (_, index) => ({ serial: `SN${index}` })));
  renderPage();
  expect(await screen.findAllByRole('row')).toHaveLength(201);
  expect(screen.getAllByRole('checkbox', { name: /^Pilih baris / })).toHaveLength(200);
  act(() => media.set(false));
  expect(await screen.findAllByRole('listitem')).toHaveLength(200);
  expect(screen.queryAllByRole('row')).toHaveLength(0);
  expect(screen.queryAllByRole('checkbox', { name: /^Pilih baris / })).toHaveLength(0);
});

test('pilihan baris bertahan saat layar diputar (tabel menjadi kartu)', async () => {
  media = mockMatchMedia(true);
  seedDraft([{ serial: 'AAA111' }, { serial: 'BBB222' }]);
  renderPage();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih baris BBB222' }));
  expect(screen.getByText('1 dipilih')).toBeInTheDocument();
  act(() => media.set(false));
  expect(await screen.findByRole('checkbox', { name: 'Pilih baris BBB222' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Pilih baris AAA111' })).not.toBeChecked();
  expect(screen.getAllByText('1 dipilih').length).toBeGreaterThan(0);
});

test('bar aksi hanya muncul bila ada baris dicentang; Pilih semua dari header; Batalkan pilihan mengosongkan', async () => {
  media = mockMatchMedia(true);
  seedDraft([{ serial: 'AAA111' }, { serial: 'BBB222' }, { serial: 'CCC333' }]);
  renderPage();
  await screen.findByRole('checkbox', { name: 'Pilih semua baris' });
  expect(screen.queryByRole('button', { name: 'Batalkan pilihan' })).toBeNull();
  expect(screen.queryByText(/dipilih$/)).toBeNull();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua baris' }));
  expect(screen.getByText('3 dipilih')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Batalkan pilihan' }));
  expect(screen.queryByText(/dipilih$/)).toBeNull();
  for (const serial of ['AAA111', 'BBB222', 'CCC333']) {
    expect(screen.getByRole('checkbox', { name: `Pilih baris ${serial}` })).not.toBeChecked();
  }
});

test('Edit membuka dialog ubah massal; Terapkan mengubah baris terpilih, menutup dialog, pilihan bertahan', async () => {
  media = mockMatchMedia(true);
  seedDraft([{ serial: 'AAA111' }, { serial: 'BBB222' }]);
  renderPage();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih baris AAA111' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const dialog = await screen.findByRole('dialog', { name: 'Ubah 1 baris' });
  await userEvent.type(within(dialog).getByLabelText('Catatan (ubah massal)'), 'massal');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Terapkan ke 1 baris' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getAllByText('Catatan: massal')).toHaveLength(1);
  expect(screen.getByRole('checkbox', { name: 'Pilih baris AAA111' })).toBeChecked();
  expect(screen.getByText('1 dipilih')).toBeInTheDocument();
});

test('Hapus dari bar meminta konfirmasi yang menyebut foto; Batal tidak menghapus', async () => {
  media = mockMatchMedia(true);
  seedDraft([
    { serial: 'AAA111', photos: ['p1', 'p2'] },
    { serial: 'BBB222', photos: ['p3'] },
  ]);
  renderPage();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih baris AAA111' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const confirm = await screen.findByRole('alertdialog', { name: 'Hapus 1 baris?' });
  expect(within(confirm).getByText(/2 foto buktinya ikut dibuang/)).toBeInTheDocument();
  await userEvent.click(within(confirm).getByRole('button', { name: 'Batal' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(screen.getByRole('textbox', { name: 'Serial AAA111' })).toBeInTheDocument();
  expect(removedIds()).toEqual([]);
});

test('konfirmasi Hapus membuang baris terpilih dan foto draft semua baris itu', async () => {
  media = mockMatchMedia(true);
  seedDraft([
    { serial: 'AAA111', photos: ['p1', 'p2'] },
    { serial: 'BBB222', photos: ['p3'] },
    { serial: 'CCC333', photos: ['p4'] },
  ]);
  renderPage();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih baris AAA111' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris CCC333' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Hapus 2 baris' }));
  await waitFor(() => expect(removedIds()).toEqual(['p1', 'p2', 'p4']));
  expect(screen.queryByRole('textbox', { name: 'Serial AAA111' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Serial CCC333' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Serial BBB222' })).toBeInTheDocument();
  expect(screen.queryByText(/dipilih$/)).toBeNull();
});

test('Hapus massal juga berlaku pada kartu di ponsel', async () => {
  media = mockMatchMedia(false);
  seedDraft([{ serial: 'AAA111', photos: ['p1'] }, { serial: 'BBB222' }]);
  renderPage();
  await screen.findByRole('button', { name: 'Ubah baris AAA111' });
  await longPress(screen.getAllByRole('listitem')[0] as HTMLElement);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Hapus 1 baris' }));
  await waitFor(() => expect(removedIds()).toEqual(['p1']));
  expect(screen.queryByRole('button', { name: 'Ubah baris AAA111' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Ubah baris BBB222' })).toBeInTheDocument();
});

test('mengetuk kartu membuka dialog Ubah baris dengan semua kolom; Terapkan memperbarui kartu', async () => {
  media = mockMatchMedia(false);
  seedDraft([{ serial: 'AAA111' }]);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah baris AAA111' }));
  const dialog = await screen.findByRole('dialog', { name: 'Ubah baris AAA111' });
  for (const label of ['Serial baris', 'Tanggal uji baris', 'Catatan baris']) {
    expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
  }
  expect(within(dialog).getByRole('combobox', { name: 'Item baris' })).toBeInTheDocument();
  expect(within(dialog).getByRole('combobox', { name: 'Lokasi baris' })).toBeInTheDocument();
  expect(within(dialog).getByRole('checkbox', { name: 'Sample' })).toBeInTheDocument();
  const apply = within(dialog).getByRole('button', { name: 'Terapkan' });
  await waitFor(() => expect(apply).toBeEnabled());
  await userEvent.type(within(dialog).getByLabelText('Catatan baris'), 'dari dialog');
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Sample' }));
  await userEvent.click(apply);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const card = screen.getByRole('listitem');
  expect(within(card).getByText('Catatan: dari dialog')).toBeInTheDocument();
  expect(within(card).getByText('Sample')).toBeInTheDocument();
});

test('dialog Ubah baris menolak serial yang sudah ada di draft', async () => {
  media = mockMatchMedia(false);
  seedDraft([{ serial: 'AAA111' }, { serial: 'BBB222' }]);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah baris BBB222' }));
  const dialog = await screen.findByRole('dialog');
  const apply = within(dialog).getByRole('button', { name: 'Terapkan' });
  await waitFor(() => expect(apply).toBeEnabled());
  const serial = within(dialog).getByLabelText('Serial baris');
  await userEvent.clear(serial);
  await userEvent.type(serial, 'aaa111');
  await userEvent.click(apply);
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Serial sudah ada di tabel');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  expect(screen.getByRole('button', { name: 'Ubah baris BBB222' })).toBeInTheDocument();
});

test('dialog Ubah baris: mengganti serial yang sah mengganti kartu dan mempertahankan foto', async () => {
  media = mockMatchMedia(false);
  seedDraft([{ serial: 'AAA111', photos: ['p1'] }]);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah baris AAA111' }));
  const dialog = await screen.findByRole('dialog');
  const apply = within(dialog).getByRole('button', { name: 'Terapkan' });
  await waitFor(() => expect(apply).toBeEnabled());
  const serial = within(dialog).getByLabelText('Serial baris');
  await userEvent.clear(serial);
  await userEvent.type(serial, 'zzz999');
  await userEvent.click(apply);
  expect(await screen.findByRole('button', { name: 'Ubah baris ZZZ999' })).toBeInTheDocument();
  expect(screen.getByText('1 foto')).toBeInTheDocument();
  expect(removedIds()).toEqual([]);
});

test('ruang untuk bar aksi ada di dasar halaman (pembungkus) hanya saat ada pilihan, bukan pengganjal di atas daftar', async () => {
  media = mockMatchMedia(false);
  seedDraft([{ serial: 'AAA111' }, { serial: 'BBB222' }]);
  const { container } = renderPage();
  const wrapper = container.firstElementChild as HTMLElement;
  await screen.findByRole('button', { name: 'Ubah baris AAA111' });
  expect(wrapper.className).not.toContain('narrow:pb-');
  expect(wrapper).not.toHaveAttribute('data-selection-space');

  await longPress(screen.getAllByRole('listitem')[0] as HTMLElement);
  expect(screen.getAllByText('1 dipilih').length).toBeGreaterThan(0);
  expect(wrapper.className).toContain('narrow:pb-');
  expect(wrapper).toHaveAttribute('data-selection-space', 'on');
  // Tidak ada elemen kosong aria-hidden di antara notice/bar dan judul daftar draft.
  const heading = screen.getByRole('heading', { name: /^Draft \(/ });
  const barSection = screen.getByRole('region', { name: 'Aksi baris terpilih' });
  let node: Element | null = barSection.nextElementSibling;
  while (node && !node.contains(heading)) {
    expect(node.getAttribute('aria-hidden')).toBeNull();
    node = node.nextElementSibling;
  }
  expect(wrapper.querySelector('div[aria-hidden]:empty')).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: 'Batalkan pilihan' }));
  expect(wrapper.className).not.toContain('narrow:pb-');
  expect(wrapper).not.toHaveAttribute('data-selection-space');
});

test('ponsel: Simpan, pindai kamera, dan menu draft ada di bar bawah menempel; desktop memakai tombol biasa', async () => {
  media = mockMatchMedia(false);
  seedDraft([{ serial: 'AAA111' }]);
  const { unmount } = renderPage();
  await screen.findByRole('button', { name: 'Ubah baris AAA111' });
  const bar = screen.getByRole('region', { name: 'Aksi draft' });
  expect(within(bar).getByRole('button', { name: /^Simpan 1 serial/ })).toBeInTheDocument();
  expect(within(bar).getByRole('button', { name: 'Pindai dengan kamera' })).toBeInTheDocument();
  await userEvent.click(within(bar).getByRole('button', { name: 'Menu draft' }));
  expect(await screen.findByRole('menuitem', { name: /Impor \.qcsn/ })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: /Kosongkan draft/ })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  unmount();
  media = mockMatchMedia(true);
  renderPage();
  await screen.findAllByRole('row');
  expect(screen.queryByRole('region', { name: 'Aksi draft' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Kosongkan draft' })).toBeInTheDocument();
});

test('ponsel: mode pilih kartu draft hanya punya SATU bar (bawah), tanpa header kit di atas daftar', async () => {
  media = mockMatchMedia(false);
  seedDraft([{ serial: 'AAA111' }, { serial: 'BBB222' }]);
  const { container } = renderPage();
  await screen.findByRole('button', { name: 'Ubah baris AAA111' });
  await longPress(screen.getAllByRole('listitem')[0] as HTMLElement);
  // Bar bawah (aria-label "Aksi baris terpilih") satu-satunya: "1 dipilih" hanya sekali, tanpa header kit.
  expect(container.querySelector('[data-slot="selection-bar"]')).toBeNull();
  expect(screen.getAllByText('1 dipilih')).toHaveLength(1);
  const bar = screen.getByRole('region', { name: 'Aksi baris terpilih' });
  expect(within(bar).getByRole('button', { name: 'Batalkan pilihan' })).toBeInTheDocument();
  expect(within(bar).getByRole('checkbox', { name: 'Pilih semua' })).toBeInTheDocument();
  await userEvent.click(within(bar).getByRole('checkbox', { name: 'Pilih semua' }));
  expect(screen.getByText('2 dipilih')).toBeInTheDocument();
  await userEvent.click(within(bar).getByRole('button', { name: 'Batalkan pilihan' }));
  expect(screen.queryByRole('region', { name: 'Aksi baris terpilih' })).toBeNull();
});

test('ponsel: mode pilih lewat tombol "Pilih baris draft" (0 butir) tetap menampilkan bar bawah tunggal dan menyembunyikan bar Simpan', async () => {
  media = mockMatchMedia(false);
  seedDraft([{ serial: 'AAA111' }, { serial: 'BBB222' }]);
  const { container } = renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Pilih baris draft' }));
  expect(container.querySelector('[data-slot="selection-bar"]')).toBeNull();
  const bar = screen.getByRole('region', { name: 'Aksi baris terpilih' });
  expect(within(bar).getByText('0 dipilih')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Aksi draft' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Batalkan pilihan' }));
  expect(screen.queryByRole('region', { name: 'Aksi baris terpilih' })).toBeNull();
});
