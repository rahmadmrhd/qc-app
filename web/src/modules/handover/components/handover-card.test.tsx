import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

import { enqueueCheck } from '../lib/check-outbox';
import { HandoverCard } from './handover-card';
import { makeHandover } from './test-handover';

function setup(over: Partial<Parameters<typeof HandoverCard>[0]> = {}, handover = makeHandover()) {
  const handlers = {
    onOpen: vi.fn(),
    onCheck: vi.fn(),
    onMarkDone: vi.fn(),
    onReopen: vi.fn(),
    onEdit: vi.fn(),
    onCancel: vi.fn(),
    onComment: vi.fn().mockResolvedValue(undefined),
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

test('Mark done hanya pada Baru dan Dikerjakan; memanggil onMarkDone', async () => {
  const first = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Mark done' }));
  expect(first.onMarkDone).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Buka kembali' })).not.toBeInTheDocument();
  document.body.innerHTML = '';
  setup({}, makeHandover({ status: 'in_progress' }));
  expect(screen.getByRole('button', { name: 'Mark done' })).toBeEnabled();
});

test('Selesai: tanpa Mark done dan tanpa Buka kembali; More hanya Ubah', async () => {
  setup({}, makeHandover({ status: 'done' }));
  expect(screen.queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Buka kembali' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getByRole('menuitem', { name: 'Ubah' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Batalkan' })).not.toBeInTheDocument();
});

test('Dibatalkan: Buka kembali (handover:manage) menggantikan Mark done; More tidak ada', async () => {
  const { onReopen } = setup({}, makeHandover({ status: 'cancelled' }));
  expect(screen.queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Buka kembali' }));
  expect(onReopen).toHaveBeenCalledTimes(1);
});

test('Dibatalkan tanpa handover:manage tidak menampilkan Buka kembali', () => {
  setup({ canCancel: false }, makeHandover({ status: 'cancelled' }));
  expect(screen.queryByRole('button', { name: 'Buka kembali' })).not.toBeInTheDocument();
});

test('kartu menampilkan komentar (dengan kutipan bila ada) dan komentar umum tanpa seleksi', async () => {
  const comment = (id: string, quote: string, body: string) => ({
    id,
    quote,
    before: '',
    after: '',
    body,
    author: 'qc@qc.local',
    at: '2026-10-15T03:00:00.000Z',
    stale: false,
  });
  const { onComment } = setup(
    {},
    makeHandover({
      comments: [comment('c1', 'A = 1', 'Cek ini'), comment('c2', '', 'Komentar umum')],
    }),
  );
  const list = screen.getByRole('list', { name: 'Komentar' });
  expect(within(list).getByText('Cek ini')).toBeInTheDocument();
  expect(within(list).getByText('Komentar umum')).toBeInTheDocument();
  expect(within(list).getAllByRole('blockquote', { hidden: true }).length).toBeLessThanOrEqual(1);
  await userEvent.click(screen.getByRole('button', { name: 'Tambah komentar' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Komentar' }), 'Baru');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim' }));
  expect(onComment).toHaveBeenCalledWith({ quote: '', before: '', after: '', body: 'Baru' });
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

test('detail hanya dibuka lewat nomor task; badan kartu, centang, dan tombol tidak membukanya', async () => {
  const { onOpen, onCheck } = setup();
  await userEvent.click(screen.getByRole('checkbox', { name: /A = 1/ }));
  expect(onCheck).toHaveBeenCalledWith({ index: 0, text: 'A = 1' }, true);
  await userEvent.click(screen.getByText('PT Maju'));
  await userEvent.click(screen.getByRole('button', { name: 'Mark done' }));
  expect(onOpen).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'ST-20261015-001' }));
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test('task Dibatalkan tetap tampil dengan labelnya', () => {
  setup({}, makeHandover({ status: 'cancelled' }));
  expect(screen.getByText('Dibatalkan')).toBeInTheDocument();
  expect(screen.getByText('Dibatalkan').className).toContain('text-red-800');
});

test('antrean centang di perangkat: kartu papan menampilkan butir tercentang dengan penanda', () => {
  localStorage.clear();
  enqueueCheck('qc@x', {
    taskId: 'h1',
    locationId: 'loc-a',
    index: 0,
    text: 'A = 1',
    checked: true,
    at: Date.now(),
  });
  setup({ owner: 'qc@x' });
  expect(screen.getByRole('checkbox', { name: /A = 1/ })).toBeChecked();
  expect(screen.getByText('Menunggu terkirim')).toBeInTheDocument();
  expect(screen.getByText('1/2')).toBeInTheDocument();
  localStorage.clear();
});
