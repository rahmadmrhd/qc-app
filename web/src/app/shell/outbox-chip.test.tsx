import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@/modules/auth/use-me', () => ({
  useMe: () => ({ name: 'Rina', email: 'rina@qc.local' }),
}));

import { makeHandover } from '@/modules/handover/components/test-handover';
import { enqueueCheck } from '@/modules/handover/lib/check-outbox';
import { enqueueOutbox, readOutbox } from '@/modules/handover/lib/outbox';
import {
  beginSending,
  beginSendingEntry,
  resetSendingForTests,
} from '@/modules/handover/lib/outbox-status';
import { handoverKeys } from '@/modules/handover/queries';
import { resetOutboxEnv } from '@/test/outbox-env';
import { OutboxChip } from './outbox-chip';

const OWNER = 'rina@qc.local';
const queue = (index: number, taskId = 'h1') =>
  enqueueCheck(OWNER, {
    taskId,
    locationId: 'loc-a',
    index,
    text: `Butir ${index}`,
    checked: true,
    at: Date.now(),
  });

function renderChip() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <OutboxChip />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

beforeEach(() => {
  resetOutboxEnv();
  resetSendingForTests();
});

test('tidak tampil tanpa entri', async () => {
  renderChip();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('dua entri: teks "2 belum terkirim" dalam elemen role=status', async () => {
  await queue(0);
  await queue(1);
  renderChip();
  expect(screen.getByRole('status').textContent).toContain('2 belum terkirim');
});

test('satu dari dua sedang dikirim: "Mengirim 1 dari 2…"', async () => {
  await queue(0);
  await queue(1);
  beginSending('h1', 1);
  renderChip();
  expect(screen.getByRole('status').textContent).toContain('Mengirim 1 dari 2…');
});

test('berubah mengikuti antrean tanpa muat ulang', async () => {
  renderChip();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  await act(async () => {
    await queue(0);
  });
  expect(screen.getByRole('status').textContent).toContain('1 belum terkirim');
});

test('membuka popover menampilkan nomor task dari cache', async () => {
  await queue(0);
  const { client } = renderChip();
  client.setQueryData(
    handoverKeys.one('h1', ['loc-a']),
    makeHandover({ id: 'h1', number: 'ST-20261113-001' }),
  );
  await userEvent.click(screen.getByRole('button', { name: '1 belum terkirim' }));
  expect(await screen.findByText(/ST-20261113-001/)).toBeInTheDocument();
  expect(screen.getByText(/Centang/)).toBeInTheDocument();
  expect(screen.getByText('Butir 0')).toBeInTheDocument();
});

test('entri untuk task yang tidak ada di cache memakai "Task lain" tanpa galat', async () => {
  await queue(0, 'tidak-ada');
  renderChip();
  await userEvent.click(screen.getByRole('button', { name: '1 belum terkirim' }));
  expect(await screen.findByText(/Task lain/)).toBeInTheDocument();
});

test('label aksesibel lengkap walau teks panjang disembunyikan di layar sempit', async () => {
  await queue(0);
  await queue(1);
  renderChip();
  const button = screen.getByRole('button', { name: '2 belum terkirim' });
  expect(button).toHaveAttribute('aria-label', '2 belum terkirim');
  const long = [...button.querySelectorAll('span')].find((span) =>
    span.className.includes('hidden sm:inline'),
  );
  expect(long?.textContent).toBe('2 belum terkirim');
});

const commentIn = (over: Record<string, unknown> = {}) => ({
  kind: 'comment' as const,
  clientId: '11111111-1111-4111-8111-111111111111',
  taskId: 'h1',
  locationId: 'loc-a',
  quote: '',
  before: '',
  after: '',
  body: 'tolong dicek ulang',
  at: Date.now(),
  ...over,
});
const createIn = () => ({
  kind: 'create' as const,
  locationId: 'loc-a',
  tasks: [{ clientId: '22222222-2222-4222-8222-222222222222', customerName: 'PT Maju', note: 'x' }],
  at: Date.now(),
});

test('hitungan mencakup centang, komentar, dan task baru; popover mencantumkan jenisnya', async () => {
  await queue(0);
  await enqueueOutbox(OWNER, commentIn());
  await enqueueOutbox(OWNER, createIn());
  const { client } = renderChip();
  client.setQueryData(
    handoverKeys.one('h1', ['loc-a']),
    makeHandover({ id: 'h1', number: 'ST-20261113-001' }),
  );
  expect(screen.getByRole('status').textContent).toContain('3 belum terkirim');
  await userEvent.click(screen.getByRole('button', { name: '3 belum terkirim' }));
  expect(await screen.findByText(/^Centang · ST-20261113-001/)).toBeInTheDocument();
  expect(screen.getByText(/^Komentar · ST-20261113-001/)).toBeInTheDocument();
  expect(screen.getByText('tolong dicek ulang')).toBeInTheDocument();
  // Task baru belum bernomor: jenis + waktu saja, nama customer di baris isi.
  const created = screen.getByText(/^Task baru ·/);
  expect(created.textContent).not.toMatch(/ST-|Task lain/);
  expect(screen.getByText('PT Maju')).toBeInTheDocument();
});

test('komentar yang sedang dikirim dihitung sebagai mengirim', async () => {
  await enqueueOutbox(OWNER, commentIn());
  await enqueueOutbox(OWNER, createIn());
  const entries = readOutbox(OWNER);
  beginSendingEntry(entries.find((e) => e.kind === 'comment')?.id ?? '');
  renderChip();
  expect(screen.getByRole('status').textContent).toContain('Mengirim 1 dari 2…');
});
