import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { enqueueCheck } from '@/modules/handover/lib/check-outbox';
import { readOutbox, removeOutboxEntries } from '@/modules/handover/lib/outbox';
import { resetOutboxEnv } from '@/test/outbox-env';
import { LogoutConfirmDialog } from './logout-confirm-dialog';

const queue = (index: number) =>
  enqueueCheck('a@x.com', {
    taskId: 'h1',
    locationId: 'loc-a',
    index,
    text: `Butir ${index}`,
    checked: true,
    at: Date.now(),
  });

beforeEach(() => resetOutboxEnv());

async function setup(count = 3) {
  for (let i = 0; i < count; i++) await queue(i);
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<LogoutConfirmDialog onConfirm={onConfirm} onCancel={onCancel} />);
  return { onConfirm, onCancel };
}

test('menampilkan judul dan jumlah perubahan belum terkirim', async () => {
  await setup(3);
  expect(screen.getByText('Keluar sekarang?')).toBeInTheDocument();
  expect(screen.getByText(/3 perubahan belum terkirim/)).toBeInTheDocument();
});

test('angka hidup: naik saat entri baru, dan menjadi pesan aman saat antrean kosong', async () => {
  await setup(2);
  expect(screen.getByText(/2 perubahan belum terkirim/)).toBeInTheDocument();
  await act(async () => {
    await queue(5);
  });
  expect(screen.getByText(/3 perubahan belum terkirim/)).toBeInTheDocument();
  await act(async () => {
    await removeOutboxEntries(
      'a@x.com',
      readOutbox('a@x.com').map((e) => e.id),
    );
  });
  expect(
    screen.getByText('Semua perubahan sudah terkirim. Aman untuk keluar.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Batal' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tetap keluar' })).toBeInTheDocument();
});

test('Batal memanggil onCancel, bukan onConfirm', async () => {
  const { onConfirm, onCancel } = await setup();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

test('Tetap keluar memanggil onConfirm tepat sekali dan bukan onCancel', async () => {
  const { onConfirm, onCancel } = await setup();
  await userEvent.click(screen.getByRole('button', { name: 'Tetap keluar' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
});

test('Esc menutup sebagai batal', async () => {
  const { onConfirm, onCancel } = await setup();
  await userEvent.keyboard('{Escape}');
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});
