import type { QrDesignDto } from '@shared/contract';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { hasUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { BULK_EXPORT_MAX, type BulkQrExport } from '../lib/use-bulk-qr-export';
import { BulkExportDialog } from './bulk-export-dialog';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const design = (id: string, patch: Partial<QrDesignDto> = {}): QrDesignDto => ({
  id,
  title: `Judul ${id}`,
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
  name: `MB ${id}`,
  namePlacement: '',
  presetId: '',
  items: [{ id: `it-${id}`, brand: 'PBE', model: `M-${id}` }],
  hiddenItemCount: 0,
  stickerVersion: 0,
  stickerStatus: '',
  exportStatus: 'none',
  exportedAt: '',
  exportedBy: '',
  createdAt: 't',
  createdBy: 'a@x.com',
  updatedAt: 'u',
  updatedBy: 'a@x.com',
  ...patch,
});
const newVersion = (id: string) =>
  design(id, { exportStatus: 'stale', stickerVersion: 1, exportedAt: '2026-11-01T00:00:00.000Z' });

const exporter = (patch: Partial<BulkQrExport> = {}): BulkQrExport => ({
  phase: 'idle',
  running: false,
  rows: [],
  outcome: null,
  cancelling: false,
  start: vi.fn().mockResolvedValue(null),
  cancel: vi.fn(),
  reset: vi.fn(),
  ...patch,
});

beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
  toast.warning.mockReset();
});

function mount(
  designs: QrDesignDto[],
  bulk: BulkQrExport,
  props: { onExported?: () => void } = {},
) {
  const onOpenChange = vi.fn();
  const onExported = props.onExported ?? vi.fn();
  render(
    <BulkExportDialog
      open
      onOpenChange={onOpenChange}
      designs={designs}
      exporter={bulk}
      onExported={onExported}
    />,
  );
  return { onOpenChange, onExported };
}

test('tanpa versi baru: tidak ada kotak alasan dan tombol Ekspor aktif', async () => {
  const bulk = exporter();
  mount([design('a'), design('b')], bulk);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).queryByLabelText(/Alasan perubahan label/)).toBeNull();
  const button = within(dialog).getByRole('button', { name: 'Ekspor 2 konfigurasi' });
  expect(button).toBeEnabled();
  await userEvent.click(button);
  expect(bulk.start).toHaveBeenCalledWith(expect.any(Array), '');
});

test('ada yang melahirkan versi baru: alasan wajib, tombol nonaktif sampai terisi, satu alasan untuk semua', async () => {
  const bulk = exporter({
    start: vi.fn().mockResolvedValue({
      doneIds: ['a', 'b'],
      failedIds: [],
      skippedIds: [],
      waitingIds: [],
      stopped: null,
    }),
  });
  const { onExported } = mount([design('a'), newVersion('b')], bulk);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/1 melahirkan versi Manual Book baru/)).toBeInTheDocument();
  const button = within(dialog).getByRole('button', { name: 'Ekspor 2 konfigurasi' });
  expect(button).toBeDisabled();
  expect(hasUnsavedChanges()).toBe(false);
  await userEvent.type(within(dialog).getByLabelText(/Alasan perubahan label/), 'Logo baru');
  expect(hasUnsavedChanges()).toBe(true);
  expect(button).toBeEnabled();
  await userEvent.click(button);
  expect(bulk.start).toHaveBeenCalledWith(expect.any(Array), 'Logo baru');
  expect(onExported).toHaveBeenCalledWith(['a', 'b']);
  expect(toast.success).toHaveBeenCalledWith('2 konfigurasi diekspor');
});

test('ringkasan memisahkan sudah terbaru dari yang dilewati dan menampilkan alasannya', async () => {
  mount(
    [
      design('a'),
      design('cur', { exportStatus: 'current', stickerVersion: 1, exportedAt: 'x' }),
      design('besar', { overflow: true }),
    ],
    exporter(),
  );
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/1 sudah terbaru \(dilewati\)/)).toBeInTheDocument();
  expect(within(dialog).getByText(/1 dilewati karena belum lengkap/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByText('Lihat yang dilewati'));
  expect(within(dialog).getByText('MB besar')).toBeInTheDocument();
  expect(within(dialog).getByText(/tidak muat di kanvas/)).toBeInTheDocument();
});

