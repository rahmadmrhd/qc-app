import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

// Panel aktivitas (aside) memuat `activity.list`; di sini kosong, yang diuji hanya tampilan View.
const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { clickMoreAction, hasNoMoreActions, moreActionNames } from '@/test/more-actions';
import { resetOutboxEnv } from '@/test/outbox-env';
import { enqueueCheck } from '../lib/check-outbox';
import { enqueueOutbox } from '../lib/outbox';
import { HandoverDetailView } from './handover-detail-view';
import { makeHandover } from './test-handover';

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue({ entries: [], nextCursor: null, hasMore: false });
});

function setup(
  over: Partial<Parameters<typeof HandoverDetailView>[0]> = {},
  handover = makeHandover(),
) {
  const handlers = {
    onEdit: vi.fn(),
    onCancel: vi.fn(),
    onMarkDone: vi.fn(),
    onReopen: vi.fn(),
    onCheck: vi.fn(),
    onComment: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <HandoverDetailView
        handover={handover}
        locationName="Lokasi A"
        canEdit
        canCancel
        canProgress
        pending={false}
        {...handlers}
        {...over}
      />
    </QueryClientProvider>,
  );
  return handlers;
}

test('menampilkan nomor, status, lokasi, customer, progres, dan riwayat', () => {
  setup({}, makeHandover({ status: 'in_progress' }));
  expect(screen.getByRole('heading', { level: 1, name: /ST-20261015-001/ })).toBeInTheDocument();
  expect(screen.getByText('Dikerjakan')).toBeInTheDocument();
  expect(screen.getByText('Lokasi A')).toBeInTheDocument();
  expect(screen.getByText('PT Maju')).toBeInTheDocument();
  expect(screen.getByText('0/2')).toBeInTheDocument();
  expect(screen.getByText('Dibuat')).toBeInTheDocument();
});

test('QC: centang dan Mark done aktif; tanpa qc:edit nonaktif', async () => {
  const h = setup();
  await userEvent.click(screen.getByRole('checkbox', { name: /B = 2/ }));
  expect(h.onCheck).toHaveBeenCalledWith({ index: 1, text: 'B = 2' }, true);
  await userEvent.click(screen.getByRole('button', { name: 'Mark done' }));
  expect(h.onMarkDone).toHaveBeenCalledTimes(1);
  document.body.innerHTML = '';
  setup({ canProgress: false });
  expect(screen.getByRole('button', { name: 'Mark done' })).toBeDisabled();
});

