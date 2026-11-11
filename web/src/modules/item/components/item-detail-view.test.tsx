import type { ItemDto } from '@shared/contract';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: (id: string) => ({
    url: `data:image/png;base64,${id}`,
    isLoading: false,
    isError: false,
  }),
}));

import { ItemDetailView } from './item-detail-view';

const item: ItemDto = {
  id: 'i1',
  brandId: 'b1',
  brand: 'Ubiquiti',
  model: 'AF 5XHD',
  isCountryLock: true,
  status: 'active',
  aliases: ['AirFiber 5XHD', 'AF-5XHD'],
  imageCount: 2,
  businessUnits: [
    { id: 'bu-a', code: 'RTL', name: 'Retail' },
    { id: 'bu-b', code: 'WHL', name: 'Wholesale' },
  ],
  updatedAt: '2026-10-09T00:00:00.000Z',
  hasInstructions: true,
  hasManualBook: false,
  hasPostel: false,
  manualBook: null,
  postel: null,
  stickerPhotos: [
    {
      guideId: 'g1',
      guideName: 'Belakang',
      width: 800,
      height: 600,
      caption: 'Bagian belakang',
      buId: null,
      marks: [
        {
          x: 100,
          y: 200,
          target: { kind: 'sticker', stickerId: 's1' },
          note: 'Belakang, kanan bawah',
          targetName: 'Label SNI',
          resolved: [
            { id: 's1', name: 'Label SNI', alias: '', fileId: 'st1', buCodes: [], inactive: false },
          ],
          unresolved: false,
        },
      ],
    },
  ],
  accessories: [
    { name: 'Adaptor PoE', qty: 1 },
    { name: 'Bracket', qty: 2 },
  ],
  attachments: ['g1', 'g2'],
  detail: '## Spesifikasi\n- Frekuensi: 5 GHz\n\n![Contoh](qcfile:st1)',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedBy: 'admin@qc.local',
};

function renderView(over: Partial<Parameters<typeof ItemDetailView>[0]> = {}) {
  const handlers = { onBack: vi.fn(), onEdit: vi.fn(), onToggleStatus: vi.fn() };
  render(
    <ItemDetailView item={item} canEdit canManage statusPending={false} {...handlers} {...over} />,
  );
  return handlers;
}

