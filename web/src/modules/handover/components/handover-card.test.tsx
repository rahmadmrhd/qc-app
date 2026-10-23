import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

import { HandoverCard } from './handover-card';
import { makeHandover } from './test-handover';

function setup(over: Partial<Parameters<typeof HandoverCard>[0]> = {}, handover = makeHandover()) {
  const handlers = {
    onOpen: vi.fn(),
    onCheck: vi.fn(),
    onToggleDone: vi.fn(),
    onEdit: vi.fn(),
    onCancel: vi.fn(),
  };
  render(
    <HandoverCard
      handover={handover}
      canMarkDone
      canEdit
      canCancel
      pending={false}
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

test('menampilkan seluruh catatan panjang tanpa dipotong', () => {
  const long = Array.from({ length: 40 }, (_, i) => `Baris catatan ke-${i + 1}`).join('\n\n');
  setup({}, makeHandover({ note: long, checklist: [] }));
  expect(screen.getByText('Baris catatan ke-1')).toBeInTheDocument();
  expect(screen.getByText('Baris catatan ke-40')).toBeInTheDocument();
});

test('menampilkan nomor, customer, status, progres, dan jumlah komentar', () => {
  setup(
    {},
    makeHandover({
      status: 'in_progress',
      checklist: [
        {
          index: 0,
          text: 'A = 1',
          checked: true,
          by: 'qc@qc.local',
          at: '2026-10-15T03:00:00.000Z',
        },
        { index: 1, text: 'B = 2', checked: false, by: '', at: '' },
      ],
      comments: [
        {
          id: 'c',
          quote: 'A',
          before: '',
          after: '',
          body: 'x',
          author: 'a',
          at: 't',
          stale: false,
        },
      ],
    }),
  );
  expect(screen.getByText('ST-20261015-001')).toBeInTheDocument();
  expect(screen.getByText('PT Maju')).toBeInTheDocument();
  expect(screen.getByText('Dikerjakan')).toBeInTheDocument();
  expect(screen.getByText('1/2')).toBeInTheDocument();
  expect(screen.getByText('1 komentar')).toBeInTheDocument();
  expect(screen.getByText(/qc@qc\.local/)).toBeInTheDocument();
});

test('Mark done memanggil setDone(true); pada kartu Selesai memanggil setDone(false)', async () => {
  const first = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Mark done' }));
  expect(first.onToggleDone).toHaveBeenCalledWith(true);
  document.body.innerHTML = '';
  const second = setup({}, makeHandover({ status: 'done' }));
  await userEvent.click(screen.getByRole('button', { name: 'Buka kembali' }));
  expect(second.onToggleDone).toHaveBeenCalledWith(false);
});

test('Mark done dan centang dinonaktifkan tanpa qc:edit', () => {
  setup({ canMarkDone: false });
  expect(screen.getByRole('button', { name: 'Mark done' })).toBeDisabled();
  for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
});

test('More tidak dirender untuk pengguna yang hanya QC', () => {
  setup({ canEdit: false, canCancel: false });
  expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
});

test('More berisi Ubah dan Batalkan sesuai izin; Batalkan meminta konfirmasi', async () => {
  const { onEdit, onCancel } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getByRole('menuitem', { name: 'Ubah' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: /Hapus/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Batalkan' }));
  expect(onCancel).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batalkan task' }));
  expect(onCancel).toHaveBeenCalled();
  expect(onEdit).not.toHaveBeenCalled();
});

test('More hanya dengan Ubah bila tidak boleh membatalkan', async () => {
  const { onEdit } = setup({ canCancel: false });
  await userEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.queryByRole('menuitem', { name: 'Batalkan' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Ubah' }));
  expect(onEdit).toHaveBeenCalled();
});

test('klik centang tidak membuka detail; klik badan membuka detail', async () => {
  const { onOpen, onCheck } = setup();
  await userEvent.click(screen.getByRole('checkbox', { name: /A = 1/ }));
  expect(onCheck).toHaveBeenCalledWith({ index: 0, text: 'A = 1' }, true);
  expect(onOpen).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText('PT Maju'));
  expect(onOpen).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Mark done' }));
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test('task Dibatalkan: tanpa More dan tanpa aksi, tetap tampil', () => {
  setup({}, makeHandover({ status: 'cancelled' }));
  expect(screen.getByText('Dibatalkan')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mark done' })).toBeDisabled();
});
