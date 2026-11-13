import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

import { enqueueCheck } from '../lib/check-outbox';
import { HandoverDetailView } from './handover-detail-view';
import { makeHandover } from './test-handover';

function setup(
  over: Partial<Parameters<typeof HandoverDetailView>[0]> = {},
  handover = makeHandover(),
) {
  const handlers = {
    onBack: vi.fn(),
    onEdit: vi.fn(),
    onCancel: vi.fn(),
    onMarkDone: vi.fn(),
    onReopen: vi.fn(),
    onCheck: vi.fn(),
    onComment: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <HandoverDetailView
      handover={handover}
      locationName="Lokasi A"
      canEdit
      canCancel
      canProgress
      pending={false}
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

test('menampilkan nomor, status, lokasi, customer, progres, dan riwayat', () => {
  setup({}, makeHandover({ status: 'in_progress' }));
  expect(screen.getByRole('heading', { level: 1, name: /ST-20261015-001/ })).toBeInTheDocument();
  expect(screen.getByText('Dikerjakan')).toBeInTheDocument();
  expect(screen.getByText('Lokasi A')).toBeInTheDocument();
  expect(screen.getByText('PT Maju')).toBeInTheDocument();
  expect(screen.getByText('0/2')).toBeInTheDocument();
  expect(screen.getByText('Dibuat')).toBeInTheDocument();
});

test('QC: centang dan Mark done aktif; tanpa qc:edit nonaktif', async () => {
  const h = setup();
  await userEvent.click(screen.getByRole('checkbox', { name: /B = 2/ }));
  expect(h.onCheck).toHaveBeenCalledWith({ index: 1, text: 'B = 2' }, true);
  await userEvent.click(screen.getByRole('button', { name: 'Mark done' }));
  expect(h.onMarkDone).toHaveBeenCalledTimes(1);
  document.body.innerHTML = '';
  setup({ canProgress: false });
  expect(screen.getByRole('button', { name: 'Mark done' })).toBeDisabled();
});

test('Ubah dan Batalkan sesuai izin; Batalkan meminta konfirmasi', async () => {
  const h = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  expect(h.onEdit).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Batalkan task' }));
  expect(h.onCancel).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batalkan task' }));
  expect(h.onCancel).toHaveBeenCalled();
});

test('tanpa izin WH tidak ada Ubah/Batalkan; tidak ada aksi Hapus', () => {
  setup({ canEdit: false, canCancel: false });
  expect(screen.queryByRole('button', { name: 'Ubah' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Batalkan task' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Hapus/ })).not.toBeInTheDocument();
});

test('Selesai: tanpa Mark done dan Buka kembali', () => {
  setup({}, makeHandover({ status: 'done' }));
  expect(screen.queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Buka kembali' })).not.toBeInTheDocument();
});

test('Dibatalkan: Buka kembali memanggil onReopen (hanya dengan handover:manage)', async () => {
  const h = setup({}, makeHandover({ status: 'cancelled' }));
  await userEvent.click(screen.getByRole('button', { name: 'Buka kembali' }));
  expect(h.onReopen).toHaveBeenCalledTimes(1);
  document.body.innerHTML = '';
  setup({ canCancel: false }, makeHandover({ status: 'cancelled' }));
  expect(screen.queryByRole('button', { name: 'Buka kembali' })).not.toBeInTheDocument();
});

test('komentar umum tanpa seleksi lewat tombol Tambah komentar (kutipan kosong)', async () => {
  const h = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah komentar' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Komentar' }), 'Umum');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim' }));
  expect(h.onComment).toHaveBeenCalledWith({ quote: '', before: '', after: '', body: 'Umum' });
});

test('task Dibatalkan: tanpa Ubah, Batalkan, dan centang aktif', () => {
  setup({}, makeHandover({ status: 'cancelled' }));
  expect(screen.queryByRole('button', { name: 'Ubah' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Batalkan task' })).not.toBeInTheDocument();
  for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
});

test('komentar tampil dengan kutipan, isi, dan label usang', () => {
  setup(
    {},
    makeHandover({
      comments: [
        {
          id: 'c1',
          quote: 'A = 1',
          before: '',
          after: '',
          body: 'Mohon cek',
          author: 'viewer@qc.local',
          at: '2026-10-15T03:00:00.000Z',
          stale: true,
        },
      ],
    }),
  );
  expect(screen.getByText('Mohon cek')).toBeInTheDocument();
  expect(screen.getByText('usang')).toBeInTheDocument();
});

test('antrean centang di perangkat: butir tampil tercentang dengan penanda walau DTO belum memuatnya', () => {
  localStorage.clear();
  enqueueCheck('qc@x', {
    taskId: 'h1',
    locationId: 'loc-a',
    index: 1,
    text: 'B = 2',
    checked: true,
    at: Date.now(),
  });
  setup({ owner: 'qc@x' });
  expect(screen.getByRole('checkbox', { name: /B = 2/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /A = 1/ })).not.toBeChecked();
  expect(screen.getByText('Belum terkirim')).toBeInTheDocument();
  localStorage.clear();
});
