import type { MeDto, StickerStockDto } from '@shared/contract';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ActiveLocationsProvider } from '@/modules/location/active-locations-context';
import { pickLink, pickSelect } from '@/test/link-field';
import { StockPage, type StockPageProps } from './stock-page';

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));
const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { info: toastInfo, success: vi.fn(), error: vi.fn() } }));

function located(permission: 'view' | 'edit' | 'manage') {
  return { handover: 'none', qc: 'none', stock: 'none', stickerstock: permission } as const;
}

beforeEach(() => {
  localStorage.clear();
  me = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: {
      access: 'none',
      item: 'none',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'view',
      stickerstock: 'none',
      serial: 'none',
      serialservice: 'none',
    },
    businessUnits: [],
    locations: [
      { id: 'l-a', code: 'JKT', name: 'Jakarta', permissions: located('manage') },
      { id: 'l-b', code: 'BDG', name: 'Bandung', permissions: located('manage') },
    ],
  };
});

const rows: StickerStockDto[] = [
  {
    stickerId: 's1',
    name: 'Hijau-B',
    typeName: 'QC Hijau',
    typeStatus: 'active',
    status: 'active',
    minQty: 100,
    low: true,
    total: 150,
    byLocation: [
      { locationId: 'l-a', qty: 120 },
      { locationId: 'l-b', qty: 30 },
    ],
  },
  {
    stickerId: 's2',
    name: 'Segel Polos',
    typeName: 'Segel',
    typeStatus: 'active',
    status: 'active',
    minQty: 0,
    low: false,
    total: 40,
    byLocation: [
      { locationId: 'l-a', qty: 40 },
      { locationId: 'l-b', qty: 0 },
    ],
  },
];

const bothLocations = [
  { id: 'l-a', code: 'JKT', name: 'Jakarta' },
  { id: 'l-b', code: 'BDG', name: 'Bandung' },
];

function renderPage(props: Partial<StockPageProps> = {}) {
  const onWrite = vi.fn().mockResolvedValue(null);
  const onOpname = vi.fn().mockResolvedValue(null);
  const onShowHistory = vi.fn();
  const element = (extra: Partial<StockPageProps> = {}) => (
    <ActiveLocationsProvider>
      <StockPage
        rows={rows}
        locations={bothLocations}
        canEdit
        canManage
        onWrite={onWrite}
        onOpname={onOpname}
        onShowHistory={onShowHistory}
        {...props}
        {...extra}
      />
    </ActiveLocationsProvider>
  );
  const { rerender } = render(element());
  return {
    onWrite,
    onOpname,
    onShowHistory,
    /** Memuat ulang halaman dengan data stok baru (mis. setelah refetch). */
    update: (extra: Partial<StockPageProps>) => rerender(element(extra)),
  };
}

