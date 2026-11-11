import type { PostelListDto, PostelSummaryDto } from '@shared/contract';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { pickSelect } from '@/test/link-field';
import { PostelsPage } from './postels-page';

const summary = (over: Partial<PostelSummaryDto>): PostelSummaryDto => ({
  id: 'p1',
  name: 'M5-400',
  itemCount: 2,
  activeNumber: 'AB-1',
  activeExpiresOn: '2027-03-01',
  condition: 'valid',
  daysLeft: 200,
  oldNumberCount: 0,
  updatedAt: '2026-11-10T03:00:00.000Z',
  ...over,
});

const list = (postels: PostelSummaryDto[]): PostelListDto => ({
  postels,
  today: '2026-11-12',
  soonDays: 90,
});

const DATA = list([
  summary({ id: 'p-late', name: 'Zeta', activeNumber: 'ZZ-9', activeExpiresOn: '2028-01-01' }),
  summary({
    id: 'p-soon',
    name: 'Beta',
    activeNumber: 'AB-1',
    activeExpiresOn: '2026-12-01',
    condition: 'soon',
    daysLeft: 19,
    oldNumberCount: 2,
  }),
  summary({
    id: 'p-exp',
    name: 'Alfa',
    activeNumber: 'CD-5',
    activeExpiresOn: '2026-10-01',
    condition: 'expired',
    daysLeft: -42,
  }),
]);

function renderPage(over: Partial<Parameters<typeof PostelsPage>[0]> = {}) {
  const props = { data: DATA, canEdit: true, onNew: vi.fn(), onOpen: vi.fn(), ...over };
  render(<PostelsPage {...props} />);
  return props;
}

const bodyRows = () => screen.getAllByRole('row').slice(1);

test('baris diurutkan menurut tanggal habis nomor Aktif menaik', () => {
  renderPage();
  expect(bodyRows().map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
    'Alfa',
    'Beta',
    'Zeta',
  ]);
});

test('kolom: jumlah item, nomor Aktif, tanggal, sisa hari, kondisi, nomor lama, diperbarui', () => {
  renderPage();
  for (const header of [
    'Nama',
    'Jumlah item',
    'Nomor Aktif',
    'Tanggal habis',
    'Sisa hari',
    'Kondisi',
    'Nomor lama',
    'Diperbarui',
  ])
    expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
  const beta = bodyRows()[1] as HTMLElement;
  expect(beta).toHaveTextContent('AB-1');
  expect(beta).toHaveTextContent('19 hari');
  expect(beta).toHaveTextContent('Segera habis');
  expect(bodyRows()[0]).toHaveTextContent('Lewat 42 hari');
  expect(bodyRows()[0]).toHaveTextContent('Kedaluwarsa');
});

test('filter kondisi "Segera habis" menyisakan baris soon; "Kedaluwarsa" baris expired', async () => {
  renderPage();
  await pickSelect(screen, 'Filter kondisi', 'Segera habis');
  expect(bodyRows()).toHaveLength(1);
  expect(bodyRows()[0]).toHaveTextContent('Beta');
  await pickSelect(screen, 'Filter kondisi', 'Kedaluwarsa');
  expect(bodyRows()).toHaveLength(1);
  expect(bodyRows()[0]).toHaveTextContent('Alfa');
  await pickSelect(screen, 'Filter kondisi', 'Semua');
  expect(bodyRows()).toHaveLength(3);
});

test('pencarian menemukan nomor Aktif tanpa peduli huruf besar, dan nama', async () => {
  renderPage();
  await userEvent.type(screen.getByRole('searchbox', { name: 'Cari Postel' }), 'ab-1');
  expect(bodyRows()).toHaveLength(1);
  expect(bodyRows()[0]).toHaveTextContent('Beta');
  await userEvent.clear(screen.getByRole('searchbox', { name: 'Cari Postel' }));
  await userEvent.type(screen.getByRole('searchbox', { name: 'Cari Postel' }), 'zet');
  expect(bodyRows()).toHaveLength(1);
  expect(bodyRows()[0]).toHaveTextContent('ZZ-9');
});

test('tanpa hasil: keterangan tidak ada yang cocok', async () => {
  renderPage();
  await userEvent.type(screen.getByRole('searchbox', { name: 'Cari Postel' }), 'tidak-ada');
  expect(screen.getByText('Tidak ada Postel yang cocok.')).toBeInTheDocument();
});

test('keadaan kosong', () => {
  renderPage({ data: list([]) });
  expect(screen.getByText('Belum ada catatan Postel.')).toBeInTheDocument();
});

test('tombol Tambah Postel hanya bila canEdit dan memanggil onNew', async () => {
  const props = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Postel' }));
  expect(props.onNew).toHaveBeenCalledTimes(1);
});

test('tanpa canEdit tombol Tambah Postel tersembunyi', () => {
  renderPage({ canEdit: false });
  expect(screen.queryByRole('button', { name: 'Tambah Postel' })).not.toBeInTheDocument();
});

test('klik nama membuka catatan', async () => {
  const props = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Beta' }));
  expect(props.onOpen).toHaveBeenCalledWith('p-soon');
});

test('dengan openHref nama menjadi tautan; klik biasa memakai onOpen, klik modifikasi dibiarkan ke peramban', () => {
  const props = renderPage({ openHref: (id) => `/postel/${id}` });
  expect(screen.queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Beta' });
  expect(link).toHaveAttribute('href', '/postel/p-soon');
  // jsdom tidak mengimplementasikan navigasi dokumen: cukup pastikan klik modifikasi tidak dicegat.
  link.addEventListener('click', (event) => event.preventDefault(), { once: true });
  fireEvent.click(link, { ctrlKey: true });
  expect(props.onOpen).not.toHaveBeenCalled();
  fireEvent.click(link);
  expect(props.onOpen).toHaveBeenCalledWith('p-soon');
});

test('openHref yang mengembalikan null (tanpa izin) tetap memakai tombol', () => {
  renderPage({ openHref: () => null });
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Beta' })).toBeInTheDocument();
});
