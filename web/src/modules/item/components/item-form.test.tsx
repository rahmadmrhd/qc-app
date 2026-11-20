import type { BrandDto, BusinessUnitOptionDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const galleryUploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/file-source', () => ({
  itemFileSource: {
    key: 'item-files',
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    upload: galleryUploadMock,
  },
}));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: 'data:image/png;base64,AAA', isLoading: false, isError: false }),
}));

import { linkOptionNames, pickSelect } from '@/test/link-field';
import { toItemFormDefaults } from '../schemas';
import { ItemForm } from './item-form';

const brands: BrandDto[] = [
  {
    id: 'b1',
    name: 'Ubiquiti',
    status: 'active',
    itemCount: 1,
    updatedAt: '',
    businessUnitIds: ['bu-a', 'bu-x'],
  },
  { id: 'b2', name: 'Lama', status: 'inactive', itemCount: 1, updatedAt: '', businessUnitIds: [] },
  {
    id: 'b3',
    name: 'Mikrotik',
    status: 'active',
    itemCount: 0,
    updatedAt: '',
    businessUnitIds: ['bu-b'],
  },
];

const businessUnits: BusinessUnitOptionDto[] = [
  { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'active' },
  { id: 'bu-b', code: 'WHL', name: 'Wholesale', status: 'active' },
  { id: 'bu-x', code: 'XTR', name: 'Xtra', status: 'active' },
  { id: 'bu-old', code: 'OLD', name: 'Lama', status: 'inactive' },
];

const GUIDES = [{ id: 'g1', name: 'Belakang', width: 800, height: 600 }];
const STICKERS: StickerDto[] = [
  {
    id: 's1',
    typeId: 't1',
    typeName: 'Postel',
    name: 'Stiker Postel',
    alias: '',
    fileId: null,
    minQty: 0,
    status: 'active',
    businessUnitIds: ['bu-a'],
    low: false,
    latestManualBookVersion: false,
    updatedAt: '',
  },
];
const STICKER_TYPES: StickerTypeDto[] = [
  {
    id: 't1',
    name: 'Postel',
    rule: 'bu',
    status: 'active',
    stickerCount: 1,
    systemKind: '',
    defaultMinQty: 0,
    updatedAt: '',
  },
];

// bu-x tidak boleh diisi user ini; bu-old nonaktif jadi tak pernah ditawarkan.
const editableBusinessUnitIds = ['bu-a', 'bu-b', 'bu-old'];

function renderForm(props: Partial<Parameters<typeof ItemForm>[0]> = {}) {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <ItemForm
      title="Form item"
      brands={brands}
      businessUnits={businessUnits}
      editableBusinessUnitIds={editableBusinessUnitIds}
      defaultValues={toItemFormDefaults()}
      onSubmit={onSubmit}
      onCancel={() => undefined}
      {...props}
    />,
  );
  return { onSubmit };
}

async function pickBrand(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  await userEvent.click(await screen.findByRole('option', { name }));
}

async function pickBusinessUnit(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'BU' }));
  await userEvent.click(await screen.findByRole('option', { name }));
  await userEvent.keyboard('{Escape}');
}

beforeEach(() => {
  galleryUploadMock.mockReset();
});

