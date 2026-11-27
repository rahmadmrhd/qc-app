import type { BrandDto, BusinessUnitOptionDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
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
import { ItemForm, type ItemFormProps } from './item-form';

/** Tombol Simpan berada di luar form (seperti di bar halaman/footer dialog) dan memakai `form={formId}`. */
function Harness(props: Omit<ItemFormProps, 'formId'>) {
  // Seperti pembungkus (FormPage/FormDialogShell): Simpan ditahan selama form melaporkan unggahan berjalan.
  const [busy, setBusy] = useState(false);
  return (
    <>
      <ItemForm formId="item-form" {...props} onBusyChange={setBusy} />
      <button type="submit" form="item-form" disabled={busy}>
        Simpan
      </button>
    </>
  );
}

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

/** Pilihan firmware dari server (`clFirmwares.options`), seperti hasil seed awal. */
const firmwareOptions = {
  mikrotik: [
    { code: 'AC', label: 'AC' },
    { code: '5Ghz', label: '5GHz' },
  ],
  ubiquiti: [
    { code: 'WA', label: 'WA Firmware' },
    { code: 'af5xhd', label: 'AF-5XHD' },
  ],
};

function renderForm(props: Partial<ItemFormProps> = {}) {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <Harness
      brands={brands}
      firmwareOptions={firmwareOptions}
      businessUnits={businessUnits}
      editableBusinessUnitIds={editableBusinessUnitIds}
      defaultValues={toItemFormDefaults()}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

async function openTab(name: string) {
  await userEvent.click(screen.getByRole('tab', { name }));
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
  await openTab('Spesifikasi');
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
      boxSize: 0,
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
  expect(screen.getByRole('button', { name: 'Hapus RTL - Retail' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Hapus Xtra/ })).not.toBeInTheDocument();
});

test('mengganti merk (BU belum diubah manual) mengganti isian BU bawaan', async () => {
  renderForm();
  await pickBrand('Ubiquiti');
  await pickBrand('Mikrotik');
  expect(screen.getByRole('button', { name: 'Hapus WHL - Wholesale' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus RTL - Retail' })).not.toBeInTheDocument();
});

test('BU yang dipilih manual lebih dulu tidak ditimpa oleh BU bawaan merk', async () => {
  renderForm();
  await pickBusinessUnit('WHL - Wholesale');
  await pickBrand('Ubiquiti');
  expect(screen.getByRole('button', { name: 'Hapus WHL - Wholesale' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus RTL - Retail' })).not.toBeInTheDocument();
});

test('chip BU dapat dilepas, dan setelah dilepas manual merk tidak mengisi ulang', async () => {
  renderForm();
  await pickBrand('Ubiquiti');
  await userEvent.click(screen.getByRole('button', { name: 'Hapus RTL - Retail' }));
  await pickBrand('Mikrotik');
  expect(screen.queryByRole('button', { name: /^Hapus / })).not.toBeInTheDocument();
});

test('pilihan BU hanya BU aktif yang boleh diisi user, tanpa yang sudah terpilih', async () => {
  renderForm();
  await userEvent.click(screen.getByRole('combobox', { name: 'BU' }));
  const names = (await screen.findAllByRole('option')).map((option) => option.textContent);
  expect(names).toEqual(['RTL - Retail', 'WHL - Wholesale']);
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
  expect(screen.getByRole('button', { name: 'Hapus OLD - Lama — nonaktif' })).toBeInTheDocument();
  await pickBrand('Mikrotik');
  expect(screen.getByRole('button', { name: 'Hapus RTL - Retail' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus WHL - Wholesale' })).not.toBeInTheDocument();
  // BU nonaktif yang dilepas tidak muncul lagi sebagai pilihan tambah.
  await userEvent.click(screen.getByRole('button', { name: 'Hapus OLD - Lama — nonaktif' }));
  await userEvent.click(screen.getByRole('combobox', { name: 'BU' }));
  const names = (await screen.findAllByRole('option')).map((option) => option.textContent);
  expect(names).toEqual(['WHL - Wholesale']);
});

test('merk nonaktif tidak ditawarkan pada item baru; pada item ber-merk nonaktif merk itu tetap ada di pilihan', async () => {
  const { unmount } = render(
    <Harness brands={brands} defaultValues={toItemFormDefaults()} onSubmit={vi.fn()} />,
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
    <Harness brands={brands} defaultValues={toItemFormDefaults()} onSubmit={vi.fn()} />,
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
  expect(screen.getByRole('button', { name: 'Hapus WHL - Wholesale' })).toBeInTheDocument();
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

test('bagian Instruksi stiker memuat foto item, penanda, dan sasaran dari katalog', async () => {
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
  await openTab('Instruksi Stiker');
  expect(screen.getByRole('heading', { name: 'Instruksi stiker' })).toBeInTheDocument();
  const card = screen.getByRole('group', { name: 'Foto instruksi 1' });
  expect(within(card).getByRole('textbox', { name: 'Catatan foto 1' })).toHaveValue(
    'Belakang kardus',
  );
  expect(within(card).getByRole('combobox', { name: 'Label BU foto 1' })).toHaveValue(
    'RTL - Retail',
  );
  expect(within(card).getByRole('combobox', { name: 'Jenis atau stiker' })).toHaveValue(
    'Stiker Postel',
  );
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
  await openTab('Instruksi Stiker');
  const label = screen.getByRole('combobox', { name: 'Label BU foto 1' });
  expect(label).toHaveValue('RTL - Retail');
  await openTab('Detail');
  await userEvent.click(screen.getByRole('button', { name: 'Hapus RTL - Retail' }));
  await openTab('Instruksi Stiker');
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Label BU foto 1' })).toHaveValue(''),
  );
});

const STICKER_MARK_DEFAULTS = {
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
} satisfies ItemFormProps['defaultValues'];

test('penanda: satu-satunya pintu Tambah membuka dialog tambah stiker; tak ada tombol Tambah jenis baru', async () => {
  const onCreateSticker = vi.fn(async () => STICKERS[0] as StickerDto);
  const { onSubmit } = renderForm({
    defaultValues: STICKER_MARK_DEFAULTS,
    stickers: STICKERS,
    stickerTypes: STICKER_TYPES,
    guides: GUIDES,
    onCreateSticker,
    onCreateStickerType: vi.fn(),
  });
  await openTab('Instruksi Stiker');
  expect(screen.queryByRole('button', { name: 'Tambah jenis baru' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox', { name: 'Jenis atau stiker' }));
  const addOptions = screen.getAllByRole('option', { name: /^Tambah/ });
  expect(addOptions.map((o) => o.textContent)).toEqual(['Tambah Stiker']);
  await userEvent.click(addOptions[0] as HTMLElement);
  expect(await screen.findByRole('alertdialog', { name: 'Tambah stiker' })).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('dialog tambah stiker dari penanda memuat Tambah Jenis; jenis baru dibuat dari dalamnya tanpa mengirim form item', async () => {
  const created: StickerTypeDto = {
    id: 't9',
    name: 'Segel',
    rule: 'bu',
    status: 'active',
    stickerCount: 0,
    systemKind: '',
    defaultMinQty: 0,
    updatedAt: '',
  };
  const onCreateStickerType = vi.fn(async () => created);
  const { onSubmit } = renderForm({
    defaultValues: STICKER_MARK_DEFAULTS,
    stickers: STICKERS,
    stickerTypes: STICKER_TYPES,
    guides: GUIDES,
    onCreateSticker: vi.fn(),
    onCreateStickerType,
  });
  await openTab('Instruksi Stiker');
  await userEvent.click(screen.getByRole('combobox', { name: 'Jenis atau stiker' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah Stiker' }));
  const stickerDialog = await screen.findByRole('alertdialog', { name: 'Tambah stiker' });
  await userEvent.click(within(stickerDialog).getByRole('combobox', { name: /Jenis/ }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah Jenis' }));
  const typeDialog = await screen.findByRole('alertdialog', { name: 'Tambah jenis stiker' });
  await userEvent.type(within(typeDialog).getByLabelText(/Nama jenis/), 'Segel');
  await userEvent.click(within(typeDialog).getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(onCreateStickerType).toHaveBeenCalledWith({ name: 'Segel', rule: 'bu' }),
  );
  expect(onSubmit).not.toHaveBeenCalled();
});

test('tanpa hak membuat stiker, penanda tak punya baris Tambah walau bisa membuat jenis', async () => {
  renderForm({
    defaultValues: STICKER_MARK_DEFAULTS,
    stickers: STICKERS,
    stickerTypes: STICKER_TYPES,
    guides: GUIDES,
    onCreateStickerType: vi.fn(),
  });
  await openTab('Instruksi Stiker');
  await userEvent.click(screen.getByRole('combobox', { name: 'Jenis atau stiker' }));
  expect(screen.queryByRole('option', { name: /^Tambah/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tambah jenis baru' })).not.toBeInTheDocument();
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
  await openTab('Instruksi Stiker');
  await userEvent.click(screen.getByRole('combobox', { name: 'Jenis atau stiker' }));
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

test('mode ubah memuat nilai awal', async () => {
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
  expect(screen.getByRole('button', { name: 'Hapus RTL - Retail' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Country lock (wajib)' })).toBeChecked();
  expect(screen.getByLabelText('Nama lain')).toHaveValue('AirFiber');
  expect(screen.getByText('2/10')).toBeInTheDocument();
  await openTab('Gambar');
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
  expect(screen.getByRole('button', { name: 'Hapus WHL - Wholesale' })).toBeInTheDocument();
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
  expect(screen.getByRole('link', { name: 'Buka RTL - Retail' })).toHaveAttribute(
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
  expect(screen.getByRole('button', { name: 'Hapus NEW - Baru' })).toBeInTheDocument();
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

test('firmware: tanpa pilihan dari server field nonaktif; firmware merk lain tak ditawarkan', async () => {
  renderForm({ firmwareOptions: { mikrotik: [], ubiquiti: [] } });
  await pickBrand('Ubiquiti');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Country lock (wajib)' }));
  expect(screen.getByRole('combobox', { name: 'Firmware' })).toBeDisabled();
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

test('field wajib bertanda aria-required; Minimum foto wajib hanya saat "Wajib foto bukti" dicentang', async () => {
  renderForm();
  expect(screen.getByLabelText('Merk')).toHaveAttribute('aria-required', 'true');
  expect(screen.getByLabelText('BU')).toHaveAttribute('aria-required', 'true');
  expect(screen.getByLabelText('Tipe')).toHaveAttribute('aria-required', 'true');
  expect(screen.getByLabelText('Nama lain')).not.toHaveAttribute('aria-required');
  expect(screen.queryByLabelText('Minimum foto')).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Wajib foto bukti'));
  expect(screen.getByLabelText('Minimum foto')).toHaveAttribute('aria-required', 'true');
  // Firmware opsional pada skema: tak pernah wajib, juga setelah Country lock dicentang.
  await userEvent.click(screen.getByLabelText(/Country lock/));
  expect(screen.getByLabelText('Firmware')).not.toHaveAttribute('aria-required');
});

const dotOf = (name: string) =>
  screen
    .getByRole('tab', { name: new RegExp(`^${name}`) })
    .querySelector('[data-slot="tab-error-dot"]');

test('empat tab berlabel dan Detail aktif pertama', () => {
  renderForm();
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Detail',
    'Gambar',
    'Instruksi Stiker',
    'Spesifikasi',
  ]);
  expect(screen.getByRole('tab', { name: 'Detail', selected: true })).toBeInTheDocument();
});

test('simpan dengan Tipe kosong dari tab lain: tab Detail dibuka dan bertitik galat', async () => {
  const { onSubmit } = renderForm();
  await openTab('Gambar');
  expect(screen.getByRole('tab', { name: 'Gambar', selected: true })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: /^Detail/, selected: true })).toBeInTheDocument(),
  );
  expect(dotOf('Detail')).not.toBeNull();
  expect(dotOf('Gambar')).toBeNull();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('galat server pada stickerPhotos: tab Instruksi Stiker dibuka dan bertitik galat', async () => {
  renderForm({
    defaultValues: {
      ...toItemFormDefaults(),
      brandId: 'b1',
      businessUnitIds: ['bu-a'],
      model: 'X',
    },
    fieldErrors: { stickerPhotos: 'Gambar pustaka tidak dikenal' },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('tab', { name: /^Instruksi Stiker/, selected: true }),
    ).toBeInTheDocument(),
  );
  expect(dotOf('Instruksi Stiker')).not.toBeNull();
  expect(dotOf('Detail')).toBeNull();
});

test('onTabErrorsChange melaporkan tab bergalat', async () => {
  const onTabErrorsChange = vi.fn();
  renderForm({
    fieldErrors: { detail: 'Terlalu panjang' },
    onTabErrorsChange,
  });
  await waitFor(() =>
    expect(onTabErrorsChange).toHaveBeenLastCalledWith({
      detail: false,
      gambar: false,
      instruksi: false,
      spesifikasi: true,
    }),
  );
});

test('merk terhapus yang tersimpan tampil dengan nama dan "Terhapus", bukan id', async () => {
  const deletedBrand: BrandDto = {
    id: 'b-del',
    name: 'Sony',
    status: 'inactive',
    itemCount: 0,
    updatedAt: '',
    businessUnitIds: [],
    deleted: { deletedAt: '', deletedBy: '' },
  };
  renderForm({
    brands: [...brands, deletedBrand],
    defaultValues: { ...toItemFormDefaults(), brandId: 'b-del', businessUnitIds: ['bu-a'] },
  });
  expect(screen.getByRole('combobox', { name: 'Merk' })).toHaveValue('Sony — Terhapus');
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
  await openTab('Gambar');
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
  await openTab('Spesifikasi');
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
  await waitFor(() => expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled(), {
    timeout: 4000,
  });
});
