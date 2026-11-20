import { piecesOfCount, STICKER_LIMITS, type StockCount } from '@shared/stickers';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { CountInput, cleanCount, emptyCount } from './count-input';

function Harness({
  initial = emptyCount(),
  onChange,
}: {
  initial?: StockCount;
  onChange?: (value: StockCount) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <CountInput
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

test('10 lembar x 12 dan 3 x 10 ditambah 5 lepas menampilkan 155 butir', async () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  expect(screen.getByText('0 butir')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Lembar baris 1'), '10');
  await userEvent.type(screen.getByLabelText('Isi per lembar baris 1'), '12');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah baris' }));
  await userEvent.type(screen.getByLabelText('Lembar baris 2'), '3');
  await userEvent.type(screen.getByLabelText('Isi per lembar baris 2'), '10');
  await userEvent.type(screen.getByLabelText('Butir'), '5');
  expect(screen.getByText('155 butir')).toBeInTheDocument();
  const last = onChange.mock.calls.at(-1)?.[0] as StockCount;
  expect(piecesOfCount(last)).toBe(155);
});

test('baris dapat dihapus dan jumlah diperbarui', async () => {
  render(
    <Harness
      initial={{
        rows: [
          { sheets: 2, perSheet: 5 },
          { sheets: 1, perSheet: 7 },
        ],
        loose: 0,
      }}
    />,
  );
  expect(screen.getByText('17 butir')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus baris 1' }));
  expect(screen.getByText('7 butir')).toBeInTheDocument();
  expect(screen.queryByLabelText('Lembar baris 2')).toBeNull();
});

test('jumlah baris dibatasi countRows', async () => {
  const rows = Array.from({ length: STICKER_LIMITS.countRows }, () => ({ sheets: 1, perSheet: 1 }));
  render(<Harness initial={{ rows, loose: 0 }} />);
  expect(screen.getByRole('button', { name: 'Tambah baris' })).toBeDisabled();
});

test('cleanCount membuang baris yang tidak menyumbang butir', () => {
  expect(
    cleanCount({
      rows: [
        { sheets: 0, perSheet: 0 },
        { sheets: 2, perSheet: 0 },
        { sheets: 3, perSheet: 4 },
      ],
      loose: 1,
    }),
  ).toEqual({ rows: [{ sheets: 3, perSheet: 4 }], loose: 1 });
});
