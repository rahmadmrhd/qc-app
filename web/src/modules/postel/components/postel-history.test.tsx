import type { AuditEntryDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { PostelHistory } from './postel-history';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

const entry = (over: Partial<AuditEntryDto>): AuditEntryDto => ({
  id: '1',
  ts: '2026-11-10T03:00:00.000Z',
  actor: 'a@x.com',
  action: 'postel.update',
  target: 'postel:p1',
  before: null,
  after: null,
  ...over,
});

const snap = (numbers: string[], over: Record<string, unknown> = {}) => ({
  note: '',
  numbers,
  items: 2,
  attachments: 0,
  ...over,
});

function renderHistory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PostelHistory id="p1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
});

test('memuat 20 entri terbaru lewat postels.history', async () => {
  apiMock.mockResolvedValue({ entries: [], nextCursor: null });
  renderHistory();
  await screen.findByText('Belum ada riwayat.');
  expect(apiMock).toHaveBeenCalledWith('postels.history', { id: 'p1', limit: 20 });
});

test('Dibuat dan Dihapus', async () => {
  apiMock.mockResolvedValue({
    entries: [
      entry({ id: '3', action: 'postel.delete', before: snap(['A | 2026-12-01 | ']) }),
      entry({ id: '1', action: 'postel.create', after: snap(['A | 2026-12-01 | ']) }),
    ],
    nextCursor: null,
  });
  renderHistory();
  const items = await screen.findAllByRole('listitem');
  expect(items[0]).toHaveTextContent('Dihapus');
  expect(items[1]).toHaveTextContent('Dibuat');
  expect(items[1]).toHaveTextContent('a@x.com');
});

test('perpanjangan tanpa ganti nomor menampilkan tanggal habis lama dan baru', async () => {
  apiMock.mockResolvedValue({
    entries: [
      entry({
        before: snap(['AB-1 | 2026-12-01 | ']),
        after: snap(['AB-1 | 2027-12-01 | ']),
      }),
    ],
    nextCursor: null,
  });
  renderHistory();
  const item = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
  expect(item).toHaveTextContent('Diubah');
  expect(item).toHaveTextContent('AB-1');
  expect(item).toHaveTextContent(/1 Des(?:ember)? 2026/);
  expect(item).toHaveTextContent(/1 Des(?:ember)? 2027/);
});

test('nomor baru ditambah dan nomor lama dihapus', async () => {
  apiMock.mockResolvedValue({
    entries: [
      entry({
        before: snap(['OLD | 2026-12-01 | ', 'AB-1 | 2026-12-01 | ']),
        after: snap(['AB-1 | 2026-12-01 | ', 'AB-2 | 2027-12-01 | ']),
      }),
    ],
    nextCursor: null,
  });
  renderHistory();
  const item = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
  expect(item).toHaveTextContent('Nomor ditambah: AB-2');
  expect(item).toHaveTextContent('Nomor dihapus: OLD');
});

test('nomor yang diganti (koreksi) tampil lama menjadi baru', async () => {
  apiMock.mockResolvedValue({
    entries: [
      entry({
        before: snap(['AB-1 | 2026-12-01 | ']),
        after: snap(['AB-7 | 2026-12-01 | ']),
      }),
    ],
    nextCursor: null,
  });
  renderHistory();
  const item = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
  expect(item).toHaveTextContent('Nomor: AB-1 → AB-7');
});

test('tautan, catatan, jumlah item dan lampiran berubah', async () => {
  apiMock.mockResolvedValue({
    entries: [
      entry({
        before: snap(['AB-1 | 2026-12-01 | '], { note: 'a' }),
        after: snap(['AB-1 | 2026-12-01 | https://x.example'], {
          note: 'b',
          items: 4,
          attachments: 1,
        }),
      }),
    ],
    nextCursor: null,
  });
  renderHistory();
  const item = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
  expect(item).toHaveTextContent('Tautan AB-1 diubah');
  expect(item).toHaveTextContent('Catatan diubah');
  expect(item).toHaveTextContent('Item: 2 → 4');
  expect(item).toHaveTextContent('Lampiran: 0 → 1');
});

test('snapshot tak terduga tidak merusak tampilan', async () => {
  apiMock.mockResolvedValue({
    entries: [entry({ before: { numbers: 'rusak' }, after: { numbers: [1, 2] } })],
    nextCursor: null,
  });
  renderHistory();
  expect((await screen.findAllByRole('listitem'))[0]).toHaveTextContent('Diubah');
});

test('galat memuat riwayat', async () => {
  apiMock.mockImplementation(() => Promise.reject(new Error('x')));
  renderHistory();
  expect(await screen.findByRole('alert')).toHaveTextContent('Riwayat tidak dapat dimuat.');
});

test('bila ada halaman berikutnya, keterangan batas ditampilkan', async () => {
  apiMock.mockResolvedValue({ entries: [entry({})], nextCursor: 'c' });
  renderHistory();
  expect(await screen.findByText(/20 perubahan terbaru/)).toBeInTheDocument();
});
