import type { WarehouseHandoverCandidateDto } from '@shared/contract';
import { screen, within } from '@testing-library/react';
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
  note: '- [ ] Tenda AX300 5 unit',
  checklist: [{ index: 0, text: 'Tenda AX300 5 unit', checked: false, by: '', at: '' }],
  matchedLines: [],
  mismatchLines: [],
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

test('lokasi kosong: terkunci dengan petunjuk, tanpa memanggil server', async () => {
  await renderInRouter(<Harness locationId="" />);
  expect(screen.getByText(/Pilih Lokasi dulu/)).toBeInTheDocument();
  expect(screen.getByLabelText('Cari task')).toBeDisabled();
  expect(apiMock).not.toHaveBeenCalled();
});

test('lokasi terisi: semua task dimuat tanpa customer, dikirim dengan locationId dan limit', async () => {
  await renderInRouter(<Harness locationId="loc1" itemId="i1" orderId="o1" />);
  const boxes = await screen.findAllByRole('checkbox', { name: /Tautkan task/ });
  // Urutan server dipertahankan: yang tertaut di depan, lalu daftar.
  expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual([
    'Tautkan task ST-20261119-009',
    'Tautkan task ST-20261120-001',
    'Tautkan task ST-20261120-002',
  ]);
  for (const box of boxes) expect(box).not.toBeChecked();
  expect(screen.getByText('Sudah tertaut')).toBeInTheDocument();
  expect(screen.getByText('Menyebut Item ini')).toBeInTheDocument();
  const [, input] = apiMock.mock.calls[0] ?? [];
  expect(input).toMatchObject({ locationId: 'loc1', itemId: 'i1', orderId: 'o1', limit: 20 });
  expect(input).not.toHaveProperty('customerId');
  expect(input).not.toHaveProperty('customerName');
});

test('customer yang terisi hanya menyaring', async () => {
  await renderInRouter(<Harness locationId="loc1" customerId="c1" />);
  await screen.findAllByRole('checkbox', { name: /Tautkan task/ });
  expect(apiMock).toHaveBeenCalledWith(
    'serialWarehouse.handoverCandidates',
    expect.objectContaining({ locationId: 'loc1', customerId: 'c1' }),
  );
});

test('tanpa batas lokasi (detail SO): daftar langsung dimuat tanpa locationId', async () => {
  await renderInRouter(<Harness customerId="c1" orderId="o1" />);
  await screen.findAllByRole('checkbox', { name: /Tautkan task/ });
  const [, input] = apiMock.mock.calls[0] ?? [];
  expect(input).not.toHaveProperty('locationId');
});

test('tidak ada kotak Tampilkan yang sudah selesai', async () => {
  await renderInRouter(<Harness locationId="loc1" />);
  await screen.findAllByRole('checkbox', { name: /Tautkan task/ });
  expect(screen.queryByLabelText('Tampilkan yang sudah selesai')).toBeNull();
});

test('mencentang memanggil onChange; task tertaut yang ada di value tercentang', async () => {
  const onValue = vi.fn();
  await renderInRouter(<Harness locationId="loc1" value={['tl']} onValue={onValue} />);
  expect(await screen.findByRole('checkbox', { name: /ST-20261119-009/ })).toBeChecked();
  await userEvent.click(screen.getByRole('checkbox', { name: /ST-20261120-002/ }));
  expect(onValue).toHaveBeenLastCalledWith(['tl', 't2']);
});

test('task asal terkunci: tercentang dan tidak dapat dilepas', async () => {
  await renderInRouter(<Harness locationId="loc1" lockedIds={['t1']} />);
  const box = await screen.findByRole('checkbox', { name: /ST-20261120-001/ });
  expect(box).toBeChecked();
  expect(box).toBeDisabled();
  expect(screen.getByText('Task asal')).toBeInTheDocument();
});

test('task asal yang tak ada di hasil tetap tampil sebagai pilihan terkunci', async () => {
  await renderInRouter(<Harness locationId="loc1" lockedIds={['zzz']} />);
  expect(await screen.findByText('Task asal (terkunci)')).toBeInTheDocument();
});

test('maksimal 20 task: sisanya nonaktif', async () => {
  const many = Array.from({ length: 20 }, (_, index) => `x${index}`);
  await renderInRouter(<Harness locationId="loc1" value={many} />);
  expect(await screen.findByRole('checkbox', { name: /ST-20261120-002/ })).toBeDisabled();
  expect(screen.getByText(/Paling banyak 20 task/)).toBeInTheDocument();
});

test('kosong: pesan tidak ada task di lokasi ini', async () => {
  apiMock.mockResolvedValue({ linked: [], items: [], nextCursor: null });
  await renderInRouter(<Harness locationId="loc1" />);
  expect(await screen.findByText(/Tidak ada task di lokasi ini/)).toBeInTheDocument();
});

