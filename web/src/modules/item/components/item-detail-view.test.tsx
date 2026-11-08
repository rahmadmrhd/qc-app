import type { ItemDto } from '@shared/contract';
import { render, screen } from '@testing-library/react';
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
  stickers: [
    { name: 'Label SNI', note: 'Belakang, kanan bawah', fileId: 'st1' },
    { name: 'Label garansi', note: '', fileId: null },
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
  expect(screen.getByText('Label SNI')).toBeInTheDocument();
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
      stickers: [],
      accessories: [],
      detail: '',
      status: 'inactive',
      isCountryLock: false,
    },
  });
  expect(screen.getByText('Nonaktif')).toBeInTheDocument();
  expect(screen.queryByText('Country lock')).not.toBeInTheDocument();
  expect(screen.getByText('Belum ada gambar.')).toBeInTheDocument();
  expect(screen.getByText('Belum ada stiker.')).toBeInTheDocument();
  expect(screen.getByText('Belum ada kelengkapan.')).toBeInTheDocument();
  expect(screen.getByText('Belum ada detail.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Aktifkan' })).toBeInTheDocument();
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
