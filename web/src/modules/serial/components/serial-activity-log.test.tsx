import type { SerialEventDto, SerialHistoryOutput } from '@shared/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { onFormTabRequest } from '@/lib/form-tab-request';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { SERIAL_ACTIVITY_LIMIT, SerialActivityLog } from './serial-activity-log';

const event = (seq: number, over: Partial<SerialEventDto> = {}): SerialEventDto => ({
  id: `e${seq}`,
  caseId: null,
  seq,
  type: 'note',
  occurredOn: '2026-11-10',
  createdAt: '2026-11-10T03:00:00.000Z',
  actorName: 'Budi',
  actorTeam: 'qc',
  message: '',
  changes: [],
  data: {},
  proofPhotos: [],
  ...over,
});

const history = (events: SerialEventDto[]): SerialHistoryOutput => ({
  events,
  nextCursor: null,
  counts: { all: events.length, checks: 0, changes: 0, byCase: {} },
});

beforeEach(() => {
  apiMock.mockReset();
});

test('menampilkan paling banyak 10 kejadian terbaru dengan input yang sama dengan tab Riwayat', async () => {
  const events = Array.from({ length: 14 }, (_, index) => event(14 - index));
  apiMock.mockResolvedValue(history(events));
  await renderInRouter(<SerialActivityLog serialId="s1" />);
  const panel = await screen.findByRole('region', { name: 'Aktivitas' });
  expect(await within(panel).findAllByText(/Budi \(QC\)/)).toHaveLength(SERIAL_ACTIVITY_LIMIT);
  // Kunci query = kunci TimelineTabs tab Semua: input tanpa `limit` agar data dipakai bersama.
  expect(apiMock).toHaveBeenCalledWith('serials.history', { id: 's1', group: 'all' });
});

test('judul memakai label jenis dan kirim/terima menurut leg', async () => {
  apiMock.mockResolvedValue(
    history([
      event(2, { type: 'send', data: { leg: 'to_service' } }),
      event(1, { type: 'recorded' }),
    ]),
  );
  await renderInRouter(<SerialActivityLog serialId="s1" />);
  expect(await screen.findByText('Dicatat')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
});

test('Lihat riwayat lengkap meminta tab Riwayat dibuka', async () => {
  apiMock.mockResolvedValue(history([event(1)]));
  const requested = vi.fn(() => true);
  const off = onFormTabRequest(requested);
  await renderInRouter(<SerialActivityLog serialId="s1" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Lihat riwayat lengkap' }));
  expect(requested).toHaveBeenCalledWith('riwayat');
  off();
});

test('kosong dan galat', async () => {
  apiMock.mockResolvedValueOnce(history([]));
  const view = await renderInRouter(<SerialActivityLog serialId="s1" />);
  expect(await screen.findByText('Belum ada aktivitas tercatat.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Lihat riwayat lengkap' })).toBeNull();
  view.unmount();
  apiMock.mockRejectedValueOnce(new ApiError('INTERNAL', 'Gagal memuat', 'req-1'));
  await renderInRouter(<SerialActivityLog serialId="s2" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat');
  expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
});
