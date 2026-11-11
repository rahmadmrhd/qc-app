import type { BusinessUnitOptionDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { linkOptionNames, pickLink } from '@/test/link-field';
import { stickerSaveFailure } from './sticker-form-dialog';
import { StickersPage } from './stickers-page';

vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => vi.fn() }));
vi.mock('@/modules/item/components/image-thumb', () => ({ ImageThumb: () => null }));

const types: StickerTypeDto[] = [
  {
    id: 'tp-bu',
    name: 'QC Hijau',
    rule: 'bu',
    status: 'active',
    stickerCount: 2,
    systemKind: '',
    defaultMinQty: 0,
    updatedAt: '',
  },
  {
    id: 'tp-none',
    name: 'Segel',
    rule: 'none',
    status: 'active',
    stickerCount: 1,
    systemKind: '',
    defaultMinQty: 0,
    updatedAt: '',
  },
  {
    id: 'tp-old',
    name: 'Lawas',
    rule: 'none',
    status: 'inactive',
    stickerCount: 0,
    systemKind: '',
    defaultMinQty: 0,
    updatedAt: '',
  },
];

const businessUnits: BusinessUnitOptionDto[] = [
  { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'active' },
  { id: 'bu-b', code: 'WHL', name: 'Wholesale', status: 'active' },
];

function sticker(overrides: Partial<StickerDto>): StickerDto {
  return {
    id: 's1',
    typeId: 'tp-bu',
    typeName: 'QC Hijau',
    name: 'QC Hijau Besar',
    alias: '',
    fileId: null,
    minQty: 0,
    status: 'active',
    businessUnitIds: ['bu-a'],
    low: false,
    updatedAt: '2026-11-09 11:00:00',
    ...overrides,
  };
}

const stickers: StickerDto[] = [
  sticker({
    id: 's1',
    alias: 'Hijau-B',
    minQty: 100,
    low: true,
    businessUnitIds: ['bu-a', 'bu-b'],
  }),
  sticker({
    id: 's2',
    typeId: 'tp-none',
    typeName: 'Segel',
    name: 'Segel Polos',
    businessUnitIds: [],
    status: 'inactive',
  }),
];

function renderPage(props: Partial<Parameters<typeof StickersPage>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue(null);
  const onToggleStatus = vi.fn();
  render(
    <StickersPage
      stickers={stickers}
      types={types}
      businessUnits={businessUnits}
      canEdit
      canManage
      pendingStatusId={null}
      onSave={onSave}
      onToggleStatus={onToggleStatus}
      {...props}
    />,
  );
  return { onSave, onToggleStatus };
}

test('alias menggantikan nama pada tampilan; tanpa alias memakai nama', () => {
  renderPage();
  const first = screen.getByRole('row', { name: /Hijau-B/ });
  expect(within(first).getByText('Hijau-B')).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /Segel Polos/ })).toBeInTheDocument();
});

test('menampilkan jenis, BU sebagai chip, batas minimum, dan status', () => {
  renderPage();
  const first = screen.getByRole('row', { name: /Hijau-B/ });
  expect(within(first).getByText('QC Hijau')).toBeInTheDocument();
  expect(within(first).getByText('RTL')).toBeInTheDocument();
  expect(within(first).getByText('WHL')).toBeInTheDocument();
  expect(within(first).getByText('100')).toBeInTheDocument();
  expect(within(first).getByText('Aktif')).toBeInTheDocument();
  expect(
    within(screen.getByRole('row', { name: /Segel Polos/ })).getByText('Nonaktif'),
  ).toBeInTheDocument();
});

test('penanda Menipis hanya muncul bila low', () => {
  renderPage();
  expect(
    within(screen.getByRole('row', { name: /Hijau-B/ })).getByText('Menipis'),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole('row', { name: /Segel Polos/ })).queryByText('Menipis'),
  ).toBeNull();
});

