import type { HandoverOptionItemDto } from '@shared/rpc';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { type ItemLine, ItemLinesField } from './item-lines-field';

const options: HandoverOptionItemDto[] = [
  { id: 'i1', brand: 'Samsung', model: 'Galaxy S24', aliases: [] },
  { id: 'i2', brand: 'Ubiquiti', model: 'ES 24 250W', aliases: ['ES24'] },
];

function Harness({
  initial = [] as ItemLine[],
  createLink,
}: {
  initial?: ItemLine[];
  createLink?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ItemLinesField
        options={options}
        value={value}
        onChange={setValue}
        createItemLink={createLink ? <a href="#/item/new">Tambah item baru</a> : null}
      />
      <output data-testid="lines">{JSON.stringify(value)}</output>
    </>
  );
}
const lines = () => JSON.parse(screen.getByTestId('lines').textContent ?? '[]');

test('mengetik tipe (urutan kata bebas, typo ringan) menampilkan saran; memilih menambah baris qty 1', async () => {
  render(<Harness />);
  await userEvent.type(screen.getByLabelText('Cari tipe'), 'galaxy samsng');
  await userEvent.click(await screen.findByRole('option', { name: 'Samsung Galaxy S24' }));
  expect(lines()).toEqual([{ itemId: 'i1', label: 'Samsung Galaxy S24', qty: 1 }]);
  expect(screen.getByLabelText('Cari tipe')).toHaveValue('');
});

test('"es24" menemukan ES 24 lewat nama lain; tipe yang sudah ditambahkan tidak disarankan lagi', async () => {
  render(<Harness initial={[{ itemId: 'i2', label: 'Ubiquiti ES 24 250W', qty: 2 }]} />);
  await userEvent.type(screen.getByLabelText('Cari tipe'), 'es24');
  expect(screen.queryByRole('option')).toBeNull();
  expect(screen.getByText('Semua tipe yang cocok sudah ada di daftar.')).toBeInTheDocument();
});

test('qty dapat diubah dan baris dihapus; Enter pada pencarian menambah saran pertama tanpa mengirim form', async () => {
  render(<Harness initial={[{ itemId: 'i1', label: 'Samsung Galaxy S24', qty: 1 }]} />);
  fireEvent.change(screen.getByLabelText('Qty Samsung Galaxy S24'), { target: { value: '7' } });
  expect(lines()[0].qty).toBe(7);
  await userEvent.type(screen.getByLabelText('Cari tipe'), 'ubiquiti{Enter}');
  expect(lines().map((l: { itemId: string }) => l.itemId)).toEqual(['i1', 'i2']);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Samsung Galaxy S24' }));
  expect(lines().map((l: { itemId: string }) => l.itemId)).toEqual(['i2']);
});

test('tipe di luar katalog: pesan tidak ditemukan; tautan tambah item hanya bila disediakan', async () => {
  const { unmount } = render(<Harness />);
  await userEvent.type(screen.getByLabelText('Cari tipe'), 'zzzzzzzz');
  expect(screen.getByText(/Tipe tidak ditemukan di katalog\./)).toBeInTheDocument();
  expect(screen.queryByText('Tambah item baru')).toBeNull();
  unmount();
  render(<Harness createLink />);
  await userEvent.type(screen.getByLabelText('Cari tipe'), 'zzzzzzzz');
  expect(screen.getByText('Tambah item baru')).toBeInTheDocument();
});

test('maksimal 100 baris: pencarian dinonaktifkan', () => {
  const many: ItemLine[] = Array.from({ length: 100 }, (_, i) => ({
    itemId: `x${i}`,
    label: `T${i}`,
    qty: 1,
  }));
  render(<Harness initial={many} />);
  expect(screen.getByLabelText('Cari tipe')).toBeDisabled();
});
