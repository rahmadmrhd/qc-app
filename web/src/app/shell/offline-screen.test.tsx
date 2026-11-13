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

test('dengan dua entri: menampilkan jumlahnya aman di perangkat', () => {
  queue(0);
  queue(1);
  render(<OfflineScreen onRetry={vi.fn()} />);
  expect(
    screen.getByText('2 perubahan Anda aman di perangkat dan akan dikirim begitu koneksi kembali.'),
  ).toBeInTheDocument();
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