test('Masuk disembunyikan bila stiker ATAU jenisnya nonaktif; Keluar dan Koreksi tetap ada', () => {
  const [first, second] = rows as [StickerStockDto, StickerStockDto];
  renderPage({
    rows: [
      { ...first, typeStatus: 'inactive' },
      { ...second, status: 'inactive' },
    ],
  });
  expect(screen.queryByRole('button', { name: 'Catat masuk Hijau-B' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Catat masuk Segel Polos' })).toBeNull();
  for (const name of ['Hijau-B', 'Segel Polos']) {
    expect(screen.getByRole('button', { name: `Catat keluar ${name}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Koreksi ${name}` })).toBeInTheDocument();
  }
});

test('"Stok saat ini" di dialog ikut diperbarui saat stok dimuat ulang dengan dialog terbuka', async () => {
  const { update } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Catat keluar Hijau-B' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  expect(within(dialog).getByText('Stok saat ini: 120 butir')).toBeInTheDocument();
  const [first, ...rest] = rows as [StickerStockDto, ...StickerStockDto[]];
  update({
    rows: [
      {
        ...first,
        total: 35,
        byLocation: [
          { locationId: 'l-a', qty: 5 },
          { locationId: 'l-b', qty: 30 },
        ],
      },
      ...rest,
    ],
  });
  expect(within(dialog).getByText('Stok saat ini: 5 butir')).toBeInTheDocument();
});

test('baris hilang saat dialog terbuka: dialog menutup bersih dengan pemberitahuan dan tidak terbuka lagi sendiri', async () => {
  toastInfo.mockClear();
  const { update } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Catat keluar Hijau-B' }));
  await screen.findByRole('alertdialog');
  const [first, second] = rows as [StickerStockDto, StickerStockDto];
  update({ rows: [second] });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(toastInfo).toHaveBeenCalledWith('Stok stiker berubah; dialog ditutup');
  // Baris kembali: dialog tidak terbuka lagi dengan sendirinya.
  update({ rows: [first, second] });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(toastInfo).toHaveBeenCalledTimes(1);
});

test('pesan angka dibedakan: kosong, bukan bilangan bulat, dan melebihi batas', async () => {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Koreksi Hijau-B' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  await userEvent.type(within(dialog).getByLabelText('Alasan'), 'Uji');
  const delta = within(dialog).getByLabelText('Perubahan (butir)');
  const save = within(dialog).getByRole('button', { name: 'Simpan' });
  await userEvent.click(save);
  expect(within(dialog).getByText('Perubahan wajib diisi (bukan 0)')).toBeInTheDocument();
  await userEvent.type(delta, '1.5');
  await userEvent.click(save);
  expect(within(dialog).getByText('Perubahan harus bilangan bulat')).toBeInTheDocument();
  await userEvent.clear(delta);
  await userEvent.type(delta, '2000000');
  await userEvent.click(save);
  expect(within(dialog).getByText(/Perubahan maksimal 1000000/)).toBeInTheDocument();
});

test('jumlah keluar: kosong, desimal, dan melebihi batas memberi pesan berbeda', async () => {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Catat keluar Hijau-B' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  await userEvent.type(within(dialog).getByLabelText('Alasan'), 'Uji');
  const quantity = within(dialog).getByLabelText('Jumlah butir');
  const save = within(dialog).getByRole('button', { name: 'Simpan' });
  await userEvent.click(save);
  expect(within(dialog).getByText('Jumlah wajib diisi (minimal 1 butir)')).toBeInTheDocument();
  await userEvent.type(quantity, '2.5');
  await userEvent.click(save);
  expect(within(dialog).getByText('Jumlah harus bilangan bulat')).toBeInTheDocument();
  await userEvent.clear(quantity);
  await userEvent.type(quantity, '1000001');
  await userEvent.click(save);
  expect(within(dialog).getByText('Jumlah maksimal 1000000')).toBeInTheDocument();
});

test('opname: total butir baris melebihi batas ditandai pada baris dan Simpan nonaktif', async () => {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Stok opname' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hitung Hijau-B' }));
  await userEvent.type(within(dialog).getByLabelText('Lembar baris 1'), '1000');
  await userEvent.type(within(dialog).getByLabelText('Isi per lembar baris 1'), '5000');
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Hijau-B: jumlah butir maksimal 1000000',
  );
  expect(within(dialog).getByRole('button', { name: 'Simpan opname' })).toBeDisabled();
});

test('menampilkan stiker, total, penanda Menipis, dan rincian per lokasi bila lebih dari satu lokasi', () => {
  renderPage();
  const first = screen.getByRole('row', { name: /Hijau-B/ });
  expect(within(first).getByText('QC Hijau')).toBeInTheDocument();
  expect(within(first).getByText('150')).toBeInTheDocument();
  expect(within(first).getByText('Menipis')).toBeInTheDocument();
  expect(within(first).getByText('JKT 120')).toBeInTheDocument();
  expect(within(first).getByText('BDG 30')).toBeInTheDocument();
  const second = screen.getByRole('row', { name: /Segel Polos/ });
  expect(within(second).queryByText('Menipis')).toBeNull();
});

test('satu lokasi: tanpa kolom rincian per lokasi', () => {
  renderPage({ locations: [bothLocations[0] as (typeof bothLocations)[number]] });
  expect(screen.queryByRole('columnheader', { name: 'Per lokasi' })).toBeNull();
});

test('Koreksi dan Stok opname tersembunyi bagi pemegang edit; Catat masuk/keluar tetap ada', () => {
  renderPage({ canManage: false });
  expect(screen.queryByRole('button', { name: /^Koreksi/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Stok opname' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Catat masuk Hijau-B' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Catat keluar Hijau-B' })).toBeInTheDocument();
});

test('pemegang view saja tidak melihat tombol tulis, tetapi tetap melihat Riwayat', async () => {
  const { onShowHistory } = renderPage({ canEdit: false, canManage: false });
  expect(screen.queryByRole('button', { name: /^Catat/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Koreksi Hijau-B' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Riwayat Hijau-B' }));
  expect(onShowHistory).toHaveBeenCalledWith(rows[0]);
});

test('dialog keluar mewajibkan alasan', async () => {
  const { onWrite } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Catat keluar Hijau-B' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  await userEvent.type(within(dialog).getByLabelText('Jumlah butir'), '20');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onWrite).not.toHaveBeenCalled();
  expect(await within(dialog).findByText('Alasan wajib diisi')).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText('Alasan'), 'Dipakai QC');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onWrite).toHaveBeenCalledWith({
    type: 'record',
    input: {
      locationId: 'l-a',
      stickerId: 's1',
      kind: 'out',
      quantity: 20,
      reason: 'Dipakai QC',
    },
  });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
});

test('dialog masuk: alasan opsional dan hitungan lembar dikirim sebagai count', async () => {
  const { onWrite } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Catat masuk Hijau-B' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Bandung (BDG)');
  await pickSelect(within(dialog), 'Cara input', 'Hitung lembar');
  await userEvent.type(within(dialog).getByLabelText('Lembar baris 1'), '10');
  await userEvent.type(within(dialog).getByLabelText('Isi per lembar baris 1'), '12');
  await userEvent.type(within(dialog).getByLabelText('Butir lepas'), '5');
  expect(within(dialog).getByText('125 butir')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onWrite).toHaveBeenCalledWith({
    type: 'record',
    input: {
      locationId: 'l-b',
      stickerId: 's1',
      kind: 'in',
      count: { rows: [{ sheets: 10, perSheet: 12 }], loose: 5 },
      reason: '',
    },
  });
});

