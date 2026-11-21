import type { StickerDto, StickerTypeDto } from '@shared/contract';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { StickerTypeView, type StickerTypeViewProps } from './sticker-type-view';

afterEach(() => {
  cleanup();
});

const type: StickerTypeDto = {
  id: 'tp-bu',
  name: 'QC Hijau',
  rule: 'bu',
  status: 'active',
  stickerCount: 2,
  systemKind: '',
  defaultMinQty: 25,
  updatedAt: '2026-11-09T11:00:00.000Z',
};

function sticker(overrides: Partial<StickerDto>): StickerDto {
  return {
    id: 's1',
    typeId: 'tp-bu',
    typeName: 'QC Hijau',
    name: 'QC Hijau Besar',
    alias: 'Hijau-B',
    fileId: null,
    minQty: 0,
    status: 'active',
    businessUnitIds: [],
    low: false,
    latestManualBookVersion: false,
    updatedAt: '',
    ...overrides,
  };
}

const stickers: StickerDto[] = [
  sticker({}),
  sticker({ id: 's2', name: 'QC Hijau Kecil', alias: '' }),
  sticker({ id: 's9', typeId: 'tp-lain', typeName: 'Segel', name: 'Segel Polos', alias: '' }),
];

async function renderView(props: Partial<StickerTypeViewProps> = {}) {
  const handlers = {
    onBack: vi.fn(),
    onEdit: vi.fn(),
    onToggleStatus: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
  };
  await renderInRouter(
    <StickerTypeView type={type} stickers={stickers} canEdit canManage {...handlers} {...props} />,
  );
  return handlers;
}

test('jenis tidak ada: pesan dan tombol kembali', async () => {
  const { onBack } = await renderView({ type: undefined });
  expect(screen.getByRole('heading', { name: 'Jenis stiker tidak ditemukan' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar jenis' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('memuat identitas jenis dan hanya stiker milik jenis itu, dengan tautan ke View stiker', async () => {
  await renderView();
  expect(screen.getByRole('heading', { level: 1, name: 'QC Hijau' })).toBeInTheDocument();
  expect(screen.getByText('Menurut BU')).toBeInTheDocument();
  expect(screen.getByText('25')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Hijau-B' })).toHaveAttribute('href', '/sticker/s1');
  expect(screen.getByRole('link', { name: 'QC Hijau Kecil' })).toHaveAttribute(
    'href',
    '/sticker/s2',
  );
  expect(screen.queryByRole('link', { name: 'Segel Polos' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Lihat stiker jenis ini' })).toHaveAttribute(
    'href',
    '/sticker?typeId=tp-bu',
  );
});

test('jenis tanpa stiker menampilkan keterangan kosong', async () => {
  await renderView({ stickers: [] });
  expect(screen.getByText('Belum ada stiker pada jenis ini.')).toBeInTheDocument();
});

test('aksi: Ubah dan Nonaktifkan; Hapus tidak ada selama jenis Aktif', async () => {
  const { onEdit, onToggleStatus } = await renderView();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  expect(onEdit).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan' }));
  expect(onToggleStatus).toHaveBeenCalledTimes(1);
});

test('jenis nonaktif: Aktifkan dan Hapus tersedia', async () => {
  const { onDelete } = await renderView({ type: { ...type, status: 'inactive' } });
  expect(screen.getByRole('button', { name: 'Aktifkan' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  expect(onDelete).toHaveBeenCalledTimes(1);
});

test('jenis sistem: lencana Sistem, keterangan dikelola aplikasi, tanpa aksi apa pun', async () => {
  await renderView({
    type: { ...type, systemKind: 'manual_book', rule: 'group', status: 'inactive' },
  });
  expect(screen.getAllByText('Sistem').length).toBeGreaterThan(0);
  expect(screen.getByText(/Dikelola aplikasi/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Aktifkan|Nonaktifkan/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
});

test('tanpa izin: tanpa Ubah, Nonaktifkan, dan Hapus', async () => {
  await renderView({ canEdit: false, canManage: false, type: { ...type, status: 'inactive' } });
  expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Aktifkan' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
});

test('jenis terhapus: spanduk Terhapus dan hanya aksi Pulihkan', async () => {
  const { onRestore } = await renderView({
    type: {
      ...type,
      status: 'inactive',
      deleted: { deletedAt: '2026-11-20T03:00:00.000Z', deletedBy: 'admin@x.com' },
    },
  });
  expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  expect(onRestore).toHaveBeenCalled();
});

test('ponsel (360 px): bar aksi menempel memuat aksi utama dan menu "Aksi lainnya"', async () => {
  const media = mockMatchMedia(false);
  try {
    await renderView({ type: { ...type, status: 'inactive' } });
    const bar = screen.getByRole('region', { name: 'Aksi halaman' });
    expect(within(bar).getByRole('button', { name: 'Ubah' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Aksi lainnya' })).toBeInTheDocument();
  } finally {
    media.restore();
  }
});