test('filter jenis dan status menyaring baris', async () => {
  renderPage();
  await userEvent.selectOptions(screen.getByLabelText('Filter jenis'), 'tp-none');
  expect(screen.queryByRole('row', { name: /Hijau-B/ })).toBeNull();
  expect(screen.getByRole('row', { name: /Segel Polos/ })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Filter jenis'), '');
  await userEvent.selectOptions(screen.getByLabelText('Filter status'), 'inactive');
  expect(screen.queryByRole('row', { name: /Hijau-B/ })).toBeNull();
  expect(screen.getByRole('row', { name: /Segel Polos/ })).toBeInTheDocument();
});

test('tombol mengikuti izin', () => {
  renderPage({ canEdit: false, canManage: false });
  expect(screen.queryByRole('button', { name: 'Tambah stiker' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ubah Hijau-B' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan Hijau-B' })).toBeNull();
});

test('menonaktifkan memanggil onToggleStatus', async () => {
  const { onToggleStatus } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan Hijau-B' }));
  expect(onToggleStatus).toHaveBeenCalledWith(stickers[0]);
  expect(screen.getByRole('button', { name: 'Aktifkan Segel Polos' })).toBeInTheDocument();
});

test('dialog tambah: field BU hanya untuk jenis berrule bu, tersembunyi untuk jenis none', async () => {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog');
  // Jenis nonaktif tidak ditawarkan.
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Jenis' }));
  expect(await within(dialog).findByRole('option', { name: 'QC Hijau' })).toBeInTheDocument();
  expect(within(dialog).queryByRole('option', { name: 'Lawas' })).toBeNull();
  expect(within(dialog).queryByRole('combobox', { name: 'BU' })).toBeNull();
  await pickLink(within(dialog), 'Jenis', 'QC Hijau');
  expect(within(dialog).getByRole('combobox', { name: 'BU' })).toBeInTheDocument();
  await pickLink(within(dialog), 'Jenis', 'Segel');
  expect(within(dialog).queryByRole('combobox', { name: 'BU' })).toBeNull();
});

test('tambah stiker jenis none mengirim BU kosong', async () => {
  const { onSave } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Jenis', 'Segel');
  await userEvent.type(within(dialog).getByLabelText('Nama stiker'), 'Segel Baru');
  await userEvent.type(within(dialog).getByLabelText('Alias'), 'SB');
  await userEvent.type(within(dialog).getByLabelText('Batas minimum'), '50');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({
    typeId: 'tp-none',
    name: 'Segel Baru',
    alias: 'SB',
    fileId: null,
    minQty: 50,
    businessUnitIds: [],
  });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
});

test('tambah stiker jenis bu: menautkan dua BU dan mengirimnya', async () => {
  const { onSave } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Jenis', 'QC Hijau');
  await userEvent.type(within(dialog).getByLabelText('Nama stiker'), 'Hijau Kecil');
  for (const name of ['Retail (RTL)', 'Wholesale (WHL)']) {
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'BU' }));
    await userEvent.click(await screen.findByRole('option', { name }));
    await userEvent.keyboard('{Escape}');
  }
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({
    typeId: 'tp-bu',
    name: 'Hijau Kecil',
    alias: '',
    fileId: null,
    minQty: 0,
    businessUnitIds: ['bu-a', 'bu-b'],
  });
});

test('mengganti jenis dari bu ke non-bu mengosongkan BU yang sudah dipilih (payload tanpa BU)', async () => {
  const { onSave } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Jenis', 'QC Hijau');
  await pickLink(within(dialog), 'BU', 'Retail (RTL)');
  await pickLink(within(dialog), 'Jenis', 'Segel');
  expect(within(dialog).queryByRole('combobox', { name: 'BU' })).toBeNull();
  // Kembali ke jenis bu: pilihan BU lama tidak boleh muncul lagi.
  await pickLink(within(dialog), 'Jenis', 'QC Hijau');
  expect(within(dialog).queryByText('Retail (RTL)')).toBeNull();
  await pickLink(within(dialog), 'Jenis', 'Segel');
  await userEvent.type(within(dialog).getByLabelText('Nama stiker'), 'Segel Baru');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave.mock.calls[0]?.[0]).toMatchObject({ typeId: 'tp-none', businessUnitIds: [] });
});

