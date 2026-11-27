import type { WarehouseHandoverCandidateDto } from '@shared/contract';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { HandoverLinkPicker, type HandoverLinkPickerProps } from './handover-link-picker';

const cand = (over: Partial<WarehouseHandoverCandidateDto>): WarehouseHandoverCandidateDto => ({
  id: 't1',
  number: 'ST-20261120-001',
  createdAt: '2026-11-20T02:00:00.000Z',
  preview: 'Tenda AX300 5 unit',
  status: 'in_progress',
  linked: false,
  mentionsItem: false,
  ...over,
});

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue({
    linked: [cand({ id: 'tl', number: 'ST-20261119-009', linked: true })],
    items: [cand({ id: 't1', mentionsItem: true }), cand({ id: 't2', number: 'ST-20261120-002' })],
    nextCursor: null,
  });
});

function Harness(props: Partial<HandoverLinkPickerProps> & { onValue?: (ids: string[]) => void }) {
  const { onValue, ...rest } = props;
  const [value, setValue] = useState<string[]>(props.value ?? []);
  return (
    <HandoverLinkPicker
      {...rest}
      value={value}
      onChange={(ids) => {
        setValue(ids);
        onValue?.(ids);
      }}
    />
  );
}

test('tanpa customer: petunjuk dan kolom cari, tanpa memanggil server', async () => {
  await renderInRouter(<Harness />);
  expect(screen.getByText(/Isi customer dulu/)).toBeInTheDocument();
  expect(screen.getByLabelText('Cari task lain')).toBeInTheDocument();
  expect(apiMock).not.toHaveBeenCalled();
});

test('tanpa centang otomatis; task tertaut di atas dan lencana Menyebut Item', async () => {
  await renderInRouter(<Harness customerId="c1" orderId="o1" itemId="i1" />);
  const boxes = await screen.findAllByRole('checkbox', { name: /Tautkan task/ });
  expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual([
    'Tautkan task ST-20261119-009',
    'Tautkan task ST-20261120-001',
    'Tautkan task ST-20261120-002',
  ]);
  for (const box of boxes) expect(box).not.toBeChecked();
  expect(screen.getByText('Sudah tertaut')).toBeInTheDocument();
  expect(screen.getByText('Menyebut Item ini')).toBeInTheDocument();
  expect(apiMock).toHaveBeenCalledWith(
    'serialWarehouse.handoverCandidates',
    expect.objectContaining({ customerId: 'c1', orderId: 'o1', itemId: 'i1' }),
  );
});

test('mencentang memanggil onChange; task tertaut yang ada di value tercentang', async () => {
  const onValue = vi.fn();
  await renderInRouter(<Harness customerId="c1" value={['tl']} onValue={onValue} />);
  expect(await screen.findByRole('checkbox', { name: /ST-20261119-009/ })).toBeChecked();
  await userEvent.click(screen.getByRole('checkbox', { name: /ST-20261120-002/ }));
  expect(onValue).toHaveBeenLastCalledWith(['tl', 't2']);
});

test('task asal terkunci: tercentang dan tidak dapat dilepas', async () => {
  await renderInRouter(<Harness customerId="c1" lockedIds={['t1']} />);
  const box = await screen.findByRole('checkbox', { name: /ST-20261120-001/ });
  expect(box).toBeChecked();
  expect(box).toBeDisabled();
  expect(screen.getByText('Task asal')).toBeInTheDocument();
});

test('task asal yang tak ada di hasil tetap tampil sebagai pilihan terkunci', async () => {
  await renderInRouter(<Harness customerId="c1" lockedIds={['zzz']} />);
  expect(await screen.findByText('Task asal (terkunci)')).toBeInTheDocument();
});

test('maksimal 20 task: sisanya nonaktif', async () => {
  const many = Array.from({ length: 20 }, (_, index) => `x${index}`);
  await renderInRouter(<Harness customerId="c1" value={many} />);
  expect(await screen.findByRole('checkbox', { name: /ST-20261120-002/ })).toBeDisabled();
  expect(screen.getByText(/Paling banyak 20 task/)).toBeInTheDocument();
});

test('kosong: pesan tidak ada task berjalan', async () => {
  apiMock.mockResolvedValue({ linked: [], items: [], nextCursor: null });
  await renderInRouter(<Harness customerId="c1" />);
  expect(await screen.findByText(/Tidak ada task berjalan untuk customer ini/)).toBeInTheDocument();
});

test('saklar Tampilkan yang sudah selesai meminta includeFinished', async () => {
  await renderInRouter(<Harness customerId="c1" />);
  await screen.findAllByRole('checkbox', { name: /Tautkan task/ });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Tampilkan yang sudah selesai' }));
  await vi.waitFor(() =>
    expect(apiMock).toHaveBeenLastCalledWith(
      'serialWarehouse.handoverCandidates',
      expect.objectContaining({ includeFinished: true }),
    ),
  );
});
