import type { PostelSummaryDto } from '@shared/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { PostelsTable, type PostelsTableProps } from './postels-table';

const summary = (over: Partial<PostelSummaryDto> = {}): PostelSummaryDto => ({
  id: 'p1',
  name: 'M5-400',
  itemCount: 2,
  activeNumber: 'AB-1',
  activeExpiresOn: '2026-12-01',
  condition: 'soon',
  daysLeft: 19,
  oldNumberCount: 1,
  numbers: ['AB-1', 'OLD-0'],
  models: ['M5-400'],
  updatedAt: '2026-11-10T03:00:00.000Z',
  ...over,
});

const handlers = () => ({ onEdit: vi.fn(), onDelete: vi.fn(), onRestore: vi.fn() });

async function renderTable(postels: PostelSummaryDto[], props: Partial<PostelsTableProps> = {}) {
  const fns = handlers();
  const view = await renderInRouter(<PostelsTable postels={postels} canEdit {...fns} {...props} />);
  return { ...fns, ...view };
}

let media: ReturnType<typeof mockMatchMedia> | undefined;
afterEach(() => {
  media?.restore();
  media = undefined;
  window.innerWidth = 1024;
});

test('nama berupa tautan ke View; kolom memuat nomor Aktif, tanggal habis, sisa hari, kondisi, nomor lama', async () => {
  await renderTable([summary()]);
  expect(screen.getByRole('link', { name: 'M5-400' })).toHaveAttribute('href', '/postel/p1');
  expect(screen.queryByRole('button', { name: /^Lihat/ })).toBeNull();
  const row = screen.getAllByRole('row')[1] as HTMLElement;
  expect(row).toHaveTextContent('AB-1');
  expect(row).toHaveTextContent('19 hari');
  expect(row).toHaveTextContent('Segera habis');
});

test('aksi baris: Ubah dan Hapus memanggil handler dengan catatannya', async () => {
  const data = summary();
  const { onEdit, onDelete } = await renderTable([data]);
  await userEvent.click(screen.getByRole('button', { name: 'Ubah M5-400' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus M5-400' }));
  expect(onEdit).toHaveBeenCalledWith(data);
  expect(onDelete).toHaveBeenCalledWith(data);
});

test('tanpa hak edit: tak ada aksi baris', async () => {
  await renderTable([summary()], { canEdit: false });
  expect(screen.queryByRole('button', { name: /^(Ubah|Hapus)/ })).toBeNull();
});

test('tampilan Terhapus: hanya Pulihkan, kolom Dihapus oleh/pada, penanda Terhapus', async () => {
  const deleted = summary({
    deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
  });
  const { onRestore } = await renderTable([deleted], { deletedView: true });
  expect(screen.getByRole('columnheader', { name: 'Dihapus oleh' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Diperbarui' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^(Ubah|Hapus)/ })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan M5-400' }));
  expect(onRestore).toHaveBeenCalledWith(deleted);
  expect(screen.getByText('Terhapus')).toBeInTheDocument();
});

test('kosong: pesan tabel; kosong karena filter: tombol hapus filter', async () => {
  await renderTable([]);
  expect(screen.getByText('Belum ada catatan Postel.')).toBeInTheDocument();
});

test('ponsel (360 px): kartu dengan nama sebagai judul; aksi lewat satu tombol menu', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  const { onDelete } = await renderTable([summary()]);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('link', { name: 'M5-400' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus M5-400' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /Aksi/ }));
  const menu = await screen.findByRole('menu');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hapus' }));
  expect(onDelete).toHaveBeenCalledTimes(1);
});
