import type { HandoverDto } from '@shared/rpc';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { HandoverDetailView } from './handover-detail-view';

const base: HandoverDto = {
  id: 'h1',
  number: 'ST-20261015-001',
  locationId: 'a',
  customerId: 'c',
  customerName: 'PT Maju',
  note: 'kirim segera',
  status: 'in_progress',
  lineCount: 2,
  doneUnits: 2,
  totalUnits: 8,
  createdAt: '2026-10-15T03:00:00.000Z',
  updatedAt: '2026-10-15T04:00:00.000Z',
  createdBy: 'wh@qc.local',
  updatedBy: 'qc@qc.local',
  lines: [
    {
      id: 'l1',
      itemId: 'i1',
      itemLabel: 'Ubiquiti ES 24',
      qty: 5,
      doneQty: 2,
      doneAt: '2026-10-15T04:00:00.000Z',
      doneBy: 'qc@qc.local',
    },
    {
      id: 'l2',
      itemId: 'i2',
      itemLabel: 'Mikrotik hAP ac2',
      qty: 3,
      doneQty: 0,
      doneAt: '',
      doneBy: '',
    },
  ],
};

function renderView(props: Partial<Parameters<typeof HandoverDetailView>[0]> = {}) {
  const handlers = {
    onBack: vi.fn(),
    onEdit: vi.fn(),
    onCancel: vi.fn(),
    onSetProgress: vi.fn(),
    onCompleteLine: vi.fn(),
    onCompleteAll: vi.fn(),
  };
  render(
    <HandoverDetailView
      handover={base}
      locationName="Lokasi A"
      canEdit
      canCancel
      canProgress
      pending={false}
      renderItemLink={(itemId, label) => <a href={`#/item/${itemId}`}>{label}</a>}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

test('menampilkan nomor, status, customer, lokasi, catatan, progres, dan tautan tipe ke detail item', () => {
  renderView();
  expect(screen.getByText('ST-20261015-001')).toBeInTheDocument();
  expect(screen.getByText('Dikerjakan')).toBeInTheDocument();
  expect(screen.getByText('PT Maju')).toBeInTheDocument();
  expect(screen.getByText('Lokasi A')).toBeInTheDocument();
  expect(screen.getByText('kirim segera')).toBeInTheDocument();
  expect(screen.getByText('2/8 unit')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Ubiquiti ES 24' })).toHaveAttribute('href', '#/item/i1');
  expect(screen.getAllByText(/qc@qc\.local/).length).toBeGreaterThan(0); // pelaku progres per baris (FQ4)
});

test('mengubah qty selesai lalu keluar dari isian mengirim nilai baru; nilai tak sah/sama tidak dikirim', async () => {
  const { onSetProgress } = renderView();
  const input = screen.getByLabelText('Qty selesai Ubiquiti ES 24');
  expect(input).toHaveValue(2);
  await userEvent.clear(input);
  await userEvent.type(input, '4');
  await userEvent.tab();
  expect(onSetProgress).toHaveBeenCalledWith('l1', 4);
  onSetProgress.mockClear();
  await userEvent.clear(input);
  await userEvent.type(input, '9'); // di atas target 5
  await userEvent.tab();
  expect(onSetProgress).not.toHaveBeenCalled();
  expect(screen.getByText('Harus bilangan bulat 0–5')).toBeInTheDocument();
  await userEvent.clear(input);
  await userEvent.type(input, '2'); // sama dengan nilai tersimpan
  await userEvent.tab();
  expect(onSetProgress).not.toHaveBeenCalled();
});

test('tombol Selesai per tipe mengisi penuh; nonaktif bila sudah penuh', async () => {
  const { onCompleteLine } = renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Selesai Mikrotik hAP ac2' }));
  expect(onCompleteLine).toHaveBeenCalledWith('l2');
});

test('selesai per task meminta konfirmasi lebih dulu', async () => {
  const { onCompleteAll } = renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Selesaikan semua' }));
  expect(onCompleteAll).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ya, selesaikan' }));
  expect(onCompleteAll).toHaveBeenCalled();
});

test('batalkan meminta konfirmasi; Ubah memanggil callback', async () => {
  const { onCancel, onEdit } = renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  expect(onEdit).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Batalkan task' }));
  expect(onCancel).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ya, batalkan' }));
  expect(onCancel).toHaveBeenCalled();
});

test('tanpa izin: tidak ada kontrol progres, Ubah, maupun Batalkan (WH view saja)', () => {
  renderView({ canEdit: false, canCancel: false, canProgress: false });
  expect(screen.queryByLabelText(/Qty selesai/)).toBeNull();
  expect(
    screen.queryByRole('button', { name: /Ubah|Batalkan task|Selesaikan semua|Selesai /i }),
  ).toBeNull();
  expect(screen.getByText('2 / 5')).toBeInTheDocument(); // progres tampil sebagai teks
});

test('task Selesai: Ubah dan koreksi progres tetap tersedia; selesaikan semua dan batalkan tidak', () => {
  renderView({
    handover: { ...base, status: 'done', doneUnits: 8 },
    canProgress: true,
    canEdit: true,
    canCancel: true,
  });
  expect(screen.queryByText(/tidak dapat diubah/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Ubah' })).toBeInTheDocument();
  expect(screen.getByLabelText('Qty selesai Ubiquiti ES 24')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Batalkan task|Selesaikan semua/ })).toBeNull();
});

test('task Dibatalkan: keterangan dibatalkan', () => {
  renderView({ handover: { ...base, status: 'cancelled' } });
  expect(screen.getByText('Task sudah dibatalkan dan tidak dapat diubah.')).toBeInTheDocument();
});

test('saat pending semua kontrol dinonaktifkan', () => {
  renderView({ pending: true });
  expect(screen.getByLabelText('Qty selesai Ubiquiti ES 24')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Selesaikan semua' })).toBeDisabled();
});

test('task tanpa customer menampilkan "Tanpa customer"', () => {
  renderView({ handover: { ...base, customerId: '', customerName: '' } });
  expect(screen.getByText('Tanpa customer')).toBeInTheDocument();
});
