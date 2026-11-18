import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { makeRow, proofRef } from '../test-support';
import { StagingCards } from './staging-cards';

function renderCards(rows = [makeRow('AAA111'), makeRow('BBB222')], over = {}) {
  const onSelect = vi.fn();
  const onSelectAll = vi.fn();
  const onOpenDetail = vi.fn();
  const view = render(
    <StagingCards
      rows={rows}
      onSelect={onSelect}
      onSelectAll={onSelectAll}
      onOpenDetail={onOpenDetail}
      {...over}
    />,
  );
  return { ...view, onSelect, onSelectAll, onOpenDetail };
}

test('merender kartu tanpa elemen table: serial, item dan BU, lokasi dan tanggal', () => {
  renderCards();
  expect(document.querySelector('table')).toBeNull();
  const cards = screen.getAllByRole('listitem');
  expect(cards).toHaveLength(2);
  const first = cards[0] as HTMLElement;
  expect(within(first).getByText('AAA111')).toBeInTheDocument();
  expect(within(first).getByText('Cisco C9200 · BU1')).toBeInTheDocument();
  expect(within(first).getByText('Jakarta (JKT) · 2026-11-12')).toBeInTheDocument();
  expect(within(first).queryByText('Siap')).toBeNull();
});

test('mengetuk kartu membuka dialog ubah baris; mencentang tidak', async () => {
  const { onOpenDetail, onSelect } = renderCards();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris AAA111' }));
  expect(onSelect).toHaveBeenCalledWith('id-AAA111', true);
  expect(onOpenDetail).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah baris BBB222' }));
  expect(onOpenDetail).toHaveBeenCalledWith('id-BBB222');
});

test('Pilih semua di atas daftar', async () => {
  const { onSelectAll } = renderCards();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua baris' }));
  expect(onSelectAll).toHaveBeenCalledWith(true);
});

test('baris tercentang semua: Pilih semua tercentang', () => {
  renderCards([makeRow('A1', { selected: true }), makeRow('B2', { selected: true })]);
  expect(screen.getByRole('checkbox', { name: 'Pilih semua baris' })).toBeChecked();
});

test('lencana: status bermasalah, jumlah foto, Sample, stiker, catatan; atribut panduan ada', () => {
  const rows = [
    makeRow('AAA111', {
      itemId: '',
      itemLabel: '',
      sample: true,
      note: 'periksa',
      stickers: [{ stickerId: 's1', name: 'Stiker A', qty: 2 }],
      proofPhotos: [proofRef('p1'), proofRef('p2')],
    }),
  ];
  renderCards(rows);
  const card = screen.getByRole('listitem');
  expect(within(card).getByText('Item belum dipilih')).toBeInTheDocument();
  expect(within(card).getByText('2 foto')).toBeInTheDocument();
  expect(within(card).getByText('Sample')).toBeInTheDocument();
  expect(within(card).getByText('Stiker A ×2')).toBeInTheDocument();
  expect(within(card).getByText('Catatan: periksa')).toBeInTheDocument();
  expect(card).toHaveAttribute('data-tour', 'serial-row');
  expect(card.querySelector('[data-tour="serial-row-select"]')).not.toBeNull();
});

test('saat disabled kartu dan centang terkunci', () => {
  renderCards([makeRow('AAA111')], { disabled: true });
  expect(screen.getByRole('checkbox', { name: 'Pilih baris AAA111' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Ubah baris AAA111' })).toBeDisabled();
});

test('item wajib foto dengan foto kurang menampilkan "Butuh n foto lagi" pada kartu', () => {
  renderCards([
    makeRow('AAA111', { proofMin: 3, proofPhotos: [proofRef('p1')] }),
    makeRow('BBB222', { proofMin: 1, proofPhotos: [proofRef('p2')] }),
  ]);
  const [first, second] = screen.getAllByRole('listitem') as [HTMLElement, HTMLElement];
  expect(within(first).getByText('Butuh 2 foto lagi')).toBeInTheDocument();
  expect(within(first).queryByText('Siap')).toBeNull();
  expect(within(second).queryByText('Siap')).toBeNull();
});

test('kartu siap tanpa lencana status; kartu bermasalah memperlihatkan statusnya', () => {
  renderCards([
    makeRow('OKOK01'),
    makeRow('BAD001', { locationId: '', locationLabel: '' }),
    makeRow('DUP001', { result: 'duplicate', message: 'Serial sudah terdaftar' }),
    makeRow('NEED01', { proofMin: 2 }),
  ]);
  const [ok, bad, dup, need] = screen.getAllByRole('listitem') as HTMLElement[];
  expect(within(ok as HTMLElement).queryByText('Siap')).toBeNull();
  expect(within(ok as HTMLElement).queryByText(/belum|Butuh|sudah terdaftar/)).toBeNull();
  expect(within(bad as HTMLElement).getByText('Lokasi belum dipilih')).toBeInTheDocument();
  expect(within(dup as HTMLElement).getByText('Serial sudah terdaftar')).toBeInTheDocument();
  expect(within(need as HTMLElement).getByText('Butuh 2 foto lagi')).toBeInTheDocument();
  // Nama tombol kartu siap tidak membawa teks status tersembunyi.
  expect(screen.getByRole('button', { name: 'Ubah baris OKOK01' })).toBeInTheDocument();
});

test('kartu bermasalah menyiarkan statusnya lewat aria-describedby; kartu siap tanpa deskripsi', () => {
  renderCards([makeRow('OKOK01'), makeRow('NEED01', { proofMin: 2 })]);
  const ok = screen.getByRole('button', { name: 'Ubah baris OKOK01' });
  expect(ok).not.toHaveAttribute('aria-describedby');
  const need = screen.getByRole('button', { name: 'Ubah baris NEED01' });
  expect(need).toHaveAccessibleDescription('Butuh 2 foto lagi');
});
