import type { BusinessUnitOptionDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { closeFilterChip, linkOptionNames, pickLink, pickSelect } from '@/test/link-field';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { stickerSaveFailure } from './sticker-form-dialog';
import { type StickersFilter, StickersPage, type StickersPageProps } from './stickers-page';

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
    latestManualBookVersion: false,
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
    latestManualBookVersion: false,
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

afterEach(() => {
  cleanup();
});

function mutationsMock() {
  return {
    setStatus: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue([]),
    restore: vi.fn().mockResolvedValue([]),
    reload: vi.fn(),
  };
}

/** Pemegang state filter: search params Router digantikan state lokal agar tes cukup merender halaman. */
function Harness(props: Omit<StickersPageProps, 'filter' | 'onFilterChange'>) {
  const [filter, setFilter] = useState<StickersFilter>({ q: '', typeIds: [], status: 'all' });
  return (
    <StickersPage
      {...props}
      filter={filter}
      onFilterChange={(patch) => setFilter((current) => ({ ...current, ...patch }))}
    />
  );
}

async function openChip(label: string) {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}(:|$)`) }));
}

async function renderPage(props: Partial<StickersPageProps> = {}) {
  const onSave = vi.fn().mockResolvedValue(null);
  const onToggleStatus = vi.fn();
  const mutations = mutationsMock();
  await renderInRouter(
    <Harness
      stickers={stickers}
      types={types}
      businessUnits={businessUnits}
      canEdit
      canManage
      pendingStatusId={null}
      onSave={onSave}
      onToggleStatus={onToggleStatus}
      mutations={mutations}
      onStartOpname={vi.fn()}
      onStartEntry={vi.fn()}
      {...props}
    />,
  );
  return { onSave, onToggleStatus, mutations };
}

test('alias menggantikan nama pada tampilan; tanpa alias memakai nama', async () => {
  await renderPage();
  const first = screen.getByRole('row', { name: /Hijau-B/ });
  expect(within(first).getByText('Hijau-B')).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /Segel Polos/ })).toBeInTheDocument();
});

test('menampilkan jenis, BU sebagai chip, batas minimum, dan status', async () => {
  await renderPage();
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

test('penanda Menipis hanya muncul bila low', async () => {
  await renderPage();
  expect(
    within(screen.getByRole('row', { name: /Hijau-B/ })).getByText('Menipis'),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole('row', { name: /Segel Polos/ })).queryByText('Menipis'),
  ).toBeNull();
});

test('filter jenis dan status menyaring baris', async () => {
  await renderPage();
  await openChip('Jenis');
  await pickLink(screen, 'Filter jenis', 'Segel');
  await closeFilterChip();
  expect(screen.queryByRole('row', { name: /Hijau-B/ })).toBeNull();
  expect(screen.getByRole('row', { name: /Segel Polos/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus filter Jenis' }));
  await openChip('Status');
  await pickSelect(screen, 'Filter status', 'Nonaktif');
  expect(screen.queryByRole('row', { name: /Hijau-B/ })).toBeNull();
  expect(screen.getByRole('row', { name: /Segel Polos/ })).toBeInTheDocument();
});

test('filter jenis boleh lebih dari satu: baris dari kedua jenis tampil, chip menyebut keduanya', async () => {
  await renderPage();
  await openChip('Jenis');
  await pickLink(screen, 'Filter jenis', 'Segel');
  // Draf: baris belum disaring selagi chip terbuka.
  expect(screen.getByRole('row', { name: /Hijau-B/ })).toBeInTheDocument();
  await pickLink(screen, 'Filter jenis', 'QC Hijau');
  await closeFilterChip();
  expect(screen.getByRole('row', { name: /Hijau-B/ })).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /Segel Polos/ })).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /Jenis: .*Segel.*QC Hijau|Jenis: .*QC Hijau.*Segel/ }),
  ).toBeInTheDocument();
});

test('tombol mengikuti izin', async () => {
  await renderPage({ canEdit: false, canManage: false });
  expect(screen.queryByRole('button', { name: 'Tambah stiker' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ubah Hijau-B' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan Hijau-B' })).toBeNull();
});

test('menonaktifkan memanggil onToggleStatus', async () => {
  const { onToggleStatus } = await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan Hijau-B' }));
  expect(onToggleStatus).toHaveBeenCalledWith(stickers[0]);
  expect(screen.getByRole('button', { name: 'Aktifkan Segel Polos' })).toBeInTheDocument();
});

test('dialog tambah: field BU hanya untuk jenis berrule bu, tersembunyi untuk jenis none', async () => {
  await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog');
  // Jenis nonaktif tidak ditawarkan.
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Jenis' }));
  expect(await screen.findByRole('option', { name: 'QC Hijau' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Lawas' })).toBeNull();
  expect(within(dialog).queryByRole('combobox', { name: 'BU' })).toBeNull();
  await pickLink(within(dialog), 'Jenis', 'QC Hijau');
  expect(within(dialog).getByRole('combobox', { name: 'BU' })).toBeInTheDocument();
  await pickLink(within(dialog), 'Jenis', 'Segel');
  expect(within(dialog).queryByRole('combobox', { name: 'BU' })).toBeNull();
});

test('tambah stiker jenis none mengirim BU kosong', async () => {
  const { onSave } = await renderPage();
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
  const { onSave } = await renderPage();
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
  const { onSave } = await renderPage();
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
  await renderPage();
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
  const { onSave } = await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Jenis', 'QC Hijau');
  await userEvent.type(within(dialog).getByLabelText('Nama stiker'), 'Tanpa BU');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(await within(dialog).findByText('Pilih minimal satu BU')).toBeInTheDocument();
});

test('ubah stiker: jenis tidak dapat diubah (teks), data terisi, id ikut dikirim', async () => {
  const { onSave } = await renderPage();
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
  const { onSave } = await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Jenis', 'Segel');
  await userEvent.type(within(dialog).getByLabelText('Nama stiker'), 'Baru');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('expectedUpdatedAt');
});

test('versi usang (412) dijawab pesan jelas dan dialog tetap terbuka', async () => {
  const { onSave } = await renderPage();
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

test('konflik nama (409) bukan versi usang: pesan servernya dipertahankan', async () => {
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
  const { onSave } = await renderPage();
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
  await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  let dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Jenis' }));
  expect(screen.queryByRole('option', { name: 'Tambah Jenis' })).toBeNull();
  // Jenis nonaktif tidak ditawarkan.
  expect(screen.queryByRole('option', { name: 'Lawas' })).toBeNull();
  cleanup();

  await renderPage({ onCreateType: vi.fn() });
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Jenis' }));
  expect(screen.getByRole('option', { name: 'Tambah Jenis' })).toBeInTheDocument();
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
  const { onSave } = await renderPage({ onCreateType });
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Tambah stiker' });
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Jenis' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Tambah Jenis' }));
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
  await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  let dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Jenis', 'QC Hijau');
  await pickLink(within(dialog), 'BU', 'Retail (RTL)');
  expect(within(dialog).queryByRole('link', { name: /Buka/ })).toBeNull();
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'BU' }));
  expect(screen.queryByRole('option', { name: 'Tambah BU' })).toBeNull();
  cleanup();

  await renderPage({
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
  expect(screen.getByRole('option', { name: 'Tambah BU' })).toBeInTheDocument();
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
  await renderPage({
    stickers: [...stickers, ...manualBookStickers],
    types: [...types, manualBookType],
  });
  const usang = screen.getByRole('row', { name: /PBE M5-400 v1/ });
  expect(within(usang).getByText('Usang')).toBeInTheDocument();
  // Usang bertahan "sampai stok 0 atau dinonaktifkan manual" (spek 4a): hanya ada Nonaktifkan.
  expect(screen.queryByRole('button', { name: 'Aktifkan PBE M5-400 v1' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Nonaktifkan PBE M5-400 v1' })).toBeInTheDocument();
  await openChip('Status');
  await pickSelect(screen, 'Filter status', 'Usang');
  expect(screen.getByRole('row', { name: /PBE M5-400 v1/ })).toBeInTheDocument();
  expect(screen.queryByRole('row', { name: /PBE M5-400 v2/ })).toBeNull();
  expect(screen.queryByRole('row', { name: /Hijau-B/ })).toBeNull();
});

test('pemilih jenis pada Tambah stiker tidak menawarkan jenis sistem', async () => {
  await renderPage({ types: [...types, manualBookType] });
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(await linkOptionNames(within(dialog), 'Jenis')).toEqual(['QC Hijau', 'Segel']);
});

test('ubah stiker jenis sistem: nama, jenis, dan gambar terkunci; minimum dan alias dapat diubah', async () => {
  const { onSave } = await renderPage({
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
  const { onToggleStatus } = await renderPage({
    stickers: manualBookStickers,
    types: [manualBookType],
  });
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan PBE M5-400 v1' }));
  expect(onToggleStatus).toHaveBeenCalledWith(manualBookStickers[0]);
});

test('stiker jenis sistem yang nonaktif: Aktifkan hanya untuk versi terbaru konfigurasinya (keputusan pemilik 2026-11-11)', async () => {
  await renderPage({
    stickers: [
      sticker({
        id: 'mb3',
        typeId: 'tp-mb',
        typeName: 'Manual Book',
        name: 'PBE M5-400 v3',
        businessUnitIds: [],
        status: 'inactive',
      }),
      sticker({
        id: 'mb4',
        typeId: 'tp-mb',
        typeName: 'Manual Book',
        name: 'PBE M5-400 v4',
        businessUnitIds: [],
        status: 'inactive',
        latestManualBookVersion: true,
      }),
      ...stickers,
    ],
    types: [...types, manualBookType],
  });
  // versi lama (bukan terbaru) tak dapat diaktifkan kembali; versi terbaru yang dinonaktifkan dapat
  expect(screen.queryByRole('button', { name: 'Aktifkan PBE M5-400 v3' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Aktifkan PBE M5-400 v4' })).toBeInTheDocument();
  // stiker biasa yang nonaktif tetap dapat diaktifkan
  expect(screen.getByRole('button', { name: 'Aktifkan Segel Polos' })).toBeInTheDocument();
});

const postelType: StickerTypeDto = {
  id: 'tp-pt',
  name: 'Postel',
  rule: 'group',
  status: 'active',
  stickerCount: 1,
  systemKind: 'postel',
  defaultMinQty: 10,
  updatedAt: '',
};

const postelSticker = (overrides: Partial<StickerDto> = {}) =>
  sticker({
    id: 'pt1',
    typeId: 'tp-pt',
    typeName: 'Postel',
    name: 'Postel',
    businessUnitIds: [],
    fileId: 'f-lama',
    minQty: 10,
    ...overrides,
  });

test('ubah stiker Postel: hanya nama yang terkunci; gambar contoh tetap dapat diganti', async () => {
  const { onSave } = await renderPage({ stickers: [postelSticker()], types: [postelType] });
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Postel' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByLabelText('Nama stiker')).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: /Ganti gambar/ })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: /Hapus gambar contoh/ })).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText('Alias'), 'PT');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({
    id: 'pt1',
    expectedUpdatedAt: '2026-11-09 11:00:00',
    typeId: 'tp-pt',
    name: 'Postel',
    alias: 'PT',
    fileId: 'f-lama',
    minQty: 10,
    businessUnitIds: [],
  });
});

test('stiker Postel yang nonaktif dapat diaktifkan kembali oleh pengelola', async () => {
  const inactive = postelSticker({ status: 'inactive' });
  const { onToggleStatus } = await renderPage({ stickers: [inactive], types: [postelType] });
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan Postel' }));
  expect(onToggleStatus).toHaveBeenCalledWith(inactive);
});

test('Aktifkan stiker Postel nonaktif tidak tampil bagi non-pengelola', async () => {
  await renderPage({
    stickers: [postelSticker({ status: 'inactive' })],
    types: [postelType],
    canManage: false,
  });
  expect(screen.queryByRole('button', { name: 'Aktifkan Postel' })).toBeNull();
});

test('dialog tambah: Jenis dan Nama stiker wajib (aria-required); Alias opsional', async () => {
  await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByLabelText('Jenis')).toHaveAttribute('aria-required', 'true');
  expect(within(dialog).getByLabelText('Nama stiker')).toHaveAttribute('aria-required', 'true');
  expect(within(dialog).getByLabelText('Alias')).not.toHaveAttribute('aria-required');
});

test('nama stiker dan jenis menaut ke View; tidak ada tombol "Lihat"', async () => {
  await renderPage();
  expect(screen.getByRole('link', { name: 'Hijau-B' })).toHaveAttribute('href', '/sticker/s1');
  expect(screen.getByRole('link', { name: 'QC Hijau' })).toHaveAttribute(
    'href',
    '/sticker/types/tp-bu',
  );
  expect(screen.getByRole('link', { name: 'RTL' })).toHaveAttribute(
    'href',
    '/access/business-units/bu-a',
  );
  expect(screen.queryByRole('button', { name: /^Lihat/ })).toBeNull();
});

test('jenis terhapus tampil dengan penanda Terhapus', async () => {
  await renderPage({
    stickers: [sticker({ id: 's9', name: 'Stiker Jenis Hilang', typeDeleted: true })],
  });
  expect(
    within(screen.getByRole('row', { name: /Stiker Jenis Hilang/ })).getByText('Terhapus'),
  ).toBeInTheDocument();
});

test('pilih dua stiker lalu Aktifkan memanggil setStatus dengan dua id', async () => {
  const { mutations } = await renderPage();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Hijau-B' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Segel Polos' }));
  expect(screen.getByText('2 dipilih')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan' }));
  await waitFor(() => expect(mutations.setStatus).toHaveBeenCalledTimes(1));
  expect(mutations.setStatus).toHaveBeenCalledWith(['s1', 's2'], 'active');
});

test('tanpa izin kelola: tanpa checkbox dan aksi massal', async () => {
  await renderPage({ canManage: false });
  expect(screen.queryByRole('checkbox', { name: 'Pilih Hijau-B' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'Pilih semua' })).toBeNull();
});

test('Hapus: tak tampil untuk stiker Aktif dan stiker jenis sistem; tampil untuk nonaktif biasa', async () => {
  await renderPage({
    stickers: [
      ...stickers,
      sticker({
        id: 'mb9',
        typeId: 'tp-mb',
        typeName: 'Manual Book',
        name: 'PBE v9',
        businessUnitIds: [],
        status: 'deprecated',
      }),
    ],
    types: [...types, manualBookType],
  });
  expect(screen.queryByRole('button', { name: 'Hapus Hijau-B' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hapus PBE v9' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Hapus Segel Polos' })).toBeInTheDocument();
});

test('Hapus satu stiker: konfirmasi lalu memanggil remove dengan id-nya', async () => {
  const { mutations } = await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Segel Polos' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText('Hapus 1 stiker?')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(mutations.remove).toHaveBeenCalledWith(['s2']));
});

test('Hapus massal ditolak selama terpilih ada stiker Aktif; dua nonaktif dapat dihapus', async () => {
  const { mutations } = await renderPage({
    stickers: [
      ...stickers,
      sticker({
        id: 's3',
        name: 'Segel Lawas',
        alias: '',
        status: 'inactive',
        businessUnitIds: [],
      }),
    ],
  });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Hijau-B' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Segel Polos' }));
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Hijau-B' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Segel Lawas' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(mutations.remove).toHaveBeenCalledWith(['s2', 's3']));
});

test('tampilan Terhapus: hanya Pulihkan, tanpa kolom status dan "Tambah stiker"', async () => {
  const { mutations } = await renderPage({
    stickers: [
      sticker({
        id: 'd1',
        name: 'Stiker Dihapus',
        alias: '',
        status: 'inactive',
        deleted: { deletedAt: '2026-11-20T03:00:00.000Z', deletedBy: 'admin@x.com' },
      }),
    ],
  });
  await openChip('Status');
  await pickSelect(screen, 'Filter status', 'Terhapus');
  expect(screen.queryByRole('button', { name: 'Tambah stiker' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ubah Stiker Dihapus' })).toBeNull();
  expect(screen.getByRole('columnheader', { name: 'Dihapus oleh' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan Stiker Dihapus' }));
  await waitFor(() => expect(mutations.restore).toHaveBeenCalledWith(['d1']));
});

test('opsi status Terhapus hanya bagi pemegang kelola', async () => {
  await renderPage({ canManage: false });
  await openChip('Status');
  expect(await linkOptionNames(screen, 'Filter status')).not.toContain('Terhapus');
});

test('ponsel (360 px): kartu memuat judul tertaut, lencana status, dan meta berlabel; tanpa tabel', async () => {
  const media = mockMatchMedia(false);
  try {
    await renderPage();
    expect(screen.queryByRole('table')).toBeNull();
    const list = screen.getByRole('list', { name: 'Daftar stiker' });
    const card = within(list).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(card).getByRole('link', { name: 'Hijau-B' })).toBeInTheDocument();
    expect(within(card).getByText('Aktif')).toBeInTheDocument();
    expect(within(card).getByText('Jenis')).toBeInTheDocument();
    expect(within(card).getByText('Batas minimum')).toBeInTheDocument();
    // Aksi baris menjadi satu menu ⋯ berlabel.
    expect(within(card).getByRole('button', { name: 'Aksi Hijau-B' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Ubah Hijau-B' })).toBeNull();
  } finally {
    media.restore();
  }
});

const deletedAt = { deletedAt: '2026-11-20T03:00:00.000Z', deletedBy: 'admin@x.com' };

async function openDeletedView(extra: Partial<StickersPageProps>) {
  const rendered = await renderPage({
    types: [...types, manualBookType],
    stickers: [
      sticker({
        id: 'd1',
        name: 'Stiker Biasa Hilang',
        alias: '',
        status: 'inactive',
        deleted: deletedAt,
      }),
      sticker({
        id: 'd2',
        typeId: 'tp-mb',
        typeName: 'Manual Book',
        name: 'MB Hilang',
        alias: '',
        businessUnitIds: [],
        status: 'inactive',
        deleted: deletedAt,
      }),
    ],
    ...extra,
  });
  await openChip('Status');
  await pickSelect(screen, 'Filter status', 'Terhapus');
  return rendered;
}

test('tampilan Terhapus: Pulihkan tidak ditawarkan untuk stiker jenis sistem (server selalu menolak)', async () => {
  await openDeletedView({});
  expect(screen.getByRole('button', { name: 'Pulihkan Stiker Biasa Hilang' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Pulihkan MB Hilang' })).toBeNull();
});

test('Pulihkan massal ditahan beralasan bila pilihan memuat stiker jenis sistem', async () => {
  const { mutations } = await openDeletedView({});
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Stiker Biasa Hilang' }));
  expect(screen.getByRole('button', { name: 'Pulihkan' })).toBeEnabled();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih MB Hilang' }));
  expect(screen.getByRole('button', { name: 'Pulihkan' })).toBeDisabled();
  expect(
    screen.getByText(/dipulihkan lewat konfigurasi atau catatan induknya/),
  ).toBeInTheDocument();
  expect(mutations.restore).not.toHaveBeenCalled();
});

test('Aktifkan massal ditahan beralasan bila pilihan memuat stiker Usang atau Manual Book bukan versi terbaru', async () => {
  const { mutations } = await renderPage({
    types: [...types, manualBookType],
    stickers: [
      ...stickers,
      sticker({
        id: 'old',
        name: 'Segel Usang',
        alias: '',
        typeId: 'tp-none',
        typeName: 'Segel',
        businessUnitIds: [],
        status: 'deprecated',
      }),
      sticker({
        id: 'mb3',
        typeId: 'tp-mb',
        typeName: 'Manual Book',
        name: 'PBE v3',
        alias: '',
        businessUnitIds: [],
        status: 'inactive',
      }),
    ],
  });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Segel Polos' }));
  expect(screen.getByRole('button', { name: 'Aktifkan' })).toBeEnabled();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Segel Usang' }));
  expect(screen.getByRole('button', { name: 'Aktifkan' })).toBeDisabled();
  expect(screen.getByText('Stiker Usang tidak dapat diaktifkan kembali')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Segel Usang' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih PBE v3' }));
  expect(screen.getByRole('button', { name: 'Aktifkan' })).toBeDisabled();
  expect(screen.getByText(/Hanya versi terbaru Manual Book/)).toBeInTheDocument();
  expect(mutations.setStatus).not.toHaveBeenCalled();
});

test('jenis terhapus: nama + penanda tanpa tautan bagi non-pengelola, tautan bagi pengelola', async () => {
  const row = sticker({ id: 's9', name: 'Stiker Jenis Hilang', alias: '', typeDeleted: true });
  await renderPage({ stickers: [row], canManage: false });
  expect(
    within(screen.getByRole('row', { name: /Stiker Jenis Hilang/ })).queryByRole('link', {
      name: 'QC Hijau',
    }),
  ).toBeNull();
  cleanup();
  await renderPage({ stickers: [row], canManage: true });
  expect(
    within(screen.getByRole('row', { name: /Stiker Jenis Hilang/ })).getByRole('link', {
      name: 'QC Hijau',
    }),
  ).toBeInTheDocument();
});

test('field Jenis di form stiker memberi tautan Buka ke View jenis bila disediakan', async () => {
  await renderPage({ openStickerTypeHref: (id) => `/sticker/types/${id}` });
  await userEvent.click(screen.getAllByRole('button', { name: 'Tambah stiker' })[0] as HTMLElement);
  const form = await screen.findByRole('alertdialog', { name: 'Tambah stiker' });
  await pickLink(within(form), 'Jenis', 'Segel');
  expect(within(form).getByRole('link', { name: 'Buka Jenis' })).toHaveAttribute(
    'href',
    '/sticker/types/tp-none',
  );
});

test('ubah stiker: jenis menaut ke View jenis bila diizinkan, selain itu teks biasa', async () => {
  await renderPage({ openStickerTypeHref: (id) => `/sticker/types/${id}` });
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Hijau-B' }));
  const form = await screen.findByRole('alertdialog', { name: /Ubah stiker/ });
  expect(within(form).getByRole('link', { name: 'QC Hijau' })).toHaveAttribute(
    'href',
    '/sticker/types/tp-bu',
  );
});