test('Simpan nonaktif selama jenis belum dipilih, dan aktif setelah jenis dikosongkan lalu dipilih lagi', async () => {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.type(within(dialog).getByLabelText('Nama stiker'), 'Tanpa Jenis');
  expect(within(dialog).getByRole('button', { name: 'Simpan' })).toBeDisabled();
  await pickLink(within(dialog), 'Jenis', 'Segel');
  expect(within(dialog).getByRole('button', { name: 'Simpan' })).toBeEnabled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kosongkan Jenis' }));
  expect(within(dialog).getByRole('button', { name: 'Simpan' })).toBeDisabled();
});

test('jenis bu tanpa BU tidak dikirim', async () => {
  const { onSave } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Jenis', 'QC Hijau');
  await userEvent.type(within(dialog).getByLabelText('Nama stiker'), 'Tanpa BU');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(await within(dialog).findByText('Pilih minimal satu BU')).toBeInTheDocument();
});

test('ubah stiker: jenis tidak dapat diubah (teks), data terisi, id ikut dikirim', async () => {
  const { onSave } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Hijau-B' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).queryByLabelText('Jenis')).toBeNull();
  expect(within(dialog).getByText('QC Hijau')).toBeInTheDocument();
  expect(within(dialog).getByLabelText('Nama stiker')).toHaveValue('QC Hijau Besar');
  expect(within(dialog).getByLabelText('Alias')).toHaveValue('Hijau-B');
  expect(within(dialog).getByLabelText('Batas minimum')).toHaveValue(100);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({
    id: 's1',
    expectedUpdatedAt: '2026-11-09 11:00:00',
    typeId: 'tp-bu',
    name: 'QC Hijau Besar',
    alias: 'Hijau-B',
    fileId: null,
    minQty: 100,
    businessUnitIds: ['bu-a', 'bu-b'],
  });
});

test('membuat stiker baru tidak mengirim expectedUpdatedAt', async () => {
  const { onSave } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Jenis', 'Segel');
  await userEvent.type(within(dialog).getByLabelText('Nama stiker'), 'Baru');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('expectedUpdatedAt');
});

test('versi usang (412) dijawab pesan jelas dan dialog tetap terbuka', async () => {
  const { onSave } = renderPage();
  onSave.mockResolvedValueOnce(
    stickerSaveFailure(new ApiError('CONFLICT', 'basi', 'r1', undefined, { status: 412 })),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Hijau-B' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Data sudah diubah orang lain; muat ulang lalu ulangi',
  );
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});

test('konflik nama (409) bukan versi usang: pesan servernya dipertahankan', () => {
  const failure = stickerSaveFailure(
    new ApiError(
      'CONFLICT',
      'Nama stiker sudah dipakai',
      'r1',
      { name: 'Nama stiker sudah dipakai' },
      {
        status: 409,
      },
    ),
  );
  expect(failure.name).toBe('Nama stiker sudah dipakai');
  expect(failure.message).not.toMatch(/diubah orang lain/);
});