test('Ubah dan Batalkan sesuai izin; Batalkan meminta konfirmasi', async () => {
  const h = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  expect(h.onEdit).toHaveBeenCalled();
  // Batalkan task bukan aksi utama: tak tampil sebagai tombol, hanya di menu "Aksi lainnya".
  expect(screen.queryByRole('button', { name: 'Batalkan task' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mark done' })).toBeInTheDocument();
  expect(await moreActionNames()).toEqual(['Batalkan task']);
  await clickMoreAction('Batalkan task');
  expect(h.onCancel).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batalkan task' }));
  expect(h.onCancel).toHaveBeenCalled();
});

test('tanpa izin WH tidak ada Ubah/Batalkan; tidak ada aksi Hapus', () => {
  setup({ canEdit: false, canCancel: false });
  expect(screen.queryByRole('button', { name: 'Ubah' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Batalkan task' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Hapus/ })).not.toBeInTheDocument();
});

test('Selesai: tanpa Mark done dan Buka kembali', () => {
  setup({}, makeHandover({ status: 'done' }));
  expect(screen.queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Buka kembali' })).not.toBeInTheDocument();
});

test('Dibatalkan: Buka kembali memanggil onReopen (hanya dengan handover:manage)', async () => {
  const h = setup({}, makeHandover({ status: 'cancelled' }));
  await userEvent.click(screen.getByRole('button', { name: 'Buka kembali' }));
  expect(h.onReopen).toHaveBeenCalledTimes(1);
  expect(hasNoMoreActions()).toBe(true);
  document.body.innerHTML = '';
  setup({ canCancel: false }, makeHandover({ status: 'cancelled' }));
  expect(screen.queryByRole('button', { name: 'Buka kembali' })).not.toBeInTheDocument();
});

test('komentar umum tanpa seleksi lewat tombol Tambah komentar (kutipan kosong)', async () => {
  const h = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah komentar' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Komentar' }), 'Umum');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim' }));
  expect(h.onComment).toHaveBeenCalledWith({ quote: '', before: '', after: '', body: 'Umum' });
});

test('task Dibatalkan: tanpa Ubah, Batalkan, dan centang aktif', () => {
  setup({}, makeHandover({ status: 'cancelled' }));
  expect(screen.queryByRole('button', { name: 'Ubah' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Batalkan task' })).not.toBeInTheDocument();
  for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
});

test('komentar tampil dengan kutipan, isi, dan label usang', () => {
  setup(
    {},
    makeHandover({
      comments: [
        {
          id: 'c1',
          quote: 'A = 1',
          before: '',
          after: '',
          body: 'Mohon cek',
          author: 'viewer@qc.local',
          at: '2026-10-15T03:00:00.000Z',
          stale: true,
        },
      ],
    }),
  );
  expect(screen.getByText('Mohon cek')).toBeInTheDocument();
  expect(screen.getByText('usang')).toBeInTheDocument();
});

test('antrean centang di perangkat: butir tampil tercentang dengan penanda walau DTO belum memuatnya', async () => {
  resetOutboxEnv();
  await enqueueCheck('qc@x', {
    taskId: 'h1',
    locationId: 'loc-a',
    index: 1,
    text: 'B = 2',
    checked: true,
    at: Date.now(),
  });
  setup({ owner: 'qc@x' });
  expect(screen.getByRole('checkbox', { name: /B = 2/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /A = 1/ })).not.toBeChecked();
  expect(screen.getByText('Belum terkirim')).toBeInTheDocument();
  resetOutboxEnv();
});

test('komentar di antrean perangkat tampil di detail dengan label "Belum terkirim"', async () => {
  resetOutboxEnv();
  await enqueueOutbox('qc@x', {
    kind: 'comment',
    clientId: '11111111-1111-4111-8111-111111111111',
    taskId: 'h1',
    locationId: 'loc-a',
    quote: '',
    before: '',
    after: '',
    body: 'komentar offline',
    at: Date.now(),
  });
  setup({ owner: 'qc@x' });
  expect(screen.getByText('komentar offline')).toBeInTheDocument();
  expect(screen.getByText('Belum terkirim')).toBeInTheDocument();
  resetOutboxEnv();
});

const DELETED = { deletedAt: '2026-11-20T01:00:00.000Z', deletedBy: 'adm@qc.local' };

test('Hapus (handover:manage): konfirmasi lalu onDelete; berbeda dari Batalkan task', async () => {
  const onDelete = vi.fn();
  const h = setup({ canDelete: true, onDelete }, makeHandover({ status: 'done' }));
  expect(screen.queryByRole('button', { name: 'Hapus' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ubah' })).toBeInTheDocument();
  expect(await moreActionNames()).toEqual(['Hapus']);
  await clickMoreAction('Hapus');
  expect(onDelete).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText(/Berbeda dari Batalkan/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(h.onCancel).not.toHaveBeenCalled();
});

test('tanpa canDelete tidak ada Hapus walau boleh Batalkan', async () => {
  setup({ canDelete: false, onDelete: vi.fn() });
  expect(screen.queryByRole('button', { name: 'Hapus' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Batalkan task' })).not.toBeInTheDocument();
  expect(await moreActionNames()).toEqual(['Batalkan task']);
});

test('task terhapus: badge Terhapus, banner dengan pelaku, hanya Pulihkan, centang dan komentar mati', async () => {
  const onRestore = vi.fn();
  setup({ canDelete: true, onDelete: vi.fn(), onRestore }, makeHandover({ deleted: DELETED }));
  expect(screen.getAllByText('Terhapus').length).toBeGreaterThan(0);
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.getByText(/adm@qc\.local/)).toBeInTheDocument();
  for (const name of ['Mark done', 'Ubah', 'Batalkan task', 'Hapus']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  }
  for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Tambah komentar' })).not.toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  expect(onRestore).toHaveBeenCalledTimes(1);
});

test('task terhapus tanpa manage: banner tanpa Pulihkan', () => {
  setup({ canDelete: false, onRestore: vi.fn() }, makeHandover({ deleted: DELETED }));
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Pulihkan' })).not.toBeInTheDocument();
});

test('View bertab: Catatan (bawaan) dan Riwayat; berpindah tab memberi tahu pemanggil', async () => {
  const onTabChange = vi.fn();
  setup(
    { onTabChange },
    makeHandover({
      status: 'done',
      completedAt: '2026-10-16T01:00:00.000Z',
      completedBy: 'qc@qc.local',
    }),
  );
  expect(screen.getByRole('tab', { name: 'Catatan' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('checkbox', { name: /A = 1/ })).toBeInTheDocument();
  expect(screen.queryByText('Ditandai selesai')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Riwayat' }));
  expect(onTabChange).toHaveBeenCalledWith('riwayat');
  expect(screen.getByText('Ditandai selesai')).toBeInTheDocument();
});

test('tab terkendali dari props (search param) menentukan tab aktif', () => {
  setup({ tab: 'riwayat' });
  expect(screen.getByRole('tab', { name: 'Riwayat' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Terakhir diubah')).toBeInTheDocument();
});

test('aksi ponsel/desktop memakai ViewPage: judul h1 nomor task dengan badge status', () => {
  setup({}, makeHandover({ status: 'in_progress' }));
  const heading = screen.getByRole('heading', { level: 1 });
  expect(heading).toHaveTextContent('ST-20261015-001');
  expect(screen.getByText('Dikerjakan')).toBeInTheDocument();
});

test('panel kanan memuat log aktivitas task (kind handover)', async () => {
  setup();
  const panel = await screen.findByRole('region', { name: 'Aktivitas' });
  expect(await within(panel).findByText('Belum ada aktivitas tercatat.')).toBeInTheDocument();
  expect(apiMock).toHaveBeenCalledWith('activity.list', {
    kind: 'handover',
    id: makeHandover().id,
    limit: 10,
  });
});

test('aksi Keluar Gudang hanya bila onWarehouse diberikan (serialwh edit), lewat menu Aksi lainnya', async () => {
  setup();
  expect(await moreActionNames()).not.toContain('Keluar Gudang');
  document.body.innerHTML = '';
  const onWarehouse = vi.fn();
  setup({ onWarehouse });
  expect(screen.queryByRole('button', { name: 'Keluar Gudang' })).not.toBeInTheDocument();
  await clickMoreAction('Keluar Gudang');
  expect(onWarehouse).toHaveBeenCalledTimes(1);
});

test('aksi Keluar Gudang tidak tampil untuk task terhapus', async () => {
  setup(
    { onWarehouse: vi.fn() },
    makeHandover({ deleted: { deletedAt: '2026-11-20T01:00:00.000Z', deletedBy: 'x@x.com' } }),
  );
  if (!hasNoMoreActions()) expect(await moreActionNames()).not.toContain('Keluar Gudang');
});