test('menampilkan identitas, nama lain, galeri, stiker, kelengkapan, dan detail Markdown', () => {
  renderView();
  expect(screen.getByRole('heading', { level: 1, name: 'Ubiquiti AF 5XHD' })).toBeInTheDocument();
  expect(screen.getByText('Country lock')).toBeInTheDocument();
  expect(screen.getByText('AirFiber 5XHD, AF-5XHD')).toBeInTheDocument();
  expect(screen.getByAltText('Gambar 1')).toBeInTheDocument();
  expect(screen.getByAltText('Gambar 2')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Instruksi stiker' })).toBeInTheDocument();
  // nama tampil di samping penanda (layar lebar) dan di daftar bawah foto
  expect(screen.getAllByText('Label SNI')).toHaveLength(2);
  expect(screen.getByText('Bagian belakang')).toBeInTheDocument();
  expect(screen.getByText('Belakang, kanan bawah')).toBeInTheDocument();
  expect(screen.getByAltText('Contoh Label SNI')).toBeInTheDocument();
  expect(screen.getByText('Adaptor PoE ×1')).toBeInTheDocument();
  expect(screen.getByText('Bracket ×2')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Spesifikasi' })).toBeInTheDocument();
  expect(screen.getByText('Frekuensi: 5 GHz')).toBeInTheDocument();
});

test('bagian kosong menampilkan petunjuk, dan item nonaktif ditandai', () => {
  renderView({
    item: {
      ...item,
      brandId: 'b1',
      aliases: [],
      attachments: [],
      stickerPhotos: [],
      hasInstructions: false,
      accessories: [],
      detail: '',
      status: 'inactive',
      isCountryLock: false,
    },
  });
  expect(screen.getByText('Nonaktif')).toBeInTheDocument();
  expect(screen.queryByText('Country lock')).not.toBeInTheDocument();
  expect(screen.getByText('Belum ada gambar.')).toBeInTheDocument();
  expect(screen.getByText('Belum ada instruksi stiker')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Tambahkan instruksi' })).toHaveAttribute(
    'href',
    '/item/i1/edit',
  );
  expect(screen.getByText('Belum ada kelengkapan.')).toBeInTheDocument();
  expect(screen.getByText('Belum ada detail.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Aktifkan' })).toBeInTheDocument();
});

test('tanda belum ada instruksi tanpa tautan ke form bila tak boleh mengubah', () => {
  renderView({ canEdit: false, item: { ...item, stickerPhotos: [], hasInstructions: false } });
  expect(screen.getByText('Belum ada instruksi stiker')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Tambahkan instruksi' })).not.toBeInTheDocument();
});

test('tombol aksi mengikuti izin dan memanggil handler', async () => {
  const { onBack, onEdit, onToggleStatus } = renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan' }));
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onToggleStatus).toHaveBeenCalledTimes(1);
});

test('hanya view: tidak ada Ubah dan Nonaktifkan; edit saja: ada Ubah tanpa Nonaktifkan', () => {
  const { unmount } = render(
    <ItemDetailView
      item={item}
      canEdit={false}
      canManage={false}
      statusPending={false}
      onBack={() => undefined}
      onEdit={() => undefined}
      onToggleStatus={() => undefined}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Ubah' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan' })).not.toBeInTheDocument();
  unmount();
  renderView({ canManage: false });
  expect(screen.getByRole('button', { name: 'Ubah' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan' })).not.toBeInTheDocument();
});

test('tombol status dinonaktifkan selama permintaan berjalan', () => {
  renderView({ statusPending: true });
  expect(screen.getByRole('button', { name: 'Nonaktifkan' })).toBeDisabled();
});

test('menampilkan chip BU item', () => {
  renderView();
  expect(screen.getByText('RTL')).toHaveAttribute('title', 'Retail');
  expect(screen.getByText('WHL')).toBeInTheDocument();
});

const withManualBook: ItemDto = {
  ...item,
  hasManualBook: true,
  manualBook: { designId: 'd1', name: 'PBE M5-400', version: 2, status: 'active' },
};

test('bagian Manual Book: nama, versi, status, dan tautan bila diberi', () => {
  renderView({
    item: withManualBook,
    openManualBookHref: (id) => `/qrcode/${id}/edit`,
  });
  expect(screen.getByRole('heading', { name: 'Manual Book' })).toBeInTheDocument();
  expect(screen.getByText('PBE M5-400')).toBeInTheDocument();
  expect(screen.getByText('v2')).toBeInTheDocument();
  expect(screen.getByText('Aktif')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Buka konfigurasi QR' })).toHaveAttribute(
    'href',
    '/qrcode/d1/edit',
  );
});

test('Manual Book tanpa tautan bila tak berhak; status Usang berlabel', () => {
  renderView({
    item: {
      ...withManualBook,
      manualBook: { designId: 'd1', name: 'PBE M5-400', version: 1, status: 'deprecated' },
    },
  });
  expect(screen.getByText('PBE M5-400')).toBeInTheDocument();
  expect(screen.getByText('Usang')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Buka konfigurasi QR' })).toBeNull();
});

test('item tanpa Manual Book menampilkan keterangan kosong', () => {
  renderView();
  expect(screen.getByRole('heading', { name: 'Manual Book' })).toBeInTheDocument();
  expect(screen.getByText('Belum ada QR Manual Book')).toBeInTheDocument();
});

const postelInfo = {
  id: 'p1',
  name: 'M5-200/400',
  number: 'AB-1',
  expiresOn: '2026-12-01',
  condition: 'soon' as const,
  daysLeft: 19,
};

test('bagian Postel tersembunyi bila postel undefined (tanpa izin sticker view)', () => {
  renderView({ postel: undefined });
  expect(screen.queryByRole('heading', { name: 'Postel' })).not.toBeInTheDocument();
  expect(screen.queryByText('Belum ada Postel')).not.toBeInTheDocument();
});

test('bagian Postel: null menampilkan keterangan kosong', () => {
  renderView({ postel: null });
  expect(screen.getByRole('heading', { name: 'Postel' })).toBeInTheDocument();
  expect(screen.getByText('Belum ada Postel')).toBeInTheDocument();
});

test('bagian Postel: nama, nomor, tanggal habis, badge kondisi, dan tautan Buka', () => {
  renderView({ postel: postelInfo, openPostelHref: (id) => `/postel/${id}` });
  expect(screen.getByRole('heading', { name: 'Postel' })).toBeInTheDocument();
  expect(screen.getByText('M5-200/400')).toBeInTheDocument();
  expect(screen.getByText('AB-1')).toBeInTheDocument();
  expect(screen.getByText(/1 Des(?:ember)? 2026/)).toBeInTheDocument();
  expect(screen.getByText('Segera habis')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Buka Postel' })).toHaveAttribute('href', '/postel/p1');
});

test('tautan Buka Postel tak tampil bila openPostelHref tak ada atau mengembalikan null', () => {
  const first = renderView({ postel: postelInfo });
  expect(screen.queryByRole('link', { name: 'Buka Postel' })).toBeNull();
  cleanup();
  renderView({ postel: postelInfo, openPostelHref: () => null });
  expect(screen.queryByRole('link', { name: 'Buka Postel' })).toBeNull();
  expect(first).toBeDefined();
});
