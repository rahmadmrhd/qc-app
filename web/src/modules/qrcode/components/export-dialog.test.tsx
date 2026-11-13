import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ExportDialog } from './export-dialog';

const base = {
  id: 'q1',
  title: 'Panduan',
  linkSource: 'url' as const,
  link: 'https://a.co',
  documentId: '',
  documentName: '',
  subtitle: '',
  footer: '',
  logoFileId: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  overflow: false,
  name: '',
  namePlacement: '' as const,
  presetId: '',
  items: [],
  hiddenItemCount: 0,
  stickerVersion: 0,
  stickerStatus: '' as const,
  exportStatus: 'none' as const,
  exportedAt: '',
  exportedBy: '',
  createdAt: 't',
  createdBy: 'a',
  updatedAt: 't',
  updatedBy: 'a',
};

test('ekspor pertama: menyebut hasil dan folder Drive; konfirmasi memanggil onConfirm', async () => {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  render(<ExportDialog design={base} open onOpenChange={vi.fn()} onConfirm={onConfirm} />);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/300 × 420 mm/)).toBeInTheDocument();
  expect(within(dialog).getByText(/QC App QR/)).toBeInTheDocument();
  expect(within(dialog).queryByText(/menimpa/i)).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan ke Drive' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test('ekspor ulang: peringatan menimpa berkas lama dan tombol berbeda', () => {
  const exported = {
    ...base,
    exportStatus: 'current' as const,
    exportedAt: '2026-10-16T04:00:00.000Z',
    exportedBy: 'm@x.com',
  };
  render(<ExportDialog design={exported} open onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
  expect(screen.getByText(/menimpa berkas lama/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Timpa dan simpan' })).toBeInTheDocument();
});

test('galat ekspor ditampilkan dan dialog tetap terbuka', async () => {
  const onOpenChange = vi.fn();
  render(
    <ExportDialog
      design={base}
      open
      onOpenChange={onOpenChange}
      onConfirm={vi.fn().mockRejectedValue(new Error('Isi label melebihi kanvas'))}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Simpan ke Drive' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('melebihi kanvas');
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});

test('ekspor ulang: waktu ekspor ditampilkan terformat (bukan ISO mentah)', () => {
  const exported = {
    ...base,
    exportStatus: 'current' as const,
    exportedAt: '2026-10-16T04:00:00.000Z',
    exportedBy: 'm@x.com',
  };
  render(<ExportDialog design={exported} open onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
  expect(screen.queryByText(/2026-10-16T04:00:00.000Z/)).toBeNull();
  expect(screen.getByText(/m@x.com/)).toBeInTheDocument();
});

test('dialog ekspor menyebut title dan subtitle konfigurasi', () => {
  render(
    <ExportDialog
      design={{ ...base, title: 'Panduan Instalasi', subtitle: 'USW PRO MAX 48 PoE' }}
      open
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText(/"Panduan Instalasi — USW PRO MAX 48 PoE"/)).toBeInTheDocument();
});

test('saat mengekspor, dialog menyebut langkah yang sedang berjalan', async () => {
  const onConfirm = vi.fn((report: (step: string) => void) => {
    report('Mengunggah PDF dan PNG ke Drive, lalu mencatat hasilnya…');
    return new Promise<void>(() => undefined);
  });
  render(<ExportDialog design={base} open onOpenChange={vi.fn()} onConfirm={onConfirm} />);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan ke Drive' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Mengunggah PDF dan PNG ke Drive, lalu mencatat hasilnya…',
  );
});

const stale = {
  ...base,
  name: 'PBE M5-400',
  stickerVersion: 1,
  stickerStatus: 'active' as const,
  exportStatus: 'stale' as const,
  exportedAt: '2026-10-16T04:00:00.000Z',
  exportedBy: 'm@x.com',
};

test('ekspor ulang dengan label berubah: akibat dijelaskan dan alasan wajib (tombol nonaktif tanpa alasan), dikirim ke onConfirm', async () => {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  render(<ExportDialog design={stale} open onOpenChange={vi.fn()} onConfirm={onConfirm} />);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/stiker Manual Book baru \(v2\)/i)).toBeInTheDocument();
  expect(within(dialog).getByText(/usang/i)).toBeInTheDocument();
  const button = within(dialog).getByRole('button', { name: 'Timpa dan simpan' });
  expect(button).toBeDisabled();
  const reason = within(dialog).getByLabelText('Alasan perubahan label');
  expect(reason).toHaveAttribute('maxlength', '500');
  await userEvent.type(reason, '   ');
  expect(button).toBeDisabled();
  await userEvent.type(reason, 'Logo diganti');
  expect(button).toBeEnabled();
  await userEvent.click(button);
  expect(onConfirm).toHaveBeenCalledWith(expect.any(Function), 'Logo diganti');
});

test('ekspor pertama dan ekspor ulang tanpa perubahan label tidak meminta alasan', () => {
  const { unmount } = render(
    <ExportDialog design={base} open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
  );
  expect(screen.queryByLabelText('Alasan perubahan label')).toBeNull();
  unmount();
  render(
    <ExportDialog
      design={{ ...stale, exportStatus: 'current' }}
      open
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText('Alasan perubahan label')).toBeNull();
  expect(screen.getByRole('button', { name: 'Timpa dan simpan' })).toBeEnabled();
});
