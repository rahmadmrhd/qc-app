import type { ActivityPageDto } from '@shared/contract';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { ActivityLog, showsIncompleteNote } from './activity-log';

const page = (
  over: Partial<ActivityPageDto> & Pick<ActivityPageDto, 'entries'>,
): ActivityPageDto => ({
  nextCursor: null,
  hasMore: false,
  ...over,
});

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  ts: '2026-11-21T03:00:00.000Z',
  actor: 'budi@x.com',
  action: 'item.update',
  ...over,
});

beforeEach(() => {
  apiMock.mockReset();
});

test('memuat 10 entri per halaman lewat activity.list dengan kind dan id record', async () => {
  apiMock.mockResolvedValue(page({ entries: [entry('1')] }));
  await renderInRouter(<ActivityLog kind="item" id="i1" />);
  await screen.findByText('Item diubah');
  expect(apiMock).toHaveBeenCalledWith('activity.list', { kind: 'item', id: 'i1', limit: 10 });
});

test('entri menampilkan aksi berlabel, pelaku, waktu, dan nama field tanpa nilai', async () => {
  apiMock.mockResolvedValue(
    page({ entries: [entry('1', { changedFields: ['name', 'status', 'kunciBaru'] })] }),
  );
  await renderInRouter(<ActivityLog kind="brand" id="b1" />);
  expect(await screen.findByText('Item diubah')).toBeInTheDocument();
  expect(screen.getByText(/budi@x\.com/)).toBeInTheDocument();
  expect(screen.getByText(/21 Nov 2026/)).toBeInTheDocument();
  // Nama field berlabel; kunci tak dikenal tampil apa adanya.
  expect(screen.getByText('Yang berubah: Nama, Status, kunciBaru')).toBeInTheDocument();
});

test('Muat lebih banyak mengambil halaman berikutnya dengan kursor dan menyambungkannya', async () => {
  apiMock.mockImplementation((_id: string, input: { cursor?: string }) =>
    Promise.resolve(
      input.cursor
        ? page({ entries: [entry('2', { action: 'item.create' })] })
        : page({ entries: [entry('1')], nextCursor: 'c1', hasMore: true }),
    ),
  );
  await renderInRouter(<ActivityLog kind="item" id="i1" />);
  await screen.findByText('Item diubah');
  // Catatan riwayat lama baru tampil di ujung daftar.
  expect(screen.queryByText(/tidak lengkap/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
  expect(await screen.findByText('Item dibuat')).toBeInTheDocument();
  expect(apiMock).toHaveBeenLastCalledWith('activity.list', {
    kind: 'item',
    id: 'i1',
    limit: 10,
    cursor: 'c1',
  });
  expect(screen.getByText('Item diubah')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).not.toBeInTheDocument();
  expect(screen.getByText('Riwayat sebelum 20 Nov 2026 tidak lengkap.')).toBeInTheDocument();
});

test('kosong: keterangan belum ada aktivitas dan catatan riwayat lama', async () => {
  apiMock.mockResolvedValue(page({ entries: [] }));
  await renderInRouter(<ActivityLog kind="role" id="r1" />);
  expect(await screen.findByText('Belum ada aktivitas tercatat.')).toBeInTheDocument();
  expect(screen.getByText('Riwayat sebelum 20 Nov 2026 tidak lengkap.')).toBeInTheDocument();
});

test('galat awal: pesan dan Coba lagi memuat ulang', async () => {
  apiMock.mockRejectedValueOnce(new ApiError('INTERNAL', 'Gagal memuat', 'req-1'));
  apiMock.mockResolvedValue(page({ entries: [entry('1')] }));
  await renderInRouter(<ActivityLog kind="item" id="i1" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat');
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  await waitFor(() => expect(screen.getByText('Item diubah')).toBeInTheDocument());
});

test('catatan riwayat lama tak tampil untuk record yang dibuat sejak 20 Nov 2026', async () => {
  apiMock.mockResolvedValue(page({ entries: [entry('1')] }));
  await renderInRouter(<ActivityLog kind="item" id="i1" createdAt="2026-11-21T01:00:00.000Z" />);
  await screen.findByText('Item diubah');
  expect(screen.queryByText(/tidak lengkap/)).not.toBeInTheDocument();
});

test('showsIncompleteNote: tanpa atau sebelum 20 Nov 2026 WIB tampil, sesudahnya tidak', () => {
  expect(showsIncompleteNote(undefined)).toBe(true);
  expect(showsIncompleteNote(null)).toBe(true);
  expect(showsIncompleteNote('bukan tanggal')).toBe(true);
  expect(showsIncompleteNote('2026-11-19T16:59:59.000Z')).toBe(true);
  expect(showsIncompleteNote('2026-11-19T17:00:00.000Z')).toBe(false);
  expect(showsIncompleteNote('2026-11-30T00:00:00.000Z')).toBe(false);
});
