import type { StickerTypeDto } from '@shared/contract';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { pickSelect, selectOptionNames } from '@/test/link-field';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { stickerTypeSaveFailure } from './sticker-type-form-dialog';
import {
  type StickerTypesFilter,
  StickerTypesPage,
  type StickerTypesPageProps,
} from './sticker-types-page';

const types: StickerTypeDto[] = [
  {
    id: 't1',
    name: 'QC Hijau',
    rule: 'bu',
    status: 'active',
    stickerCount: 3,
    systemKind: '',
    defaultMinQty: 0,
    updatedAt: '2026-11-09 10:00:00',
  },
  {
    id: 't2',
    name: 'Segel',
    rule: 'none',
    status: 'inactive',
    stickerCount: 0,
    systemKind: '',
    defaultMinQty: 0,
    updatedAt: '2026-11-09 10:00:00',
  },
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

/** Pemegang state filter: search params Router digantikan state lokal. */
function Harness(props: Omit<StickerTypesPageProps, 'filter' | 'onFilterChange'>) {
  const [filter, setFilter] = useState<StickerTypesFilter>({ q: '', status: 'all' });
  return (
    <StickerTypesPage
      {...props}
      filter={filter}
      onFilterChange={(patch) => setFilter((current) => ({ ...current, ...patch }))}
    />
  );
}

async function openChip(label: string) {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}(:|$)`) }));
}

async function renderPage(props: Partial<StickerTypesPageProps> = {}) {
  const onSave = vi.fn().mockResolvedValue(null);
  const onToggleStatus = vi.fn();
  const mutations = mutationsMock();
  await renderInRouter(
    <Harness
      types={types}
      canEdit
      canManage
      pendingStatusId={null}
      onSave={onSave}
      onToggleStatus={onToggleStatus}
      mutations={mutations}
      {...props}
    />,
  );
  return { onSave, onToggleStatus, mutations };
}

test('menampilkan nama, aturan, jumlah stiker, dan status tiap jenis', async () => {
  await renderPage();
  const hijau = screen.getByRole('row', { name: /QC Hijau/ });
  expect(within(hijau).getByText('Menurut BU')).toBeInTheDocument();
  expect(within(hijau).getByText('3')).toBeInTheDocument();
  expect(within(hijau).getByText('Aktif')).toBeInTheDocument();
  const segel = screen.getByRole('row', { name: /Segel/ });
  expect(within(segel).getByText('Tanpa syarat')).toBeInTheDocument();
  expect(within(segel).getByText('Nonaktif')).toBeInTheDocument();
});

test('menampilkan keterangan kosong bila belum ada jenis', async () => {
  await renderPage({ types: [] });
  expect(screen.getByText('Belum ada jenis stiker.')).toBeInTheDocument();
});

test('tombol Tambah, Ubah, dan Nonaktifkan mengikuti izin', async () => {
  await renderPage({ canEdit: false, canManage: false });
  expect(screen.queryByRole('button', { name: 'Tambah jenis' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ubah QC Hijau' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan QC Hijau' })).toBeNull();
  cleanup();

  await renderPage({ canEdit: true, canManage: false });
  expect(screen.getByRole('button', { name: 'Tambah jenis' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ubah QC Hijau' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan QC Hijau' })).toBeNull();
  cleanup();

  await renderPage();
  expect(screen.getByRole('button', { name: 'Nonaktifkan QC Hijau' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Aktifkan Segel' })).toBeInTheDocument();
});

test('menonaktifkan memanggil onToggleStatus dengan jenisnya', async () => {
  const { onToggleStatus } = await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan QC Hijau' }));
  expect(onToggleStatus).toHaveBeenCalledWith(types[0]);
});

test('menambah jenis: aturan dapat dipilih, simpan mengirim nama dan aturan', async () => {
  const { onSave } = await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah jenis' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.type(within(dialog).getByLabelText('Nama jenis'), 'Postel');
  expect(within(dialog).getByRole('combobox', { name: 'Aturan' })).toBeEnabled();
  await pickSelect(within(dialog), 'Aturan', 'Tanpa syarat');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({ name: 'Postel', rule: 'none' });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
});

test('galat server tampil pada field nama dan dialog tetap terbuka', async () => {
  const { onSave } = await renderPage();
  onSave.mockResolvedValueOnce({
    message: 'Nama jenis sudah dipakai',
    name: 'Nama jenis sudah dipakai',
  });
  await userEvent.click(screen.getByRole('button', { name: 'Tambah jenis' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.type(within(dialog).getByLabelText('Nama jenis'), 'qc hijau');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nama jenis sudah dipakai');
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});

test('ubah jenis bila stickerCount > 0: aturan terkunci dan tampil sebagai teks; nama tetap dapat diubah', async () => {
  const { onSave } = await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah QC Hijau' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).queryByLabelText('Aturan')).toBeNull();
  expect(within(dialog).getByText(/Menurut BU/)).toBeInTheDocument();
  expect(within(dialog).getByText(/sudah ada stiker/i)).toBeInTheDocument();
  const name = within(dialog).getByLabelText('Nama jenis');
  expect(name).toHaveValue('QC Hijau');
  await userEvent.clear(name);
  await userEvent.type(name, 'QC Hijau Baru');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({
    id: 't1',
    expectedUpdatedAt: '2026-11-09 10:00:00',
    name: 'QC Hijau Baru',
    rule: 'bu',
  });
});

test('ubah jenis tanpa stiker: aturan masih dapat dipilih', async () => {
  const { onSave } = await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Segel' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByRole('combobox', { name: 'Aturan' })).toHaveValue('Tanpa syarat');
  await pickSelect(within(dialog), 'Aturan', 'Menurut BU');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({
    id: 't2',
    expectedUpdatedAt: '2026-11-09 10:00:00',
    name: 'Segel',
    rule: 'bu',
  });
});

test('versi usang (412) dijawab pesan jelas dan dialog tetap terbuka', async () => {
  const { onSave } = await renderPage();
  onSave.mockResolvedValueOnce(
    stickerTypeSaveFailure(new ApiError('CONFLICT', 'basi', 'r1', undefined, { status: 412 })),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Segel' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Data sudah diubah orang lain; muat ulang lalu ulangi',
  );
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});

test('konflik nama (409) bukan versi usang: pesan servernya dipertahankan', async () => {
  const failure = stickerTypeSaveFailure(
    new ApiError(
      'CONFLICT',
      'Nama jenis sudah dipakai',
      'r1',
      { name: 'Nama jenis sudah dipakai' },
      { status: 409 },
    ),
  );
  expect(failure.name).toBe('Nama jenis sudah dipakai');
  expect(failure.message).not.toMatch(/diubah orang lain/);
});

test('nama kosong tidak dapat disimpan', async () => {
  const { onSave } = await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah jenis' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByRole('button', { name: 'Simpan' })).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
});

const systemType: StickerTypeDto = {
  id: 't-mb',
  name: 'Manual Book',
  rule: 'group',
  status: 'active',
  stickerCount: 4,
  systemKind: 'manual_book',
  defaultMinQty: 50,
  updatedAt: '2026-11-09 10:00:00',
};

test('jenis sistem: aturan "Menurut kelompok item", badge Sistem, dan tanpa tombol Ubah', async () => {
  await renderPage({ types: [...types, systemType] });
  const row = screen.getByRole('row', { name: /Manual Book/ });
  expect(within(row).getByText('Menurut kelompok item')).toBeInTheDocument();
  expect(within(row).getByText('Sistem')).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: 'Ubah Manual Book' })).toBeNull();
  // jenis sistem selalu aktif: tanpa Nonaktifkan/Aktifkan (keputusan pemilik 2026-11-11)
  expect(within(row).queryByRole('button', { name: /Nonaktifkan|Aktifkan/ })).toBeNull();
  // jenis biasa tidak diberi badge dan tetap dapat diubah
  expect(within(screen.getByRole('row', { name: /QC Hijau/ })).queryByText('Sistem')).toBeNull();
  expect(screen.getByRole('button', { name: 'Ubah QC Hijau' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Nonaktifkan QC Hijau' })).toBeInTheDocument();
});

test('form jenis hanya menawarkan aturan pengguna (tanpa Menurut kelompok item)', async () => {
  await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah jenis' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(await selectOptionNames(within(dialog), 'Aturan')).toEqual(['Menurut BU', 'Tanpa syarat']);
});

test('nama jenis menaut ke View; jumlah stiker menaut ke halaman Stiker terfilter; tanpa tombol Lihat', async () => {
  await renderPage();
  expect(screen.getByRole('link', { name: 'QC Hijau' })).toHaveAttribute(
    'href',
    '/sticker/types/t1',
  );
  expect(screen.getByRole('link', { name: '3' })).toHaveAttribute('href', '/sticker?typeId=t1');
  expect(screen.queryByRole('button', { name: /^Lihat/ })).toBeNull();
});

test('jenis sistem: tanpa checkbox dan tanpa aksi apa pun; jenis biasa tetap punya checkbox', async () => {
  await renderPage({ types: [...types, systemType] });
  expect(screen.queryByRole('checkbox', { name: 'Pilih Manual Book' })).toBeNull();
  expect(screen.getByRole('checkbox', { name: 'Pilih QC Hijau' })).toBeInTheDocument();
});

test('pilih dua jenis lalu Aktifkan memanggil setStatus dengan dua id', async () => {
  const { mutations } = await renderPage();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih QC Hijau' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Segel' }));
  expect(screen.getByText('2 dipilih')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan' }));
  await waitFor(() => expect(mutations.setStatus).toHaveBeenCalledWith(['t1', 't2'], 'active'));
});

test('tanpa izin kelola: tanpa checkbox dan aksi massal', async () => {
  await renderPage({ canManage: false });
  expect(screen.queryByRole('checkbox', { name: 'Pilih QC Hijau' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'Pilih semua' })).toBeNull();
});

test('Hapus: hanya untuk jenis Nonaktif; konfirmasi lalu memanggil remove', async () => {
  const { mutations } = await renderPage();
  expect(screen.queryByRole('button', { name: 'Hapus QC Hijau' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Segel' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(mutations.remove).toHaveBeenCalledWith(['t2']));
});

test('Hapus massal ditolak selama terpilih ada jenis Aktif', async () => {
  await renderPage();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih QC Hijau' }));
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeDisabled();
});

test('tampilan Terhapus: hanya Pulihkan, tanpa kolom Status dan tombol Tambah', async () => {
  const { mutations } = await renderPage({
    types: [
      {
        ...types[1],
        id: 't9',
        name: 'Jenis Lama',
        deleted: { deletedAt: '2026-11-20T03:00:00.000Z', deletedBy: 'admin@x.com' },
      } as StickerTypeDto,
    ],
  });
  await openChip('Status');
  await pickSelect(screen, 'Filter status', 'Terhapus');
  expect(screen.queryByRole('button', { name: 'Tambah jenis' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ubah Jenis Lama' })).toBeNull();
  expect(screen.getByRole('columnheader', { name: 'Dihapus oleh' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan Jenis Lama' }));
  await waitFor(() => expect(mutations.restore).toHaveBeenCalledWith(['t9']));
});

test('ponsel (360 px): kartu memuat judul tertaut dan lencana status; aksi dalam satu menu', async () => {
  const media = mockMatchMedia(false);
  try {
    await renderPage();
    expect(screen.queryByRole('table')).toBeNull();
    const list = screen.getByRole('list', { name: 'Daftar jenis stiker' });
    const card = within(list).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(card).getByRole('link', { name: 'QC Hijau' })).toBeInTheDocument();
    expect(within(card).getByText('Aktif')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Aksi QC Hijau' })).toBeInTheDocument();
  } finally {
    media.restore();
  }
});

test('dialog hapus menyebut jumlah stiker pemakai (stiker hidup) bila jenis dipakai', async () => {
  await renderPage({
    types: [
      ...types,
      {
        id: 't3',
        name: 'Lama Dipakai',
        rule: 'none',
        status: 'inactive',
        stickerCount: 4,
        systemKind: '',
        defaultMinQty: 0,
        updatedAt: '2026-11-09 10:00:00',
      },
    ],
  });
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Lama Dipakai' }));
  expect(await screen.findByText('Dipakai 4 stiker.')).toBeInTheDocument();
});

test('dialog hapus jenis tak dipakai tidak memuat keterangan pemakaian', async () => {
  await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Segel' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).queryByText(/^Dipakai/)).toBeNull();
});
