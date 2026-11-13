import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { enqueueCheck } from '@/modules/handover/lib/check-outbox';
import { OfflineScreen } from './offline-screen';

beforeEach(() => localStorage.clear());

const queue = (index: number) =>
  enqueueCheck('rina@qc.local', {
    taskId: 'h1',
    locationId: 'loc-a',
    index,
    text: `Butir ${index}`,
    checked: true,
    at: Date.now(),
  });

test('tanpa antrean: tidak ada teks perubahan menunggu', () => {
  render(<OfflineScreen onRetry={vi.fn()} />);
  expect(screen.queryByText(/perubahan Anda/)).not.toBeInTheDocument();
});

test('dengan dua entri: menampilkan jumlah perubahan yang menunggu dikirim', () => {
  queue(0);
  queue(1);
  render(<OfflineScreen onRetry={vi.fn()} />);
  expect(
    screen.getByText(
      '2 perubahan menunggu dikirim. Hubungkan ke jaringan, lalu coba lagi agar terkirim.',
    ),
  ).toBeInTheDocument();
});

test('entri lebih dari 24 jam tidak dihitung', () => {
  enqueueCheck('rina@qc.local', {
    taskId: 'h1',
    locationId: 'loc-a',
    index: 0,
    text: 'Lama',
    checked: true,
    at: Date.now() - 25 * 60 * 60 * 1000,
  });
  render(<OfflineScreen onRetry={vi.fn()} />);
  expect(screen.queryByText(/perubahan menunggu dikirim/)).not.toBeInTheDocument();
});

test('menampilkan judul dan teks, tombol "Coba lagi" memanggil onRetry', async () => {
  const onRetry = vi.fn();
  render(<OfflineScreen onRetry={onRetry} />);
  expect(screen.getByText('Tidak ada koneksi')).toBeInTheDocument();
  expect(
    screen.getByText('Server belum bisa dihubungi. Cek koneksi Anda, lalu coba lagi.'),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
