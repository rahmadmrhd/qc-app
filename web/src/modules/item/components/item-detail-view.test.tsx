import type { ItemDto } from '@shared/contract';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { clickMoreAction, hasNoMoreActions, moreActionNames } from '@/test/more-actions';
import { renderInRouter } from '@/test/render-in-router';

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
  firmware: '',
  proofRequired: false,
  proofMin: 1,
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

async function renderView(over: Partial<Parameters<typeof ItemDetailView>[0]> = {}) {
  const handlers = {
    onEdit: vi.fn(),
    onToggleStatus: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
    onTabChange: vi.fn(),
  };
  const result = await renderInRouter(
    <ItemDetailView item={item} canEdit canManage statusPending={false} {...handlers} {...over} />,
  );
  return { ...handlers, ...result };
}

async function openTab(name: string) {
  await userEvent.click(screen.getByRole('tab', { name }));
}

test('judul "merk tipe", badge status, dan tab Detail aktif memuat identitas', async () => {
  await renderView();
  expect(screen.getByRole('heading', { level: 1, name: 'Ubiquiti AF 5XHD' })).toBeInTheDocument();
  expect(screen.getByText('Aktif')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Detail', selected: true })).toBeInTheDocument();
  expect(screen.getByText('AirFiber 5XHD, AF-5XHD')).toBeInTheDocument();
  expect(screen.getByText('Ya')).toBeInTheDocument();
  expect(screen.getByText('Adaptor PoE ×1')).toBeInTheDocument();
  expect(screen.getByText('Bracket ×2')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Spesifikasi' })).toBeInTheDocument();
  expect(screen.getByText('Frekuensi: 5 GHz')).toBeInTheDocument();
  expect(screen.getByText('RTL - Retail')).toHaveAttribute('title', 'Retail');
});

test('berpindah tab menampilkan isinya dan memanggil onTabChange', async () => {
  const { onTabChange } = await renderView();
  await openTab('Gambar');
  expect(onTabChange).toHaveBeenLastCalledWith('gambar');
  expect(screen.getByAltText('Gambar 1')).toBeInTheDocument();
  expect(screen.getByAltText('Gambar 2')).toBeInTheDocument();
  await openTab('Instruksi Stiker');
  expect(onTabChange).toHaveBeenLastCalledWith('stiker');
  expect(screen.getAllByText('Label SNI')).toHaveLength(2);
  expect(screen.getByText('Bagian belakang')).toBeInTheDocument();
  expect(screen.getByAltText('Contoh Label SNI')).toBeInTheDocument();
});

test('tab terkendali: prop tab menentukan tab aktif', async () => {
  await renderView({ tab: 'gambar' });
  expect(screen.getByRole('tab', { name: 'Gambar', selected: true })).toBeInTheDocument();
  expect(screen.getByAltText('Gambar 1')).toBeInTheDocument();
});

test('Merk dan BU berupa tautan bila diberi akses, selain itu teks/lencana', async () => {
  const { unmount } = await renderView({
    openBrandHref: (id) => `/item/brands/${id}`,
    openBusinessUnitHref: (id) => `/access/business-units/${id}`,
  });
  expect(screen.getByRole('link', { name: 'Ubiquiti' })).toHaveAttribute('href', '/item/brands/b1');
  expect(screen.getByRole('link', { name: 'RTL - Retail' })).toHaveAttribute(
    'href',
    '/access/business-units/bu-a',
  );
  unmount();
  await renderView();
  expect(screen.queryByRole('link', { name: 'Ubiquiti' })).toBeNull();
  expect(screen.getByText('RTL - Retail')).toHaveAttribute('title', 'Retail');
});

test('merk terhapus diberi penanda Terhapus pada baris Merk', async () => {
  await renderView({ item: { ...item, brandDeleted: true } });
  expect(screen.getByText('Terhapus')).toBeInTheDocument();
});

test('bagian kosong menampilkan petunjuk, dan item nonaktif ditandai', async () => {
  await renderView({
    item: {
      ...item,
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
  expect(screen.getByText('Belum ada kelengkapan.')).toBeInTheDocument();
  expect(screen.getByText('Belum ada detail.')).toBeInTheDocument();
  expect(screen.queryByText('Firmware')).toBeNull();
  expect(screen.getByRole('button', { name: 'Aktifkan' })).toBeInTheDocument();
  await openTab('Gambar');
  expect(screen.getByText('Belum ada gambar.')).toBeInTheDocument();
  await openTab('Instruksi Stiker');
  expect(screen.getByText('Belum ada instruksi stiker')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Tambahkan instruksi' })).toHaveAttribute(
    'href',
    '/item/i1/edit',
  );
});

test('tanda belum ada instruksi tanpa tautan ke form bila tak boleh mengubah', async () => {
  await renderView({
    canEdit: false,
    item: { ...item, stickerPhotos: [], hasInstructions: false },
  });
  await openTab('Instruksi Stiker');
  expect(screen.getByText('Belum ada instruksi stiker')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Tambahkan instruksi' })).not.toBeInTheDocument();
});

test('tombol aksi mengikuti izin dan memanggil handler; Hapus hanya untuk item Nonaktif', async () => {
  const { onEdit, onToggleStatus, unmount } = await renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan' }));
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onToggleStatus).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(hasNoMoreActions()).toBe(true);
  unmount();
  const second = await renderView({ item: { ...item, status: 'inactive' } });
  // Hapus bukan aksi utama: tidak tampil sebagai tombol, hanya ada di menu "Aksi lainnya".
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Ubah' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Aktifkan' })).toBeInTheDocument();
  expect(await moreActionNames()).toEqual(['Hapus']);
  await clickMoreAction('Hapus');
  expect(second.onDelete).toHaveBeenCalledTimes(1);
});

test('hanya view: tanpa Ubah/Nonaktifkan/Hapus; edit saja: ada Ubah tanpa Nonaktifkan', async () => {
  const first = await renderView({
    canEdit: false,
    canManage: false,
    item: { ...item, status: 'inactive' },
  });
  expect(screen.queryByRole('button', { name: 'Ubah' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Aktifkan' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus' })).not.toBeInTheDocument();
  first.unmount();
  await renderView({ canManage: false });
  expect(screen.getByRole('button', { name: 'Ubah' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan' })).not.toBeInTheDocument();
});

test('tombol status dinonaktifkan selama permintaan berjalan', async () => {
  await renderView({ statusPending: true });
  expect(screen.getByRole('button', { name: /Nonaktifkan/ })).toBeDisabled();
});

const deletedItem: ItemDto = {
  ...item,
  status: 'inactive',
  deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
};

test('item terhapus: banner, badge Terhapus, dan hanya tombol Pulihkan bagi manage', async () => {
  const { onRestore } = await renderView({ item: deletedItem, canRestore: true });
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.getAllByText('Terhapus').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  expect(screen.queryByRole('button', { name: /aktifkan/i })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  // Pulihkan ada di bar aksi dan di banner.
  const buttons = screen.getAllByRole('button', { name: 'Pulihkan' });
  expect(buttons).toHaveLength(2);
  await userEvent.click(buttons[0] as HTMLElement);
  expect(onRestore).toHaveBeenCalledTimes(1);
});

test('item terhapus tanpa hak pulihkan: banner tanpa tombol', async () => {
  await renderView({ item: deletedItem, canRestore: false });
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Pulihkan' })).toBeNull();
});

test('panel samping: "Dibuat" dari createdAt, "Diubah oleh", dan tautan Serial Number bila berhak', async () => {
  await renderView({ canViewSerial: true });
  expect(screen.getByText('Dibuat')).toBeInTheDocument();
  expect(screen.getByText('Diubah').closest('p')).toHaveTextContent('oleh admin@qc.local');
  expect(screen.getByRole('link', { name: 'Lihat Serial Number item ini' })).toBeInTheDocument();
});

test('tanpa createdAt, "Dibuat" tidak tampil; tanpa hak serial tak ada tautan', async () => {
  await renderView({ item: { ...item, createdAt: '' } });
  expect(screen.queryByText('Dibuat')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Lihat Serial Number item ini' })).toBeNull();
});

test('lencana Wajib foto tampil di Identitas hanya untuk item wajib foto', async () => {
  const { unmount } = await renderView({ item: { ...item, proofRequired: true, proofMin: 2 } });
  expect(screen.getByText('Ya (min 2)')).toBeInTheDocument();
  unmount();
  await renderView();
  expect(screen.queryByText(/Ya \(min/)).not.toBeInTheDocument();
});

const withManualBook: ItemDto = {
  ...item,
  hasManualBook: true,
  manualBook: { designId: 'd1', name: 'PBE M5-400', version: 2, status: 'active' },
};

test('tab Manual Book & Postel: nama, versi, status, dan tautan bila diberi', async () => {
  await renderView({
    item: withManualBook,
    openManualBookHref: (id) => `/qrcode/${id}`,
  });
  await openTab('Manual Book & Postel');
  expect(screen.getByRole('heading', { name: 'Manual Book' })).toBeInTheDocument();
  expect(screen.getByText('PBE M5-400')).toBeInTheDocument();
  expect(screen.getByText('v2')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Buka konfigurasi QR' })).toHaveAttribute(
    'href',
    '/qrcode/d1',
  );
});

test('Manual Book tanpa tautan bila tak berhak; status Usang berlabel', async () => {
  await renderView({
    item: {
      ...withManualBook,
      manualBook: { designId: 'd1', name: 'PBE M5-400', version: 1, status: 'deprecated' },
    },
  });
  await openTab('Manual Book & Postel');
  expect(screen.getByText('Usang')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Buka konfigurasi QR' })).toBeNull();
});

test('item tanpa Manual Book menampilkan keterangan kosong', async () => {
  await renderView();
  await openTab('Manual Book & Postel');
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

test('tanpa izin sticker view: tanpa Postel tetap ada keterangan; yang sudah ber-Postel disembunyikan', async () => {
  const first = await renderView({ postel: undefined });
  await openTab('Manual Book & Postel');
  expect(screen.getByRole('heading', { name: 'Postel' })).toBeInTheDocument();
  expect(screen.getByText('Belum ada Postel')).toBeInTheDocument();
  first.unmount();
  await renderView({ postel: undefined, item: { ...item, hasPostel: true } });
  await openTab('Manual Book & Postel');
  expect(screen.queryByRole('heading', { name: 'Postel' })).not.toBeInTheDocument();
  expect(screen.queryByText('Belum ada Postel')).not.toBeInTheDocument();
});

test('bagian Postel: null = keterangan kosong; berisi = nama, nomor, tanggal, kondisi, tautan', async () => {
  const first = await renderView({ postel: null });
  await openTab('Manual Book & Postel');
  expect(screen.getByText('Belum ada Postel')).toBeInTheDocument();
  first.unmount();
  await renderView({ postel: postelInfo, openPostelHref: (id) => `/postel/${id}` });
  await openTab('Manual Book & Postel');
  expect(screen.getByText('M5-200/400')).toBeInTheDocument();
  expect(screen.getByText('AB-1')).toBeInTheDocument();
  expect(screen.getByText(/1 Des(?:ember)? 2026/)).toBeInTheDocument();
  expect(screen.getByText('Segera habis')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Buka Postel' })).toHaveAttribute('href', '/postel/p1');
});

test('tautan Buka Postel tak tampil bila akses tidak diberikan atau null', async () => {
  const first = await renderView({ postel: postelInfo });
  await openTab('Manual Book & Postel');
  expect(screen.queryByRole('link', { name: 'Buka Postel' })).toBeNull();
  first.unmount();
  const openPostelHref = vi.fn(() => null);
  await renderView({ postel: postelInfo, openPostelHref });
  await openTab('Manual Book & Postel');
  expect(screen.queryByRole('link', { name: 'Buka Postel' })).toBeNull();
  expect(openPostelHref).toHaveBeenCalledTimes(1);
});

test('merk terhapus: tautan merk hanya bagi pemegang izin Pulihkan, selain itu teks + Terhapus', async () => {
  const { unmount } = await renderView({
    item: { ...item, brandDeleted: true },
    canRestore: true,
    openBrandHref: (id) => `/item/brands/${id}`,
  });
  expect(screen.getByRole('link', { name: 'Ubiquiti' })).toBeInTheDocument();
  unmount();
  await renderView({
    item: { ...item, brandDeleted: true },
    canRestore: false,
    openBrandHref: (id) => `/item/brands/${id}`,
  });
  expect(screen.queryByRole('link', { name: 'Ubiquiti' })).toBeNull();
  expect(screen.getByText('Ubiquiti')).toBeInTheDocument();
  expect(screen.getByText('Terhapus')).toBeInTheDocument();
});