test('merk, BU, dan tipe wajib; tidak mengirim bila kosong', async () => {
  const { onSubmit } = renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Pilih minimal satu BU')).toBeInTheDocument();
  expect(screen.getAllByRole('alert').map((node) => node.textContent)).toContain('Pilih merk');
  expect(screen.getByText('Wajib diisi')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('mengirim brandId, businessUnitIds, dan nilai lengkap lainnya', async () => {
  const { onSubmit } = renderForm();
  await pickBrand('Mikrotik');
  await userEvent.type(screen.getByLabelText('Tipe'), 'ES 24 250W');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Country lock (wajib)' }));
  await userEvent.type(screen.getByLabelText('Nama lain'), 'ES24{enter}AirSwitch');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah kelengkapan' }));
  await userEvent.type(screen.getByLabelText('Nama kelengkapan 1'), 'Kabel daya');
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Detail dan spesifikasi' }),
    '## Spesifikasi',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({
      brandId: 'b3',
      businessUnitIds: ['bu-b'],
      model: 'ES 24 250W',
      isCountryLock: true,
      firmware: '',
      proofRequired: false,
      proofMin: 1,
      aliasesText: 'ES24\nAirSwitch',
      stickerPhotos: [],
      accessories: [{ name: 'Kabel daya', qty: 1 }],
      attachments: [],
      detail: '## Spesifikasi',
    }),
  );
});

test('memilih merk berBU-bawaan mengisi chip BU; BU bawaan di luar hak disaring', async () => {
  renderForm();
  await pickBrand('Ubiquiti');
  expect(screen.getByRole('button', { name: 'Hapus Retail (RTL)' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Hapus Xtra/ })).not.toBeInTheDocument();
});

test('mengganti merk (BU belum diubah manual) mengganti isian BU bawaan', async () => {
  renderForm();
  await pickBrand('Ubiquiti');
  await pickBrand('Mikrotik');
  expect(screen.getByRole('button', { name: 'Hapus Wholesale (WHL)' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus Retail (RTL)' })).not.toBeInTheDocument();
});

test('BU yang dipilih manual lebih dulu tidak ditimpa oleh BU bawaan merk', async () => {
  renderForm();
  await pickBusinessUnit('Wholesale (WHL)');
  await pickBrand('Ubiquiti');
  expect(screen.getByRole('button', { name: 'Hapus Wholesale (WHL)' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus Retail (RTL)' })).not.toBeInTheDocument();
});

test('chip BU dapat dilepas, dan setelah dilepas manual merk tidak mengisi ulang', async () => {
  renderForm();
  await pickBrand('Ubiquiti');
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Retail (RTL)' }));
  await pickBrand('Mikrotik');
  expect(screen.queryByRole('button', { name: /^Hapus / })).not.toBeInTheDocument();
});

test('pilihan BU hanya BU aktif yang boleh diisi user, tanpa yang sudah terpilih', async () => {
  renderForm();
  await userEvent.click(screen.getByRole('combobox', { name: 'BU' }));
  const names = (await screen.findAllByRole('option')).map((option) => option.textContent);
  expect(names).toEqual(['Retail (RTL)', 'Wholesale (WHL)']);
});

test('mode ubah: merk nonaktif tetap berlabel, BU nonaktif tampil sebagai chip yang dapat dilepas, mengganti merk tidak menimpa BU', async () => {
  renderForm({
    defaultValues: {
      ...toItemFormDefaults(),
      brandId: 'b2',
      businessUnitIds: ['bu-old', 'bu-a'],
      model: 'X',
    },
  });
  expect(screen.getByRole('combobox', { name: 'Merk' })).toHaveValue('Lama — nonaktif');
  expect(screen.getByRole('button', { name: 'Hapus Lama (OLD) — nonaktif' })).toBeInTheDocument();
  await pickBrand('Mikrotik');
  expect(screen.getByRole('button', { name: 'Hapus Retail (RTL)' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus Wholesale (WHL)' })).not.toBeInTheDocument();
  // BU nonaktif yang dilepas tidak muncul lagi sebagai pilihan tambah.
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Lama (OLD) — nonaktif' }));
  await userEvent.click(screen.getByRole('combobox', { name: 'BU' }));
  const names = (await screen.findAllByRole('option')).map((option) => option.textContent);
  expect(names).toEqual(['Wholesale (WHL)']);
});

test('merk nonaktif tidak ditawarkan pada item baru; pada item ber-merk nonaktif merk itu tetap ada di pilihan', async () => {
  const { unmount } = render(
    <ItemForm
      title="Form item"
      brands={brands}
      defaultValues={toItemFormDefaults()}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
    'Ubiquiti',
    'Mikrotik',
  ]);
  unmount();
  renderForm({ defaultValues: { ...toItemFormDefaults(), brandId: 'b2' } });
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
    'Ubiquiti',
    'Lama — nonaktif',
    'Mikrotik',
  ]);
});

test('baris Tambah merk hanya ada bila onCreateBrand disediakan', async () => {
  const { unmount } = render(
    <ItemForm
      title="Form item"
      brands={brands}
      defaultValues={toItemFormDefaults()}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  expect(screen.queryByRole('option', { name: 'Tambah Merk' })).not.toBeInTheDocument();
  unmount();
  renderForm({ onCreateBrand: vi.fn() });
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  expect(screen.getByRole('option', { name: 'Tambah Merk' })).toBeInTheDocument();
});

test('menambah merk lewat dialog: merk baru langsung terpilih tanpa mengirim form item', async () => {
  const created: BrandDto = {
    id: 'b9',
    name: 'Baru',
    status: 'active',
    itemCount: 0,
    updatedAt: '',
    businessUnitIds: ['bu-b'],
  };
  const onCreateBrand = vi.fn(async () => created);
  const { onSubmit } = renderForm({ onCreateBrand });
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah Merk' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.type(within(dialog).getByLabelText('Nama merk'), 'Baru');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(onCreateBrand).toHaveBeenCalledWith({ name: 'Baru', businessUnitIds: [] }),
  );
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(screen.getByRole('combobox', { name: 'Merk' })).toHaveValue('Baru');
  expect(screen.getByRole('button', { name: 'Hapus Wholesale (WHL)' })).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.queryByText('Pilih merk')).not.toBeInTheDocument();
});

test('galat saat membuat merk tampil di dialog dan merk tidak terpilih', async () => {
  const onCreateBrand = vi.fn(async () => {
    throw new Error('Nama merk sudah dipakai');
  });
  renderForm({ onCreateBrand });
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah Merk' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.type(within(dialog).getByLabelText('Nama merk'), 'Ubiquiti');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Merk', hidden: true })).toHaveValue('');
});

test('user tanpa BU aktif ber-edit melihat pesan di bawah field BU', () => {
  renderForm({ editableBusinessUnitIds: [] });
  expect(screen.getByText('Belum ada BU yang dapat Anda isi; hubungi admin.')).toBeInTheDocument();
});

test('pesan "belum ada BU" tidak tampil bila ada BU yang dapat diisi', () => {
  renderForm();
  expect(screen.queryByText(/Belum ada BU yang dapat Anda isi/)).not.toBeInTheDocument();
});

test('pesan galat instruksi stiker dan kelengkapan bernomor tampil di bagiannya', async () => {
  renderForm({
    defaultValues: {
      ...toItemFormDefaults(),
      businessUnitIds: ['bu-a'],
      stickerPhotos: [
        {
          guideId: 'g1',
          caption: '',
          buId: null,
          marks: [{ x: 500, y: 500, target: { kind: 'sticker', stickerId: '' }, note: '' }],
        },
      ],
    },
    guides: GUIDES,
  });
  await userEvent.type(screen.getByLabelText('Tipe'), 'B');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah kelengkapan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Pilih stiker atau jenis')).toBeInTheDocument();
  expect(screen.getByText('Kelengkapan 1: nama wajib diisi')).toBeInTheDocument();
});

test('bagian Instruksi stiker memuat foto item, penanda, dan sasaran dari katalog', () => {
  renderForm({
    defaultValues: {
      ...toItemFormDefaults(),
      businessUnitIds: ['bu-a'],
      stickerPhotos: [
        {
          guideId: 'g1',
          caption: 'Belakang kardus',
          buId: 'bu-a',
          marks: [{ x: 100, y: 200, target: { kind: 'sticker', stickerId: 's1' }, note: 'Pojok' }],
        },
      ],
    },
    stickers: STICKERS,
    stickerTypes: STICKER_TYPES,
    guides: GUIDES,
  });
  expect(screen.getByRole('heading', { name: 'Instruksi stiker' })).toBeInTheDocument();
  const card = screen.getByRole('group', { name: 'Foto instruksi 1' });
  expect(within(card).getByRole('textbox', { name: 'Catatan foto 1' })).toHaveValue(
    'Belakang kardus',
  );
  expect(within(card).getByRole('combobox', { name: 'Label BU foto 1' })).toHaveValue(
    'Retail (RTL)',
  );
  expect(within(card).getByRole('combobox', { name: 'Stiker' })).toHaveValue('Stiker Postel');
  expect(screen.queryByRole('button', { name: 'Tambah stiker' })).not.toBeInTheDocument();
});

test('melepas BU item mengosongkan label BU foto yang memakainya', async () => {
  renderForm({
    defaultValues: {
      ...toItemFormDefaults(),
      businessUnitIds: ['bu-a', 'bu-b'],
      stickerPhotos: [{ guideId: 'g1', caption: '', buId: 'bu-a', marks: [] }],
    },
    guides: GUIDES,
  });
  const label = screen.getByRole('combobox', { name: 'Label BU foto 1' });
  expect(label).toHaveValue('Retail (RTL)');
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Retail (RTL)' }));
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Label BU foto 1' })).toHaveValue(''),
  );
});

test('Tambah jenis dari penanda: dialog jenis, jenis baru langsung terpilih tanpa mengirim form item', async () => {
  const created: StickerTypeDto = {
    id: 't9',
    name: 'Segel',
    rule: 'none',
    status: 'active',
    stickerCount: 0,
    systemKind: '',
    defaultMinQty: 0,
    updatedAt: '',
  };
  const onCreateStickerType = vi.fn(async () => created);
  const { onSubmit } = renderForm({
    defaultValues: {
      ...toItemFormDefaults(),
      businessUnitIds: ['bu-a'],
      stickerPhotos: [
        {
          guideId: 'g1',
          caption: '',
          buId: null,
          marks: [{ x: 500, y: 500, target: { kind: 'type', typeId: '' }, note: '' }],
        },
      ],
    },
    stickerTypes: STICKER_TYPES,
    guides: GUIDES,
    onCreateStickerType,
  });
  await userEvent.click(screen.getByRole('combobox', { name: 'Jenis' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah Jenis' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.type(within(dialog).getByLabelText('Nama jenis'), 'Segel');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(onCreateStickerType).toHaveBeenCalledWith({ name: 'Segel', rule: 'bu' }),
  );
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(screen.getByRole('combobox', { name: 'Jenis' })).toHaveValue('Jenis Segel');
  expect(onSubmit).not.toHaveBeenCalled();
});

test('tanpa pembuat stiker/jenis, baris Tambah tidak ada pada penanda', async () => {
  renderForm({
    defaultValues: {
      ...toItemFormDefaults(),
      businessUnitIds: ['bu-a'],
      stickerPhotos: [
        {
          guideId: 'g1',
          caption: '',
          buId: null,
          marks: [{ x: 500, y: 500, target: { kind: 'sticker', stickerId: '' }, note: '' }],
        },
      ],
    },
    stickers: STICKERS,
    guides: GUIDES,
  });
  await userEvent.click(screen.getByRole('combobox', { name: 'Stiker' }));
  expect(screen.queryByRole('option', { name: 'Tambah Stiker' })).not.toBeInTheDocument();
});

test('galat per field dari server tampil di bawah field terkait dan galat umum sebagai alert', () => {
  renderForm({
    fieldErrors: {
      brandId: 'Merk tidak ditemukan',
      businessUnitIds: 'BU tidak dikenal',
      model: 'Merk dan tipe sama dengan nama lain item lain',
      aliases: 'Nama lain "ES24" sudah dipakai item lain',
    },
    submitError: 'Terjadi kesalahan',
  });
  expect(screen.getByText('Merk tidak ditemukan')).toBeInTheDocument();
  expect(screen.getByText('BU tidak dikenal')).toBeInTheDocument();
  expect(screen.getByText('Merk dan tipe sama dengan nama lain item lain')).toBeInTheDocument();
  expect(screen.getByText('Nama lain "ES24" sudah dipakai item lain')).toBeInTheDocument();
  expect(screen.getAllByRole('alert').map((node) => node.textContent)).toContain(
    'Terjadi kesalahan',
  );
});

test('mode ubah memuat nilai awal', () => {
  renderForm({
    defaultValues: {
      ...toItemFormDefaults(),
      brandId: 'b1',
      businessUnitIds: ['bu-a'],
      model: 'AF 5XHD',
      isCountryLock: true,
      aliasesText: 'AirFiber',
      attachments: ['a', 'b'],
      detail: '# isi',
    },
  });
  expect(screen.getByRole('combobox', { name: 'Merk' })).toHaveValue('Ubiquiti');
  expect(screen.getByRole('button', { name: 'Hapus Retail (RTL)' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Country lock (wajib)' })).toBeChecked();
  expect(screen.getByLabelText('Nama lain')).toHaveValue('AirFiber');
  expect(screen.getByText('2/10')).toBeInTheDocument();
  expect(
    within(screen.getByRole('group', { name: 'Gambar lampiran' })).getAllByRole('img'),
  ).toHaveLength(2);
});

test('galat server pada sebuah field hilang begitu user mengoreksi field itu; field lain tetap', async () => {
  renderForm({
    defaultValues: { ...toItemFormDefaults(), brandId: 'b1', model: 'ES 24' },
    fieldErrors: {
      model: 'Merk dan tipe sama dengan nama lain item lain',
      brandId: 'Merk tidak ditemukan',
      aliases: 'Nama lain bentrok',
    },
  });
  expect(screen.getByText('Merk dan tipe sama dengan nama lain item lain')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Tipe'), ' V2');
  expect(screen.queryByText('Merk dan tipe sama dengan nama lain item lain')).toBeNull();
  expect(screen.getByText('Nama lain bentrok')).toBeInTheDocument();
  await pickBrand('Mikrotik');
  expect(screen.queryByText('Merk tidak ditemukan')).toBeNull();
});

test('galeri memberi alt yang memuat nama item', () => {
  renderForm({
    defaultValues: {
      ...toItemFormDefaults(),
      brandId: 'b1',
      model: 'ES 24',
      attachments: ['f1'],
    },
  });
  expect(screen.getByAltText('Gambar 1 Ubiquiti ES 24')).toBeInTheDocument();
});

test('mengetik di field Merk menyaring daftar; klik opsi memilih merk dan mengisi BU bawaan', async () => {
  renderForm();
  await userEvent.type(screen.getByRole('combobox', { name: 'Merk' }), 'mikro');
  await waitFor(() =>
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Mikrotik']),
  );
  await userEvent.click(screen.getByRole('option', { name: 'Mikrotik' }));
  expect(screen.getByRole('combobox', { name: 'Merk' })).toHaveValue('Mikrotik');
  expect(screen.getByRole('button', { name: 'Hapus Wholesale (WHL)' })).toBeInTheDocument();
});

test('tanpa izin: baris Tambah BU dan tautan buka merk/BU tidak muncul', async () => {
  renderForm({
    defaultValues: { ...toItemFormDefaults(), brandId: 'b1', businessUnitIds: ['bu-a'] },
  });
  await userEvent.click(screen.getByRole('combobox', { name: 'BU' }));
  expect(screen.queryByRole('option', { name: 'Tambah BU' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /^Buka / })).not.toBeInTheDocument();
});

test('dengan izin: tombol buka merk dan label chip BU mengarah ke halaman lihat record', () => {
  renderForm({
    defaultValues: { ...toItemFormDefaults(), brandId: 'b1', businessUnitIds: ['bu-a'] },
    openBrandHref: (id) => `/item/brands/${id}`,
    openBusinessUnitHref: (id) => `/access/business-units/${id}`,
  });
  expect(screen.getByRole('link', { name: 'Buka Merk' })).toHaveAttribute(
    'href',
    '/item/brands/b1',
  );
  expect(screen.getByRole('link', { name: 'Buka Retail (RTL)' })).toHaveAttribute(
    'href',
    '/access/business-units/bu-a',
  );
});

test('Tambah BU lewat dialog: BU baru langsung terpilih tanpa mengirim form item', async () => {
  const onCreateBusinessUnit = vi.fn().mockResolvedValue({
    id: 'bu-new',
    code: 'NEW',
    name: 'Baru',
    status: 'active',
    itemCount: 0,
    userCount: 0,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
  });
  const { onSubmit } = renderForm({ onCreateBusinessUnit });
  await userEvent.click(screen.getByRole('combobox', { name: 'BU' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah BU' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.type(within(dialog).getByLabelText('Kode'), 'new');
  await userEvent.type(within(dialog).getByLabelText('Nama'), 'Baru');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(onCreateBusinessUnit).toHaveBeenCalledWith({ code: 'NEW', name: 'Baru' }),
  );
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Hapus Baru (NEW)' })).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('firmware: kolom hanya muncul saat Country lock dicentang; pilihan menurut merk; ikut terkirim', async () => {
  const { onSubmit } = renderForm();
  expect(screen.queryByRole('combobox', { name: 'Firmware' })).not.toBeInTheDocument();
  await pickBrand('Ubiquiti');
  await userEvent.type(screen.getByLabelText('Tipe'), 'AF-5XHD');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Country lock (wajib)' }));
  const names = await linkOptionNames(screen, 'Firmware');
  expect(names).toContain('AF-5XHD');
  expect(names).toContain('WA Firmware');
  expect(names).not.toContain('5GHz'); // milik Mikrotik
  await pickSelect(screen, 'Firmware', 'AF-5XHD');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'b1', isCountryLock: true, firmware: 'af5xhd' }),
    ),
  );
});

test('firmware dikosongkan saat Country lock dimatikan atau merk diganti ke merk yang kodenya tak berlaku', async () => {
  const { onSubmit } = renderForm();
  await pickBrand('Ubiquiti');
  await userEvent.type(screen.getByLabelText('Tipe'), 'AF-5XHD');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Country lock (wajib)' }));
  await pickSelect(screen, 'Firmware', 'AF-5XHD');
  // Ganti ke Mikrotik: kode Ubiquiti tak berlaku, kolom kosong lagi.
  await pickBrand('Mikrotik');
  expect(screen.getByRole('combobox', { name: 'Firmware' })).toHaveValue('');
  // Pilih kode Mikrotik, lalu matikan Country lock: kolom hilang dan tak terkirim.
  await pickSelect(screen, 'Firmware', '5GHz');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Country lock (wajib)' }));
  expect(screen.queryByRole('combobox', { name: 'Firmware' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'b3', isCountryLock: false, firmware: '' }),
    ),
  );
});

test('wajib foto bukti: kolom Minimum foto hanya muncul saat dicentang (bawaan 1) dan ikut terkirim', async () => {
  const { onSubmit } = renderForm();
  expect(screen.queryByLabelText('Minimum foto')).not.toBeInTheDocument();
  await pickBrand('Mikrotik');
  await userEvent.type(screen.getByLabelText('Tipe'), 'ES 24');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Wajib foto bukti' }));
  const field = screen.getByLabelText('Minimum foto');
  expect(field).toHaveValue(1);
  await userEvent.clear(field);
  await userEvent.type(field, '2');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ proofRequired: true, proofMin: 2 }),
    ),
  );
});

test('wajib foto bukti: nilai di luar 1-5 atau kosong menampilkan galat dan tidak mengirim', async () => {
  const { onSubmit } = renderForm();
  await pickBrand('Mikrotik');
  await userEvent.type(screen.getByLabelText('Tipe'), 'ES 24');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Wajib foto bukti' }));
  const field = screen.getByLabelText('Minimum foto');
  for (const value of ['6', '0']) {
    await userEvent.clear(field);
    await userEvent.type(field, value);
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Minimum foto harus 1–5')).toBeInTheDocument();
  }
  await userEvent.clear(field);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Minimum foto harus 1–5')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('wajib foto bukti dimatikan: kolom hilang dan terkirim proofRequired false, proofMin 1', async () => {
  const { onSubmit } = renderForm();
  await pickBrand('Mikrotik');
  await userEvent.type(screen.getByLabelText('Tipe'), 'ES 24');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Wajib foto bukti' }));
  await userEvent.clear(screen.getByLabelText('Minimum foto'));
  await userEvent.type(screen.getByLabelText('Minimum foto'), '4');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Wajib foto bukti' }));
  expect(screen.queryByLabelText('Minimum foto')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ proofRequired: false, proofMin: 1 }),
    ),
  );
});

