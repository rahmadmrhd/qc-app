import type { QrDesignDto } from '@shared/contract';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { QrDesignsTable, type QrDesignsTableProps } from './qr-designs-table';

const design = (over: Partial<QrDesignDto> = {}): QrDesignDto => ({
  id: 'q1',
  title: 'Panduan USW',
  linkSource: 'url',
  link: 'https://contoh.com/a',
  documentId: '',
  documentName: '',
  subtitle: '',
  footer: '',
  logoFileId: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  overflow: false,
  name: '',
  namePlacement: '',
  presetId: '',
  items: [],
  hiddenItemCount: 0,
  stickerVersion: 0,
  stickerStatus: '',
  exportStatus: 'none',
  exportedAt: '',
  exportedBy: '',
  createdAt: 't',
  createdBy: 'a@x.com',
  updatedAt: '2026-10-16T03:00:00.000Z',
  updatedBy: 'a@x.com',
  ...over,
});

const handlers = () => ({
  onEdit: vi.fn(),
  onExport: vi.fn(),
  onDownload: vi.fn(),
  onDelete: vi.fn(),
  onRestore: vi.fn(),
});

type Props = Partial<QrDesignsTableProps>;

async function renderTable(designs: QrDesignDto[], props: Props = {}) {
  const fns = handlers();
  const view = await renderInRouter(
    <QrDesignsTable designs={designs} canEdit canManage busyId={null} {...fns} {...props} />,
  );
  return { ...fns, ...view };
}

let media: ReturnType<typeof mockMatchMedia> | undefined;
afterEach(() => {
  media?.restore();
  media = undefined;
  window.innerWidth = 1024;
});

const EXPORTED = {
  exportStatus: 'current' as const,
  exportedAt: '2026-10-16T04:00:00.000Z',
  exportedBy: 'm@x.com',
};

test('status ekspor: Belum, Sudah (tanggal dan pelaku), Berubah sejak ekspor', async () => {
  await renderTable([
    design({ id: 'a', title: 'Belum' }),
    design({ id: 'b', title: 'Sudah', ...EXPORTED }),
    design({ id: 'c', title: 'Berubah', ...EXPORTED, exportStatus: 'stale' }),
  ]);
  expect(screen.getByText('Belum diekspor')).toBeInTheDocument();
  expect(screen.getByText('Sudah diekspor')).toBeInTheDocument();
  expect(screen.getByText('Berubah sejak ekspor')).toBeInTheDocument();
  expect(screen.getAllByText(/m@x/)).toHaveLength(2);
});

test('nama berupa tautan ke View; tidak ada tombol "Lihat"', async () => {
  await renderTable([design({ id: 'q1', title: 'Panduan USW' })]);
  expect(screen.getByRole('link', { name: 'Panduan USW' })).toHaveAttribute('href', '/qrcode/q1');
  expect(screen.queryByRole('button', { name: /^Lihat/ })).toBeNull();
});

