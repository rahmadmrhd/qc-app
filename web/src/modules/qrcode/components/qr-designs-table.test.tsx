import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import type { QrDesignDto } from '@shared/rpc';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { QrDesignsTable } from './qr-designs-table';

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
});

test('status ekspor: Belum, Sudah (tanggal dan pelaku), Berubah sejak ekspor', () => {
  render(
    <QrDesignsTable
      designs={[
        design({ id: 'a', title: 'Belum' }),
        design({
          id: 'b',
          title: 'Sudah',
          exportStatus: 'current',
          exportedAt: '2026-10-16T04:00:00.000Z',
          exportedBy: 'm@x.com',
        }),
        design({
          id: 'c',
          title: 'Berubah',
          exportStatus: 'stale',
          exportedAt: '2026-10-16T04:00:00.000Z',
          exportedBy: 'm@x.com',
        }),
      ]}
      canEdit
      canManage
      busyId={null}
      {...handlers()}
    />,
  );
  expect(screen.getByText('Belum diekspor')).toBeInTheDocument();
  expect(screen.getByText('Sudah diekspor')).toBeInTheDocument();
  expect(screen.getByText('Berubah sejak ekspor')).toBeInTheDocument();
  expect(screen.getAllByText(/m@x/)).toHaveLength(2);
});

test('aksi menurut izin: view tidak melihat Ubah/Ekspor/Hapus; Unduh hanya bila sudah pernah diekspor', async () => {
  const h = handlers();
  const exported = design({
    exportStatus: 'current',
    exportedAt: '2026-10-16T04:00:00.000Z',
    exportedBy: 'm@x.com',
  });
  const { rerender } = render(
    <QrDesignsTable designs={[exported]} canEdit={false} canManage={false} busyId={null} {...h} />,
  );
  expect(screen.queryByRole('button', { name: /Ubah|Ekspor|Hapus/ })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Unduh PDF' }));
  expect(h.onDownload).toHaveBeenCalledWith(exported, 'pdf');
  await userEvent.click(screen.getByRole('button', { name: 'Unduh PNG' }));
  expect(h.onDownload).toHaveBeenCalledWith(exported, 'png');
  // izin edit: ubah dan ekspor; hapus butuh izin kelola
  rerender(<QrDesignsTable designs={[design()]} canEdit canManage={false} busyId={null} {...h} />);
  expect(screen.queryByRole('button', { name: /Unduh/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Ubah Panduan USW' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Duplikat/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Ekspor Panduan USW' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Hapus/ })).toBeNull();
});

test('manage: Ekspor (Ekspor ulang bila sudah pernah) dan Hapus memanggil handler', async () => {
  const h = handlers();
  const first = design();
  const again = design({
    id: 'z',
    title: 'Lama',
    exportStatus: 'current',
    exportedAt: '2026-10-16T04:00:00.000Z',
    exportedBy: 'm@x.com',
  });
  render(<QrDesignsTable designs={[first, again]} canEdit canManage busyId={null} {...h} />);
  await userEvent.click(screen.getByRole('button', { name: 'Ekspor Panduan USW' }));
  expect(h.onExport).toHaveBeenCalledWith(first);
  await userEvent.click(screen.getByRole('button', { name: 'Ekspor ulang Lama' }));
  expect(h.onExport).toHaveBeenCalledWith(again);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Lama' }));
  expect(h.onDelete).toHaveBeenCalledWith(again);
});

test('kosong: ajakan membuat konfigurasi pertama', () => {
  render(<QrDesignsTable designs={[]} canEdit canManage busyId={null} {...handlers()} />);
  expect(screen.getByText(/Belum ada konfigurasi/)).toBeInTheDocument();
});

test('subtitle tampil di bawah title; tanpa subtitle tidak ada baris kosong', () => {
  render(
    <QrDesignsTable
      designs={[
        design({ id: 'a', title: 'Dengan Sub', subtitle: 'USW PRO MAX 48 PoE' }),
        design({ id: 'b', title: 'Tanpa Sub', subtitle: '' }),
      ]}
      canEdit
      canManage
      busyId={null}
      {...handlers()}
    />,
  );
  const withSub = screen.getByText('Dengan Sub').closest('td');
  expect(withSub).toHaveTextContent('USW PRO MAX 48 PoE');
  expect(screen.getByText('USW PRO MAX 48 PoE')).toHaveAttribute('data-testid', 'design-subtitle');
  expect(screen.getAllByTestId('design-subtitle')).toHaveLength(1);
});

test('konfigurasi tidak muat: lencana "Tidak muat" dan tombol Ekspor dinonaktifkan dengan penjelasan', () => {
  render(
    <QrDesignsTable
      designs={[
        design({ id: 'x', title: 'Meluber', overflow: true }),
        design({ id: 'y', title: 'Muat' }),
      ]}
      canEdit
      canManage
      busyId={null}
      {...handlers()}
    />,
  );
  expect(screen.getAllByText('Tidak muat')).toHaveLength(1);
  const blocked = screen.getByRole('button', { name: 'Ekspor Meluber' });
  expect(blocked).toBeDisabled();
  expect(blocked).toHaveAttribute('title', expect.stringContaining('tidak muat'));
  expect(screen.getByRole('button', { name: 'Ekspor Muat' })).toBeEnabled();
});

test('kolom Link dapat diklik (tab baru, aman); tanpa keterangan tambahan "PDF · Lihat PDF" / "Link manual" di kolom Title', () => {
  render(
    <QrDesignsTable
      designs={[
        design({
          id: 'p',
          title: 'Dari PDF',
          linkSource: 'pdf',
          documentName: 'm.pdf',
          link: 'https://drive.google.com/file/d/f1/view',
        }),
        design({ id: 'u', title: 'Dari link' }),
      ]}
      canEdit
      canManage
      busyId={null}
      {...handlers()}
    />,
  );
  const link = screen.getByRole('link', { name: 'Buka link Dari PDF' });
  expect(link).toHaveAttribute('href', 'https://drive.google.com/file/d/f1/view');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  expect(link).toHaveTextContent('https://drive.google.com/file/d/f1/view');
  expect(screen.getAllByRole('link')).toHaveLength(2); // satu per baris
  expect(screen.queryByText('Link manual')).toBeNull();
  expect(screen.queryByText('Lihat PDF')).toBeNull();
});
