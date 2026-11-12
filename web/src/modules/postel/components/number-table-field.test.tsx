import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { type NumberRow, NumberTableField } from './number-table-field';

const TODAY = '2026-11-12';

const saved = (over: Partial<NumberRow>): NumberRow => ({
  key: 'k1',
  id: 'n1',
  number: 'AB-1',
  expiresOn: '2027-06-01',
  link: '',
  ...over,
});

/** Penampung state agar interaksi (tambah/hapus) terlihat di DOM. */
function Harness({ initial, errors }: { initial: NumberRow[]; errors?: string[] }) {
  const [rows, setRows] = useState(initial);
  return (
    <NumberTableField value={rows} onChange={setRows} soonDays={90} today={TODAY} errors={errors} />
  );
}

const bodyRows = () => screen.getAllByRole('row').slice(1);

test('Tambah nomor menambah baris kosong; baris sebelumnya jadi Lama dan baris baru Aktif', async () => {
  render(<Harness initial={[saved({})]} />);
  expect(bodyRows()[0]).toHaveTextContent('Aktif · Berlaku');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah nomor' }));
  expect(bodyRows()).toHaveLength(2);
  expect(bodyRows()[0]).toHaveTextContent('Lama');
  expect(bodyRows()[0]).not.toHaveTextContent('Aktif');
  expect(bodyRows()[1]).toHaveTextContent('Aktif');
  expect(within(bodyRows()[1] as HTMLElement).getByLabelText('Nomor sertifikat 2')).toHaveValue('');
});

test('Hapus tak tersedia pada baris Aktif tersimpan; tersedia pada Lama dan baris baru', async () => {
  render(<Harness initial={[saved({ key: 'k0', id: 'n0', number: 'OLD-0' }), saved({})]} />);
  expect(screen.queryByRole('button', { name: 'Hapus nomor 2' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hapus nomor 1' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah nomor' }));
  // baris 2 kini Lama (tersimpan): bisa dihapus; baris 3 baru: bisa dihapus
  expect(screen.getByRole('button', { name: 'Hapus nomor 2' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hapus nomor 3' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus nomor 3' }));
  expect(bodyRows()).toHaveLength(2);
  // baris tersimpan terakhir kembali Aktif: tak dapat dihapus
  expect(screen.queryByRole('button', { name: 'Hapus nomor 2' })).not.toBeInTheDocument();
});

test('Hapus pada baris Lama menghilangkan baris itu', async () => {
  render(<Harness initial={[saved({ key: 'k0', id: 'n0', number: 'OLD-0' }), saved({})]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus nomor 1' }));
  expect(bodyRows()).toHaveLength(1);
  expect(bodyRows()[0]).toHaveTextContent('Aktif');
  expect(screen.getByLabelText('Nomor sertifikat 1')).toHaveValue('AB-1');
});

test('tanggal lewat menampilkan Kedaluwarsa; segera habis menampilkan Segera habis', () => {
  render(
    <Harness
      initial={[
        saved({ key: 'k0', id: 'n0', number: 'OLD-0', expiresOn: '2026-10-01' }),
        saved({ expiresOn: '2026-12-01' }),
      ]}
    />,
  );
  expect(bodyRows()[0]).toHaveTextContent('Lama · Kedaluwarsa');
  expect(bodyRows()[1]).toHaveTextContent('Aktif · Segera habis');
});

test('baris Aktif yang kedaluwarsa tampil "Aktif · Kedaluwarsa"', () => {
  render(<Harness initial={[saved({ expiresOn: '2026-10-01' })]} />);
  expect(bodyRows()[0]).toHaveTextContent('Aktif · Kedaluwarsa');
});

test('mengetik nomor, tanggal, dan tautan memanggil onChange dengan baris yang sama kuncinya', async () => {
  const onChange = vi.fn();
  render(
    <NumberTableField
      value={[{ key: 'k9', number: '', expiresOn: '', link: '' }]}
      onChange={onChange}
      soonDays={90}
      today={TODAY}
    />,
  );
  await userEvent.type(screen.getByLabelText('Nomor sertifikat 1'), 'X');
  expect(onChange).toHaveBeenLastCalledWith([{ key: 'k9', number: 'X', expiresOn: '', link: '' }]);
  await userEvent.type(screen.getByLabelText('Tautan 1'), 'h');
  expect(onChange).toHaveBeenLastCalledWith([{ key: 'k9', number: '', expiresOn: '', link: 'h' }]);
});

test('galat bernomor menandai baris dan tampil di bawah tabel', () => {
  render(
    <Harness
      initial={[saved({}), saved({ key: 'k2', id: undefined, number: '' })]}
      errors={['Nomor 2: nomor sertifikat wajib diisi']}
    />,
  );
  expect(screen.getByText('Nomor 2: nomor sertifikat wajib diisi')).toBeInTheDocument();
  expect(screen.getByLabelText('Nomor sertifikat 2')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Nomor sertifikat 1')).not.toHaveAttribute('aria-invalid', 'true');
});
