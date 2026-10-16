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

test('input kosong menjadi 0 (ditolak skema); pecahan dikirim apa adanya (tidak dibulatkan diam-diam)', async () => {
  const spy = vi.fn();
  render(<Harness initial={[{ name: 'Kabel', qty: 2 }]} spy={spy} />);
  const qty = screen.getByLabelText('Jumlah kelengkapan 1');
  await userEvent.clear(qty);
  expect(spy).toHaveBeenLastCalledWith([{ name: 'Kabel', qty: 0 }]);
  fireEvent.change(qty, { target: { value: '2.7' } });
  expect(spy).toHaveBeenLastCalledWith([{ name: 'Kabel', qty: 2.7 }]);
});

test('jumlah pecahan tidak dipotong diam-diam: nilai asli dikirim agar skema menolaknya (1.5 tetap 1.5)', () => {
  const spy = vi.fn();
  render(<Harness initial={[{ name: 'Kabel', qty: 1 }]} spy={spy} />);
  fireEvent.change(screen.getByLabelText('Jumlah kelengkapan 1'), { target: { value: '1.5' } });
  expect(spy).toHaveBeenLastCalledWith([{ name: 'Kabel', qty: 1.5 }]);
});

test('baris yang bermasalah menurut pesan galat diberi aria-invalid', () => {
  render(
    <AccessoryListField
      value={[
        { name: 'A', qty: 1 },
        { name: '', qty: 1 },
      ]}
      onChange={() => undefined}
      error="Kelengkapan 2: nama wajib diisi"
    />,
  );
  expect(screen.getByLabelText('Nama kelengkapan 2')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Nama kelengkapan 1')).not.toHaveAttribute('aria-invalid', 'true');
});
