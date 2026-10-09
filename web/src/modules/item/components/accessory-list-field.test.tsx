import type { ItemAccessoryDto } from '@shared/rpc';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { AccessoryListField } from './accessory-list-field';

function Harness({
  initial = [] as ItemAccessoryDto[],
  spy,
}: {
  initial?: ItemAccessoryDto[];
  spy?: (v: ItemAccessoryDto[]) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AccessoryListField
      value={value}
      onChange={(next) => {
        setValue(next);
        spy?.(next);
      }}
    />
  );
}

test('menambah baris dengan jumlah awal 1, mengisi nama dan jumlah, lalu menghapus', async () => {
  const spy = vi.fn();
  render(<Harness spy={spy} />);
  await userEvent.click(screen.getByRole('button', { name: 'Tambah kelengkapan' }));
  expect(spy).toHaveBeenLastCalledWith([{ name: '', qty: 1 }]);
  await userEvent.type(screen.getByLabelText('Nama kelengkapan 1'), 'Kabel');
  await userEvent.clear(screen.getByLabelText('Jumlah kelengkapan 1'));
  await userEvent.type(screen.getByLabelText('Jumlah kelengkapan 1'), '3');
  expect(spy).toHaveBeenLastCalledWith([{ name: 'Kabel', qty: 3 }]);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus kelengkapan 1' }));
  expect(screen.queryByLabelText('Nama kelengkapan 1')).not.toBeInTheDocument();
});

test('jumlah dibulatkan ke bilangan bulat dan input kosong menjadi 0 (ditolak skema)', async () => {
  const spy = vi.fn();
  render(<Harness initial={[{ name: 'Kabel', qty: 2 }]} spy={spy} />);
  const qty = screen.getByLabelText('Jumlah kelengkapan 1');
  await userEvent.clear(qty);
  expect(spy).toHaveBeenLastCalledWith([{ name: 'Kabel', qty: 0 }]);
  fireEvent.change(qty, { target: { value: '2.7' } });
  expect(spy).toHaveBeenLastCalledWith([{ name: 'Kabel', qty: 2 }]);
});
