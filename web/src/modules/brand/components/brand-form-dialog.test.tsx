import type { BusinessUnitOptionDto } from '@shared/contract';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { BrandFormDialog, type BrandFormDialogProps } from './brand-form-dialog';

const businessUnits: BusinessUnitOptionDto[] = [
  { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'active' },
  { id: 'bu-b', code: 'WHL', name: 'Wholesale', status: 'active' },
  { id: 'bu-old', code: 'OLD', name: 'Lama', status: 'inactive' },
];

function Harness({
  onSave,
  brand,
  onOuterSubmit,
  onCreateBusinessUnit,
  openBusinessUnitHref,
}: Pick<
  BrandFormDialogProps,
  'onSave' | 'brand' | 'onCreateBusinessUnit' | 'openBusinessUnitHref'
> & { onOuterSubmit?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onOuterSubmit?.();
      }}
    >
      <button type="button" onClick={() => setOpen(true)}>
        Buka
      </button>
      <BrandFormDialog
        open={open}
        onOpenChange={setOpen}
        brand={brand}
        businessUnits={businessUnits}
        onSave={onSave}
        onCreateBusinessUnit={onCreateBusinessUnit}
        openBusinessUnitHref={openBusinessUnitHref}
      />
    </form>
  );
}

async function pickBusinessUnit(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'BU bawaan' }));
  await userEvent.click(await screen.findByRole('option', { name }));
  await userEvent.keyboard('{Escape}');
}

test('merk baru: isian kosong, simpan mengirim nama dan BU bawaan kosong lalu menutup', async () => {
  const onSave = vi.fn().mockResolvedValue(null);
  render(<Harness onSave={onSave} />);
  expect(screen.getByRole('heading', { name: 'Tambah merk' })).toBeInTheDocument();
  const input = screen.getByLabelText('Nama merk');
  expect(input).toHaveValue('');
  await userEvent.type(input, 'Ubiquiti');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({ name: 'Ubiquiti', businessUnitIds: [] });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
});

test('ganti nama: isian terisi nama lama, BU bawaan tampil sebagai chip, simpan mengirim id', async () => {
  const onSave = vi.fn().mockResolvedValue(null);
  render(
    <Harness onSave={onSave} brand={{ id: 'b1', name: 'Mikrotik', businessUnitIds: ['bu-a'] }} />,
  );
  const input = screen.getByLabelText('Nama merk');
  expect(input).toHaveValue('Mikrotik');
  expect(screen.getByRole('button', { name: 'Hapus RTL - Retail' })).toBeInTheDocument();
  await userEvent.clear(input);
  await userEvent.type(input, 'MikroTik');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({ id: 'b1', name: 'MikroTik', businessUnitIds: ['bu-a'] });
});