test('aksi menurut izin: view tidak melihat Ubah/Ekspor/Hapus; Unduh hanya bila sudah pernah diekspor', async () => {
  const exported = design(EXPORTED);
  const first = await renderTable([exported], { canEdit: false, canManage: false });
  expect(screen.queryByRole('button', { name: /^(Ubah|Ekspor|Hapus)/ })).toBeNull();
  // Unduh PDF dan PNG = satu tombol "Unduh" dengan satu dropdown (B5b).
  expect(screen.queryByRole('button', { name: 'Unduh PDF Panduan USW' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Unduh Panduan USW' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Unduh PDF Panduan USW' }));
  expect(first.onDownload).toHaveBeenCalledWith(exported, 'pdf');
  await userEvent.click(screen.getByRole('button', { name: 'Unduh Panduan USW' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Unduh PNG Panduan USW' }));
  expect(first.onDownload).toHaveBeenCalledWith(exported, 'png');
  first.unmount();
  // izin edit: ubah dan ekspor; hapus butuh izin kelola
  await renderTable([design()], { canEdit: true, canManage: false });
  expect(screen.queryByRole('button', { name: /Unduh/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Ubah Panduan USW' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ekspor Panduan USW' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Hapus/ })).toBeNull();
});

test('manage: Ekspor (Ekspor ulang bila sudah pernah) dan Hapus memanggil handler', async () => {
  const first = design();
  const again = design({ id: 'z', title: 'Lama', ...EXPORTED });
  const { onExport, onDelete } = await renderTable([first, again]);
  await userEvent.click(screen.getByRole('button', { name: 'Ekspor Panduan USW' }));
  expect(onExport).toHaveBeenCalledWith(first);
  await userEvent.click(screen.getByRole('button', { name: 'Ekspor ulang Lama' }));
  expect(onExport).toHaveBeenCalledWith(again);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Lama' }));
  expect(onDelete).toHaveBeenCalledWith(again);
});

test('kosong: pesan dan ajakan membuat konfigurasi pertama', async () => {
  await renderTable([], { emptyAction: <button type="button">Buat konfigurasi pertama</button> });
  expect(screen.getByText(/Belum ada konfigurasi/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Buat konfigurasi pertama' })).toBeInTheDocument();
});

test('subtitle tampil di bawah nama; tanpa subtitle tidak ada baris kosong', async () => {
  await renderTable([
    design({ id: 'a', title: 'Dengan Sub', subtitle: 'USW PRO MAX 48 PoE' }),
    design({ id: 'b', title: 'Tanpa Sub', subtitle: '' }),
  ]);
  const withSub = screen.getByText('Dengan Sub').closest('td');
  expect(withSub).toHaveTextContent('USW PRO MAX 48 PoE');
  expect(screen.getByText('USW PRO MAX 48 PoE')).toHaveAttribute('data-testid', 'design-subtitle');
  expect(screen.getAllByTestId('design-subtitle')).toHaveLength(1);
});

test('konfigurasi tidak muat: lencana "Tidak muat" dan tombol Ekspor dinonaktifkan', async () => {
  await renderTable([
    design({ id: 'x', title: 'Meluber', overflow: true }),
    design({ id: 'y', title: 'Muat' }),
  ]);
  expect(screen.getAllByText('Tidak muat')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Ekspor Meluber' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Ekspor Muat' })).toBeEnabled();
});

test('kolom Link dapat diklik (tab baru, aman) tanpa keterangan tambahan di kolom Nama', async () => {
  await renderTable([
    design({
      id: 'p',
      title: 'Dari PDF',
      linkSource: 'pdf',
      documentName: 'm.pdf',
      link: 'https://drive.google.com/file/d/f1/view',
    }),
    design({ id: 'u', title: 'Dari link' }),
  ]);
  const link = screen.getByRole('link', { name: 'Buka link Dari PDF' });
  expect(link).toHaveAttribute('href', 'https://drive.google.com/file/d/f1/view');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  expect(screen.queryByText('Link manual')).toBeNull();
  expect(screen.queryByText('Lihat PDF')).toBeNull();
});

test('kolom Item (jumlah dan nama pertama) dan Versi stiker dengan badge status', async () => {
  await renderTable([
    design({
      id: 'a',
      title: 'Satu',
      items: [
        { id: 'i1', brand: 'PBE', model: 'M5-400' },
        { id: 'i2', brand: 'PBE', model: 'M5-200' },
      ],
      hiddenItemCount: 1,
      stickerVersion: 2,
      stickerStatus: 'active',
    }),
    design({ id: 'b', title: 'Dua', stickerVersion: 1, stickerStatus: 'deprecated' }),
    design({ id: 'c', title: 'Tiga', stickerVersion: 3, stickerStatus: 'inactive' }),
    design({ id: 'd', title: 'Empat' }),
  ]);
  expect(screen.getByRole('columnheader', { name: 'Item' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Versi stiker' })).toBeInTheDocument();
  const rows = screen.getAllByRole('row');
  expect(rows[1]).toHaveTextContent('3 item');
  expect(rows[1]).toHaveTextContent('PBE M5-400');
  expect(rows[1]).toHaveTextContent('v2');
  expect(rows[2]).toHaveTextContent('v1');
  expect(rows[2]).toHaveTextContent('Usang');
  expect(rows[3]).toHaveTextContent('v3');
  expect(rows[3]).toHaveTextContent('Nonaktif');
  expect(rows[4]).toHaveTextContent('Belum ada item');
  expect(rows[4]).toHaveTextContent('—');
});

test('kolom Item: item terhapus bertanda Terhapus dan tanpa hak buka tidak menaut', async () => {
  await renderTable(
    [
      design({
        id: 'a',
        title: 'Satu',
        items: [{ id: 'i1', brand: 'PBE', model: 'M5-400', deleted: true }],
      }),
    ],
    { canOpenItem: true, canOpenDeletedItem: false },
  );
  expect(screen.getByText('Terhapus')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'PBE M5-400' })).toBeNull();
});

test('tampilan Terhapus: hanya aksi Pulihkan, kolom Dihapus oleh/pada', async () => {
  const deleted = design({
    id: 'd',
    title: 'Lama',
    deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
  });
  const { onRestore } = await renderTable([deleted], { deletedView: true });
  expect(screen.getByRole('columnheader', { name: 'Dihapus oleh' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^(Ubah|Ekspor|Hapus|Unduh)/ })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan Lama' }));
  expect(onRestore).toHaveBeenCalledWith(deleted);
});

test('ponsel (360 px): kartu dengan nama sebagai judul; aksi lewat satu tombol menu', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  const { onEdit } = await renderTable([design({ id: 'q1', title: 'Panduan USW' })]);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('link', { name: 'Panduan USW' })).toHaveAttribute('href', '/qrcode/q1');
  // URL panjang disembunyikan di kartu
  expect(screen.queryByRole('link', { name: 'Buka link Panduan USW' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ubah Panduan USW' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /Aksi/ }));
  const menu = await screen.findByRole('menu');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Ubah' }));
  expect(onEdit).toHaveBeenCalledTimes(1);
});

test('Ekspor tampil sebagai tombol ikon + teks (beda dari Unduh yang ikon saja)', async () => {
  await renderTable([design(EXPORTED)], { canEdit: true, canManage: false });
  expect(screen.getByRole('button', { name: 'Ekspor ulang Panduan USW' })).toHaveTextContent(
    'Ekspor ulang',
  );
  expect(screen.getByRole('button', { name: 'Unduh Panduan USW' })).not.toHaveTextContent('Unduh');
});

test('ponsel: Unduh PDF/PNG menjadi grup datar "Unduh" di menu aksi, tanpa menu bersarang', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  const exported = design(EXPORTED);
  const { onDownload } = await renderTable([exported], { canEdit: true });
  await userEvent.click(screen.getByRole('button', { name: /Aksi/ }));
  const menu = await screen.findByRole('menu');
  expect(screen.getAllByRole('menu')).toHaveLength(1);
  expect(within(menu).getByText('Unduh')).toBeInTheDocument();
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'PNG' }));
  expect(onDownload).toHaveBeenCalledWith(exported, 'png');
});