test('pesan konflik nama dari server tampil pada field nama dan dialog tetap terbuka', async () => {
  const { onSave } = renderPage();
  onSave.mockResolvedValueOnce({
    message: 'Nama stiker sudah dipakai pada jenis ini',
    name: 'Nama stiker sudah dipakai pada jenis ini',
  });
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Jenis', 'Segel');
  await userEvent.type(within(dialog).getByLabelText('Nama stiker'), 'Segel Polos');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  const alert = await within(dialog).findByRole('alert');
  expect(alert).toHaveTextContent('Nama stiker sudah dipakai pada jenis ini');
  expect(within(dialog).getByLabelText('Nama stiker')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});

test('field Jenis memakai LinkField: Tambah Jenis hanya muncul bila user berhak', async () => {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  let dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Jenis' }));
  expect(within(dialog).queryByRole('option', { name: 'Tambah Jenis' })).toBeNull();
  // Jenis nonaktif tidak ditawarkan.
  expect(within(dialog).queryByRole('option', { name: 'Lawas' })).toBeNull();
  cleanup();

  renderPage({ onCreateType: vi.fn() });
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Jenis' }));
  expect(within(dialog).getByRole('option', { name: 'Tambah Jenis' })).toBeInTheDocument();
});

test('Tambah Jenis membuat jenis lewat dialog turunan dan langsung memilihnya (aturan bu memunculkan field BU)', async () => {
  const created: StickerTypeDto = {
    id: 'tp-baru',
    name: 'Warna Baru',
    rule: 'bu',
    status: 'active',
    stickerCount: 0,
    systemKind: '',
    defaultMinQty: 0,
    updatedAt: '',
  };
  const onCreateType = vi.fn().mockResolvedValue(created);
  const { onSave } = renderPage({ onCreateType });
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Tambah stiker' });
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Jenis' }));
  await userEvent.click(await within(dialog).findByRole('option', { name: 'Tambah Jenis' }));
  const typeDialog = await screen.findByRole('alertdialog', { name: 'Tambah jenis stiker' });
  await userEvent.type(within(typeDialog).getByLabelText('Nama jenis'), 'Warna Baru');
  await userEvent.click(within(typeDialog).getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onCreateType).toHaveBeenCalledTimes(1));
  expect(onCreateType.mock.calls[0]?.[0]).toMatchObject({ name: 'Warna Baru' });
  const form = await screen.findByRole('alertdialog', { name: 'Tambah stiker' });
  expect(within(form).getByRole('combobox', { name: 'Jenis' })).toHaveValue('Warna Baru');
  // Aturan jenis baru (bu) langsung terbaca tanpa menunggu muat ulang daftar jenis.
  expect(within(form).getByRole('combobox', { name: 'BU' })).toBeInTheDocument();
  await userEvent.type(within(form).getByLabelText('Nama stiker'), 'Stiker Baru');
  await pickLink(within(form), 'BU', 'Retail (RTL)');
  await userEvent.click(within(form).getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0]?.[0]).toMatchObject({
    typeId: 'tp-baru',
    businessUnitIds: ['bu-a'],
  });
});

test('field BU di form stiker: Buka dan Tambah BU hanya muncul bila disediakan', async () => {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  let dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Jenis', 'QC Hijau');
  await pickLink(within(dialog), 'BU', 'Retail (RTL)');
  expect(within(dialog).queryByRole('link', { name: /Buka/ })).toBeNull();
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'BU' }));
  expect(within(dialog).queryByRole('option', { name: 'Tambah BU' })).toBeNull();
  cleanup();

  renderPage({
    openBusinessUnitHref: (id) => `/access/business-units/${id}`,
    onCreateBusinessUnit: vi.fn(),
  });
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Jenis', 'QC Hijau');
  await pickLink(within(dialog), 'BU', 'Retail (RTL)');
  expect(within(dialog).getByRole('link', { name: 'Buka Retail (RTL)' })).toHaveAttribute(
    'href',
    '/access/business-units/bu-a',
  );
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'BU' }));
  expect(within(dialog).getByRole('option', { name: 'Tambah BU' })).toBeInTheDocument();
});

const manualBookType: StickerTypeDto = {
  id: 'tp-mb',
  name: 'Manual Book',
  rule: 'group',
  status: 'active',
  stickerCount: 2,
  systemKind: 'manual_book',
  defaultMinQty: 50,
  updatedAt: '',
};