test('Muat lebih banyak memuat halaman berikutnya lewat kursor', async () => {
  apiMock.mockImplementation((_id: string, input: { cursor?: string }) =>
    Promise.resolve(
      input.cursor
        ? { linked: [], items: [cand({ id: 't9', number: 'ST-20261101-009' })], nextCursor: null }
        : { linked: [], items: [cand({ id: 't1' })], nextCursor: 'c2' },
    ),
  );
  await renderInRouter(<Harness locationId="loc1" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Muat lebih banyak' }));
  expect(await screen.findByRole('checkbox', { name: /ST-20261101-009/ })).toBeInTheDocument();
  expect(apiMock).toHaveBeenLastCalledWith(
    'serialWarehouse.handoverCandidates',
    expect.objectContaining({ cursor: 'c2' }),
  );
  expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).toBeNull();
});

test('kartu menampilkan catatan hanya-baca dengan centang dari checklist', async () => {
  apiMock.mockResolvedValue({
    linked: [],
    items: [
      cand({
        id: 't1',
        note: '- [x] Tenda AX300 5 unit\n- [ ] Router lain 2 unit',
        checklist: [
          { index: 0, text: 'Tenda AX300 5 unit', checked: true, by: 'qc', at: '2026-11-20' },
          { index: 1, text: 'Router lain 2 unit', checked: false, by: '', at: '' },
        ],
      }),
    ],
    nextCursor: null,
  });
  await renderInRouter(<Harness locationId="loc1" />);
  const note = await screen.findByTestId('candidate-note');
  const boxes = within(note).getAllByRole('checkbox');
  expect(boxes).toHaveLength(2);
  expect(boxes[0]).toBeChecked();
  expect(boxes[1]).not.toBeChecked();
  for (const box of boxes) expect(box).toBeDisabled();
});

test('baris yang menyebut Item terpilih ditandai hijau dan Item lain kuning, dengan teks pembaca layar', async () => {
  apiMock.mockResolvedValue({
    linked: [],
    items: [
      cand({
        id: 't1',
        mentionsItem: true,
        note: '- [ ] Tenda AX300 5 unit\n- [ ] Router lain 2 unit\n- [ ] Kabel',
        checklist: [
          { index: 0, text: 'Tenda AX300 5 unit', checked: false, by: '', at: '' },
          { index: 1, text: 'Router lain 2 unit', checked: false, by: '', at: '' },
          { index: 2, text: 'Kabel', checked: false, by: '', at: '' },
        ],
        matchedLines: ['Tenda AX300 5 unit'],
        mismatchLines: ['Router lain 2 unit'],
      }),
    ],
    nextCursor: null,
  });
  await renderInRouter(<Harness locationId="loc1" itemId="i1" />);
  const note = await screen.findByTestId('candidate-note');
  expect(within(note).getByText('Menyebut Item ini:')).toBeInTheDocument();
  expect(within(note).getByText('Menyebut Item lain:')).toBeInTheDocument();
  expect(within(note).getAllByText(/Menyebut Item (ini|lain):/)).toHaveLength(2);
  const matchedRow = within(note).getByText('Menyebut Item ini:').closest('[data-mark]');
  expect(matchedRow?.className).toContain('border-success-text');
  const otherRow = within(note).getByText('Menyebut Item lain:').closest('[data-mark]');
  expect(otherRow?.className).toContain('border-warning-text');
  expect(screen.getByText(/Baris hijau: menyebut Item ini/)).toBeInTheDocument();
  expect(screen.getByText(/Baris kuning: menyebut Item lain/)).toBeInTheDocument();
});

test('registry diisi dengan task yang dimuat', async () => {
  const registry = { current: new Map<string, WarehouseHandoverCandidateDto>() };
  await renderInRouter(<Harness locationId="loc1" registry={registry} />);
  await screen.findAllByRole('checkbox', { name: /Tautkan task/ });
  expect([...registry.current.keys()].sort()).toEqual(['t1', 't2', 'tl']);
});

test('soft break: tiap baris paragraf ditandai sendiri, baris pertama cocok tidak mewarnai baris lain', async () => {
  apiMock.mockResolvedValue({
    linked: [],
    items: [
      cand({
        id: 't1',
        mentionsItem: true,
        note: 'Tenda AX300 5 unit\nKabel biasa\nRouter lain 2 unit\nTenda AX300 lagi',
        checklist: [],
        matchedLines: ['Tenda AX300 5 unit', 'Tenda AX300 lagi'],
        mismatchLines: ['Router lain 2 unit'],
      }),
    ],
    nextCursor: null,
  });
  await renderInRouter(<Harness locationId="loc1" itemId="i1" />);
  const note = await screen.findByTestId('candidate-note');
  const marks = [...note.querySelectorAll('[data-mark]')].map((el) => [
    el.getAttribute('data-mark'),
    el.textContent?.replace(/Menyebut Item (ini|lain): /, ''),
  ]);
  expect(marks).toEqual([
    ['match', 'Tenda AX300 5 unit'],
    ['mismatch', 'Router lain 2 unit'],
    ['match', 'Tenda AX300 lagi'],
  ]);
  expect(within(note).getByText('Kabel biasa').closest('[data-mark]')).toBeNull();
});

test('kosong karena customer: pesan menyebut customer', async () => {
  apiMock.mockResolvedValue({ linked: [], items: [], nextCursor: null });
  await renderInRouter(<Harness locationId="loc1" customerId="c1" />);
  expect(
    await screen.findByText('Tidak ada task untuk customer ini di lokasi ini'),
  ).toBeInTheDocument();
});