test('galat server pada proofMin tampil di fieldnya', () => {
  renderForm({
    defaultValues: { ...toItemFormDefaults(), proofRequired: true, proofMin: 2 },
    fieldErrors: { proofMin: 'Minimum foto harus 1 sampai 5' },
  });
  expect(screen.getByLabelText('Minimum foto')).toHaveValue(2);
  expect(screen.getByText('Minimum foto harus 1 sampai 5')).toBeInTheDocument();
});

test('gambar galeri yang masih diunggah menahan Simpan sampai selesai', async () => {
  let finish: (value: unknown) => void = () => undefined;
  galleryUploadMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah gambar' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Tambah gambar' });
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array(4)], 'a.png', { type: 'image/png' })] },
  });
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Tambahkan (1)' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled());
  finish({
    id: 'g1',
    name: 'a',
    size: 1,
    width: 1,
    height: 1,
    uploadedBy: '',
    createdAt: '',
    usageCount: 0,
    canRename: false,
    canRemove: false,
    thumbUrl: '',
    previewUrl: '',
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled());
});

test('gambar yang disisipkan ke Detail dan masih diunggah menahan Simpan sampai selesai', async () => {
  let finish: (value: unknown) => void = () => undefined;
  galleryUploadMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Gambar' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Sisipkan gambar' });
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array(4)], 'a.png', { type: 'image/png' })] },
  });
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Sisipkan (1)' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled());
  finish({
    id: 'g1',
    name: 'a',
    size: 1,
    width: 1,
    height: 1,
    uploadedBy: '',
    createdAt: '',
    usageCount: 0,
    canRename: false,
    canRemove: false,
    thumbUrl: '',
    previewUrl: '',
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled());
});