const manualBookStickers: StickerDto[] = [
  sticker({
    id: 'mb1',
    typeId: 'tp-mb',
    typeName: 'Manual Book',
    name: 'PBE M5-400 v1',
    businessUnitIds: [],
    status: 'deprecated',
  }),
  sticker({
    id: 'mb2',
    typeId: 'tp-mb',
    typeName: 'Manual Book',
    name: 'PBE M5-400 v2',
    businessUnitIds: [],
    minQty: 20,
  }),
];

test('status Usang tampil sebagai badge, dapat disaring, dan hanya dapat dinonaktifkan (tanpa Aktifkan)', async () => {
  renderPage({
    stickers: [...stickers, ...manualBookStickers],
    types: [...types, manualBookType],
  });
  const usang = screen.getByRole('row', { name: /PBE M5-400 v1/ });
  expect(within(usang).getByText('Usang')).toBeInTheDocument();
  // Usang bertahan "sampai stok 0 atau dinonaktifkan manual" (spek 4a): hanya ada Nonaktifkan.
  expect(screen.queryByRole('button', { name: 'Aktifkan PBE M5-400 v1' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Nonaktifkan PBE M5-400 v1' })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Filter status'), 'deprecated');
  expect(screen.getByRole('row', { name: /PBE M5-400 v1/ })).toBeInTheDocument();
  expect(screen.queryByRole('row', { name: /PBE M5-400 v2/ })).toBeNull();
  expect(screen.queryByRole('row', { name: /Hijau-B/ })).toBeNull();
});

test('pemilih jenis pada Tambah stiker tidak menawarkan jenis sistem', async () => {
  renderPage({ types: [...types, manualBookType] });
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(await linkOptionNames(within(dialog), 'Jenis')).toEqual(['QC Hijau', 'Segel']);
});

test('ubah stiker jenis sistem: nama, jenis, dan gambar terkunci; minimum dan alias dapat diubah', async () => {
  const { onSave } = renderPage({
    stickers: manualBookStickers,
    types: [manualBookType],
  });
  await userEvent.click(screen.getByRole('button', { name: 'Ubah PBE M5-400 v2' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByLabelText('Nama stiker')).toBeDisabled();
  expect(within(dialog).getByText(/dikelola aplikasi/i)).toBeInTheDocument();
  expect(
    within(dialog).queryByRole('button', { name: /Pilih gambar|Ganti gambar|Unggah/i }),
  ).toBeNull();
  await userEvent.type(within(dialog).getByLabelText('Alias'), 'MB');
  const min = within(dialog).getByLabelText('Batas minimum');
  await userEvent.clear(min);
  await userEvent.type(min, '30');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({
    id: 'mb2',
    expectedUpdatedAt: '2026-11-09 11:00:00',
    typeId: 'tp-mb',
    name: 'PBE M5-400 v2',
    alias: 'MB',
    fileId: null,
    minQty: 30,
    businessUnitIds: [],
  });
});

test('Nonaktifkan stiker Usang memanggil onToggleStatus dengan stikernya', async () => {
  const { onToggleStatus } = renderPage({
    stickers: manualBookStickers,
    types: [manualBookType],
  });
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan PBE M5-400 v1' }));
  expect(onToggleStatus).toHaveBeenCalledWith(manualBookStickers[0]);
});

test('stiker jenis sistem yang nonaktif tidak punya tombol Aktifkan (hanya boleh menjadi nonaktif)', () => {
  renderPage({
    stickers: [
      sticker({
        id: 'mb3',
        typeId: 'tp-mb',
        typeName: 'Manual Book',
        name: 'PBE M5-400 v3',
        businessUnitIds: [],
        status: 'inactive',
      }),
      ...stickers,
    ],
    types: [...types, manualBookType],
  });
  expect(screen.queryByRole('button', { name: 'Aktifkan PBE M5-400 v3' })).toBeNull();
  // stiker biasa yang nonaktif tetap dapat diaktifkan
  expect(screen.getByRole('button', { name: 'Aktifkan Segel Polos' })).toBeInTheDocument();
});
