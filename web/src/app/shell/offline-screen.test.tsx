import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { OfflineScreen } from './offline-screen';

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
