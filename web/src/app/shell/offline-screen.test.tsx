import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { enqueueCheck } from '@/modules/handover/lib/check-outbox';
import { enqueueOutbox } from '@/modules/handover/lib/outbox';
import { resetOutboxEnv } from '@/test/outbox-env';
import { OfflineScreen } from './offline-screen';

beforeEach(() => resetOutboxEnv());

const queue = (index: number) =>
  enqueueCheck('rina@qc.local', {
    taskId: 'h1',
    locationId: 'loc-a',
    index,
    text: `Butir ${index}`,
    checked: true,
    at: Date.now(),
  });

test('tanpa antrean: tidak ada teks perubahan menunggu', async () => {
  render(<OfflineScreen onRetry={vi.fn()} />);
  expect(screen.queryByText(/perubahan menunggu dikirim/)).not.toBeInTheDocument();
});

test('dengan dua entri: menampilkan jumlah perubahan yang menunggu dikirim', async () => {
  await queue(0);
  await queue(1);
  render(<OfflineScreen onRetry={vi.fn()} />);
  expect(
    screen.getByText(
      '2 perubahan menunggu dikirim. Hubungkan ke jaringan, lalu coba lagi agar terkirim.',
    ),
  ).toBeInTheDocument();
});

test('entri lebih dari 24 jam tidak dihitung', async () => {
  await enqueueCheck('rina@qc.local', {
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

test('hitungan antrean mencakup komentar dan task baru dari semua pemilik', async () => {
  await queue(0);
  await enqueueOutbox('rina@qc.local', {
    kind: 'comment',
    clientId: '11111111-1111-4111-8111-111111111111',
    taskId: 'h1',
    locationId: 'loc-a',
    quote: '',
    before: '',
    after: '',
    body: 'halo',
    at: Date.now(),
  });
  await enqueueOutbox('lain@qc.local', {
    kind: 'create',
    locationId: 'loc-a',
    tasks: [{ clientId: '22222222-2222-4222-8222-222222222222', customerName: 'PT A', note: 'x' }],
    at: Date.now(),
  });
  render(<OfflineScreen onRetry={vi.fn()} />);
  expect(screen.getByText(/^3 perubahan menunggu dikirim/)).toBeInTheDocument();
});
