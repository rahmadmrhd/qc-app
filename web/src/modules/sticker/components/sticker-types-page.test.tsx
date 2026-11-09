import type { StickerTypeDto } from '@shared/contract';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { stickerTypeSaveFailure } from './sticker-type-form-dialog';
import { StickerTypesPage } from './sticker-types-page';

const types: StickerTypeDto[] = [
  {
    id: 't1',
    name: 'QC Hijau',
    rule: 'bu',
    status: 'active',
    stickerCount: 3,
    updatedAt: '2026-11-09 10:00:00',
  },
  {
    id: 't2',
    name: 'Segel',
    rule: 'none',
    status: 'inactive',
    stickerCount: 0,
    updatedAt: '2026-11-09 10:00:00',
  },
];

function renderPage(props: Partial<Parameters<typeof StickerTypesPage>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue(null);
  const onToggleStatus = vi.fn();
  render(
    <StickerTypesPage
      types={types}
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

test('menampilkan nama, aturan, jumlah stiker, dan status tiap jenis', () => {
  renderPage();
  const hijau = screen.getByRole('row', { name: /QC Hijau/ });
  expect(within(hijau).getByText('Menurut BU')).toBeInTheDocument();
  expect(within(hijau).getByText('3')).toBeInTheDocument();
  expect(within(hijau).getByText('Aktif')).toBeInTheDocument();
  const segel = screen.getByRole('row', { name: /Segel/ });
  expect(within(segel).getByText('Tanpa syarat')).toBeInTheDocument();
  expect(within(segel).getByText('Nonaktif')).toBeInTheDocument();
});

test('menampilkan keterangan kosong bila belum ada jenis', () => {
  renderPage({ types: [] });
  expect(screen.getByText('Belum ada jenis stiker.')).toBeInTheDocument();
});

test('tombol Tambah, Ubah, dan Nonaktifkan mengikuti izin', () => {
  const { rerender } = (() => {
    const utils = render(
      <StickerTypesPage
        types={types}
        canEdit={false}
        canManage={false}
        pendingStatusId={null}
        onSave={vi.fn()}
        onToggleStatus={vi.fn()}
      />,
    );
    return utils;
  })();
  expect(screen.queryByRole('button', { name: 'Tambah jenis' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ubah QC Hijau' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan QC Hijau' })).toBeNull();

  rerender(
    <StickerTypesPage
      types={types}
      canEdit
      canManage={false}
      pendingStatusId={null}
      onSave={vi.fn()}
      onToggleStatus={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: 'Tambah jenis' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ubah QC Hijau' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan QC Hijau' })).toBeNull();

  rerender(
    <StickerTypesPage
      types={types}
      canEdit
      canManage
      pendingStatusId={null}
      onSave={vi.fn()}
      onToggleStatus={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: 'Nonaktifkan QC Hijau' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Aktifkan Segel' })).toBeInTheDocument();
});

test('menonaktifkan memanggil onToggleStatus dengan jenisnya', async () => {
  const { onToggleStatus } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan QC Hijau' }));
  expect(onToggleStatus).toHaveBeenCalledWith(types[0]);
});

test('menambah jenis: aturan dapat dipilih, simpan mengirim nama dan aturan', async () => {
  const { onSave } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah jenis' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.type(within(dialog).getByLabelText('Nama jenis'), 'Postel');
  const rule = within(dialog).getByLabelText('Aturan');
  expect(rule).toBeEnabled();
  await userEvent.selectOptions(rule, 'none');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({ name: 'Postel', rule: 'none' });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
});

test('galat server tampil pada field nama dan dialog tetap terbuka', async () => {
  const { onSave } = renderPage();
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
  const { onSave } = renderPage();
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
  const { onSave } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Segel' }));
  const dialog = await screen.findByRole('alertdialog');
  const rule = within(dialog).getByLabelText('Aturan');
  expect(rule).toHaveValue('none');
  await userEvent.selectOptions(rule, 'bu');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({
    id: 't2',
    expectedUpdatedAt: '2026-11-09 10:00:00',
    name: 'Segel',
    rule: 'bu',
  });
});

test('versi usang (412) dijawab pesan jelas dan dialog tetap terbuka', async () => {
  const { onSave } = renderPage();
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

test('konflik nama (409) bukan versi usang: pesan servernya dipertahankan', () => {
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
  const { onSave } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah jenis' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByRole('button', { name: 'Simpan' })).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
});