test('memilih BU bawaan lalu simpan mengirim businessUnitIds; chip dapat dilepas', async () => {
  const onSave = vi.fn().mockResolvedValue(null);
  render(<Harness onSave={onSave} />);
  await userEvent.type(screen.getByLabelText('Nama merk'), 'Ubiquiti');
  await pickBusinessUnit('WHL - Wholesale');
  await pickBusinessUnit('RTL - Retail');
  await userEvent.click(screen.getByRole('button', { name: 'Hapus RTL - Retail' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({ name: 'Ubiquiti', businessUnitIds: ['bu-b'] });
});

test('BU nonaktif yang melekat tampil sebagai chip, boleh dilepas, dan tidak ditawarkan sebagai opsi tambah', async () => {
  const onSave = vi.fn().mockResolvedValue(null);
  render(
    <Harness onSave={onSave} brand={{ id: 'b2', name: 'Lama', businessUnitIds: ['bu-old'] }} />,
  );
  expect(screen.getByRole('button', { name: 'Hapus OLD - Lama — nonaktif' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox', { name: 'BU bawaan' }));
  const names = (await screen.findAllByRole('option')).map((option) => option.textContent);
  expect(names).toEqual(['RTL - Retail', 'WHL - Wholesale']);
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('button', { name: 'Hapus OLD - Lama — nonaktif' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({ id: 'b2', name: 'Lama', businessUnitIds: [] });
});

test('galat server tampil di dialog (aria-invalid) dan hilang saat mengetik ulang; dialog tetap terbuka', async () => {
  const onSave = vi.fn().mockResolvedValue('Nama merk sudah dipakai');
  render(<Harness onSave={onSave} />);
  await userEvent.type(screen.getByLabelText('Nama merk'), 'X');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Nama merk sudah dipakai');
  const input = screen.getByLabelText('Nama merk');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAttribute('aria-describedby', alert.id);
  await userEvent.type(input, 'Y');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('galat BU bawaan (fields.businessUnitIds) tampil di field BU; dialog tetap terbuka', async () => {
  const onSave = vi.fn().mockResolvedValue({
    message: 'Data tidak valid',
    businessUnitIds: 'BU tidak dikenal atau tidak aktif',
  });
  render(<Harness onSave={onSave} />);
  await userEvent.type(screen.getByLabelText('Nama merk'), 'X');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('BU tidak dikenal atau tidak aktif')).toBeInTheDocument();
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});

test('onSave yang melempar galat menampilkan pesan dan tidak membuat tombol macet', async () => {
  const onSave = vi.fn().mockRejectedValue(new Error('putus'));
  render(<Harness onSave={onSave} />);
  await userEvent.type(screen.getByLabelText('Nama merk'), 'X');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Gagal menyimpan merk');
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled();
});

test('nama kosong: Simpan menampilkan galat tanpa menyimpan; Batal menutup tanpa menyimpan', async () => {
  const onSave = vi.fn();
  render(<Harness onSave={onSave} />);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Nama merk wajib diisi')).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onSave).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
});

test('Enter menyimpan dan tidak menjalar ke form induk', async () => {
  const onSave = vi.fn().mockResolvedValue(null);
  const onOuterSubmit = vi.fn();
  render(<Harness onSave={onSave} onOuterSubmit={onOuterSubmit} />);
  await userEvent.type(screen.getByLabelText('Nama merk'), 'Baru{Enter}');
  expect(onSave).toHaveBeenCalledWith({ name: 'Baru', businessUnitIds: [] });
  expect(onOuterSubmit).not.toHaveBeenCalled();
});

test('field BU bawaan: Buka dan Tambah BU hanya muncul bila disediakan', async () => {
  render(<Harness onSave={vi.fn()} />);
  await pickBusinessUnit('RTL - Retail');
  expect(screen.queryByRole('link', { name: /Buka/ })).toBeNull();
  await userEvent.click(screen.getByRole('combobox', { name: 'BU bawaan' }));
  expect(screen.queryByRole('option', { name: 'Tambah BU bawaan' })).toBeNull();
  cleanup();

  render(
    <Harness
      onSave={vi.fn()}
      openBusinessUnitHref={(id) => `/access/business-units/${id}`}
      onCreateBusinessUnit={vi.fn()}
    />,
  );
  await pickBusinessUnit('RTL - Retail');
  expect(screen.getByRole('link', { name: 'Buka RTL - Retail' })).toHaveAttribute(
    'href',
    '/access/business-units/bu-a',
  );
  await userEvent.click(screen.getByRole('combobox', { name: 'BU bawaan' }));
  expect(screen.getByRole('option', { name: 'Tambah BU bawaan' })).toBeInTheDocument();
});

test('Tambah BU bawaan membuat BU lewat dialog turunan dan langsung memilihnya', async () => {
  const onCreateBusinessUnit = vi
    .fn()
    .mockResolvedValue({ id: 'bu-new', code: 'NEW', name: 'Baru', status: 'active' });
  const onSave = vi.fn().mockResolvedValue(null);
  const onOuterSubmit = vi.fn();
  render(
    <Harness
      onSave={onSave}
      onOuterSubmit={onOuterSubmit}
      onCreateBusinessUnit={onCreateBusinessUnit}
    />,
  );
  await userEvent.type(screen.getByLabelText('Nama merk'), 'Merk X');
  await userEvent.click(screen.getByRole('combobox', { name: 'BU bawaan' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Tambah BU bawaan' }));
  const buDialog = await screen.findByRole('alertdialog', { name: 'Tambah BU' });
  await userEvent.type(within(buDialog).getByLabelText('Kode'), 'NEW');
  await userEvent.type(within(buDialog).getByLabelText('Nama'), 'Baru');
  await userEvent.click(within(buDialog).getByRole('button', { name: /Simpan/ }));
  await waitFor(() => expect(onCreateBusinessUnit).toHaveBeenCalledTimes(1));
  expect(onOuterSubmit).not.toHaveBeenCalled();
  const brandDialog = await screen.findByRole('alertdialog', { name: 'Tambah merk' });
  expect(within(brandDialog).getByText('NEW - Baru')).toBeInTheDocument();
  await userEvent.click(within(brandDialog).getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({ name: 'Merk X', businessUnitIds: ['bu-new'] }),
  );
});

test('klik di luar dialog tidak menutupnya dan isian tetap; Escape menutup', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<Harness onSave={vi.fn()} />);
  await user.type(screen.getByLabelText('Nama merk'), 'Draf');
  const overlay = document.querySelector('[data-slot="alert-dialog-overlay"]');
  expect(overlay).not.toBeNull();
  await user.click(overlay as Element);
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  expect(screen.getByLabelText('Nama merk')).toHaveValue('Draf');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
});

test('Nama merk wajib (aria-required); BU bawaan opsional', () => {
  render(<Harness onSave={vi.fn()} />);
  expect(screen.getByLabelText('Nama merk')).toHaveAttribute('aria-required', 'true');
  expect(screen.getByLabelText('BU bawaan')).not.toHaveAttribute('aria-required');
});