test('peringatan timpa bila ada yang sudah pernah diekspor', () => {
  mount([newVersion('a')], exporter());
  expect(screen.getByText(/berkas lama ditimpa/)).toBeInTheDocument();
});

test('tidak ada yang dapat diekspor: tombol nonaktif', () => {
  mount([design('besar', { overflow: true })], exporter());
  expect(screen.getByRole('button', { name: 'Ekspor 0 konfigurasi' })).toBeDisabled();
});

test('melebihi batas per ekspor: pesan dan tombol nonaktif', () => {
  const many = Array.from({ length: BULK_EXPORT_MAX + 1 }, (_, index) => design(`d${index}`));
  mount(many, exporter());
  expect(screen.getByRole('alert')).toHaveTextContent(`paling banyak ${BULK_EXPORT_MAX}`);
  expect(
    screen.getByRole('button', { name: `Ekspor ${BULK_EXPORT_MAX + 1} konfigurasi` }),
  ).toBeDisabled();
});

test('berjalan: status per baris, Berhenti memanggil cancel, dialog tidak dapat ditutup', async () => {
  const bulk = exporter({
    phase: 'running',
    running: true,
    rows: [
      { id: 'a', name: 'MB a', status: 'done', message: 'Selesai' },
      { id: 'b', name: 'MB b', status: 'processing', message: 'Server memproses ekspor (40%)…' },
      { id: 'c', name: 'MB c', status: 'waiting', message: 'Menunggu' },
    ],
  });
  const { onOpenChange } = mount([], bulk);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('status')).toHaveTextContent('Mengekspor 2 dari 3');
  expect(within(dialog).getByText(/Server memproses ekspor \(40%\)/)).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(onOpenChange).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Berhenti setelah yang ini' }));
  expect(bulk.cancel).toHaveBeenCalledTimes(1);
});

test('selesai: ringkasan, daftar yang gagal, dan Tutup mereset lalu menutup', async () => {
  const bulk = exporter({
    phase: 'finished',
    rows: [
      { id: 'a', name: 'MB a', status: 'done', message: 'Selesai' },
      { id: 'b', name: 'MB b', status: 'failed', message: 'Nama sudah dipakai' },
      { id: 'c', name: 'MB c', status: 'waiting', message: 'Belum dikerjakan' },
    ],
    outcome: {
      doneIds: ['a'],
      failedIds: ['b'],
      skippedIds: [],
      waitingIds: ['c'],
      stopped: 'unavailable',
    },
  });
  const { onOpenChange } = mount([], bulk);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/berhasil diekspor/)).toBeInTheDocument();
  expect(within(dialog).getByText('1 gagal')).toBeInTheDocument();
  expect(within(dialog).getByText('1 belum dikerjakan')).toBeInTheDocument();
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Server tidak terjangkau');
  const failedList = within(dialog).getByRole('list', { name: 'Konfigurasi yang gagal' });
  expect(within(failedList).getByText(/Nama sudah dipakai/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tutup' }));
  expect(bulk.reset).toHaveBeenCalledTimes(1);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('toast sebagian bila ada yang gagal', async () => {
  const bulk = exporter({
    start: vi.fn().mockResolvedValue({
      doneIds: ['a'],
      failedIds: ['b'],
      skippedIds: [],
      waitingIds: [],
      stopped: null,
    }),
  });
  mount([design('a'), design('b')], bulk);
  await userEvent.click(screen.getByRole('button', { name: 'Ekspor 2 konfigurasi' }));
  expect(toast.warning).toHaveBeenCalledWith('1 konfigurasi diekspor, 1 belum');
});
