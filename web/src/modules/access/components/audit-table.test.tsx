import type { AuditEntryDto } from '@shared/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeMe } from '@/test/make-me';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { AuditTable, type AuditTableProps } from './audit-table';

const entry = (patch: Partial<AuditEntryDto> = {}): AuditEntryDto => ({
  id: '1',
  ts: '2026-11-20T03:04:05.000Z',
  actor: 'admin@x.com',
  action: 'user.update',
  target: 'ani@x.com',
  before: null,
  after: null,
  targetRef: { kind: 'user', id: 'u1' },
  ...patch,
});

async function renderTable(props: Partial<AuditTableProps> = {}) {
  const onSelect = vi.fn();
  await renderInRouter(
    <AuditTable
      entries={[entry()]}
      me={makeMe({ permissions: { access: 'view' } })}
      onSelect={onSelect}
      {...props}
    />,
  );
  return { onSelect };
}

test('target bertargetRef menaut ke View entitasnya bila berhak; tanpa checkbox', async () => {
  await renderTable();
  expect(screen.getByRole('link', { name: 'ani@x.com' })).toHaveAttribute(
    'href',
    '/access/users/u1',
  );
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByText('User diubah')).toBeInTheDocument();
  expect(screen.getByText('admin@x.com')).toBeInTheDocument();
});

test('entri lama tanpa targetRef, stiker, atau pengguna tanpa hak: target tampil sebagai teks', async () => {
  await renderTable({
    entries: [
      entry({ id: '1', targetRef: undefined, target: 'lama' }),
      entry({
        id: '2',
        targetRef: { kind: 'sticker', id: 's1' },
        action: 'sticker.update',
        target: 'Stiker A',
      }),
      entry({ id: '3', target: 'tanpa-hak' }),
    ],
    me: makeMe({ permissions: { access: 'none' } }),
  });
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByText('lama')).toBeInTheDocument();
  expect(screen.getByText('Stiker A')).toBeInTheDocument();
  expect(screen.getByText('tanpa-hak')).toBeInTheDocument();
});

test('Lihat detail memanggil onSelect dengan entrinya (tombol ikon berlabel jelas)', async () => {
  const target = entry();
  const { onSelect } = await renderTable({ entries: [target] });
  await userEvent.click(screen.getByRole('button', { name: 'Lihat detail User diubah ani@x.com' }));
  expect(onSelect).toHaveBeenCalledWith(target);
});

test('daftar kosong menampilkan pesan; "Muat lebih banyak" tampil bila masih ada halaman', async () => {
  const onLoadMore = vi.fn();
  await renderTable({ entries: [], hasMore: true, onLoadMore });
  expect(screen.getByText('Belum ada catatan audit.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
  expect(onLoadMore).toHaveBeenCalled();
});

let media: ReturnType<typeof mockMatchMedia>;
beforeEach(() => {
  window.innerWidth = 1024;
});
afterEach(() => {
  media?.restore();
  window.innerWidth = 1024;
});

test('360 px: kartu berjudul target, badge aksi, meta waktu dan pelaku; detail lewat menu "⋯"', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  const { onSelect } = await renderTable();
  expect(screen.queryByRole('table')).toBeNull();
  const card = screen.getByRole('listitem');
  expect(within(card).getByRole('link', { name: 'ani@x.com' })).toBeInTheDocument();
  expect(within(card).getByText('User diubah')).toBeInTheDocument();
  expect(within(card).getByText('Waktu')).toBeInTheDocument();
  expect(within(card).getByText('Pelaku')).toBeInTheDocument();
  await userEvent.click(within(card).getByRole('button', { name: 'Aksi User diubah ani@x.com' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Lihat' }));
  expect(onSelect).toHaveBeenCalled();
});