test('galat server tampil pada field jumlah dan dialog tetap terbuka', async () => {
  const { onWrite } = renderPage();
  onWrite.mockResolvedValueOnce({
    message: 'Stok tidak cukup',
    quantity: 'Stok tidak cukup',
  });
  await userEvent.click(screen.getByRole('button', { name: 'Catat keluar Segel Polos' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  await userEvent.type(within(dialog).getByLabelText('Jumlah butir'), '99');
  await userEvent.type(within(dialog).getByLabelText('Alasan'), 'Uji');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Stok tidak cukup');
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});

test('koreksi: perubahan bertanda dan alasan wajib', async () => {
  const { onWrite } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Koreksi Hijau-B' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  await userEvent.type(within(dialog).getByLabelText('Perubahan (butir)'), '-5');
  await userEvent.type(within(dialog).getByLabelText('Alasan'), 'Rusak');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onWrite).toHaveBeenCalledWith({
    type: 'adjust',
    input: { locationId: 'l-a', stickerId: 's1', delta: -5, reason: 'Rusak' },
  });
});

test('koreksi tanpa perubahan atau tanpa alasan tidak dikirim', async () => {
  const { onWrite } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Koreksi Hijau-B' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onWrite).not.toHaveBeenCalled();
  expect(await within(dialog).findByText('Perubahan wajib diisi (bukan 0)')).toBeInTheDocument();
  expect(within(dialog).getByText('Alasan wajib diisi')).toBeInTheDocument();
});

test('opname mengirim expectedQty yang dilihat halaman dan hanya baris yang dihitung', async () => {
  const { onOpname } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Stok opname' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  expect(within(dialog).getByText('Tercatat 120')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hitung Hijau-B' }));
  await userEvent.type(within(dialog).getByLabelText('Butir lepas'), '7');
  expect(within(dialog).getByText('Selisih -113')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan opname' }));
  expect(onOpname).toHaveBeenCalledWith({
    rows: [
      {
        stickerId: 's1',
        locationId: 'l-a',
        expectedQty: 120,
        count: { rows: [], loose: 7 },
      },
    ],
  });
});

test('opname ditolak usang: pesan hitung ulang, lalu Hitung ulang memakai stok terbaru', async () => {
  const { onOpname } = renderPage();
  onOpname.mockResolvedValueOnce({
    message: 'Stok berubah sejak dihitung; hitung ulang',
    stale: true,
  });
  await userEvent.click(screen.getByRole('button', { name: 'Stok opname' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hitung Hijau-B' }));
  await userEvent.type(within(dialog).getByLabelText('Butir lepas'), '7');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan opname' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Stok berubah sejak dihitung; hitung ulang',
  );
  expect(within(dialog).queryByRole('button', { name: 'Simpan opname' })).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hitung ulang' }));
  expect(within(dialog).queryByRole('alert')).toBeNull();
  expect(within(dialog).getByRole('button', { name: 'Hitung Hijau-B' })).toBeInTheDocument();
});

test('opname tanpa baris yang dihitung tidak dapat dikirim', async () => {
  const { onOpname } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Stok opname' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  expect(within(dialog).getByRole('button', { name: 'Simpan opname' })).toBeDisabled();
  expect(onOpname).not.toHaveBeenCalled();
});

test('stiker Usang tampil dengan badge dan tanpa tombol Masuk; Keluar dan Koreksi tetap ada', () => {
  const [first] = rows as [StickerStockDto];
  renderPage({ rows: [{ ...first, status: 'deprecated' }] });
  const row = screen.getByRole('row', { name: /Hijau-B/ });
  expect(within(row).getByText('Usang')).toBeInTheDocument();
  expect(within(row).queryByText('Nonaktif')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Catat masuk Hijau-B' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Catat keluar Hijau-B' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Koreksi Hijau-B' })).toBeInTheDocument();
});
