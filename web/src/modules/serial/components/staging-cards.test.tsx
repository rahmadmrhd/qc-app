import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { UploadEntry } from '@/components/file-dialog/use-background-uploads';
import { longPress } from '@/test/long-press';
import { makeRow, proofRef } from '../test-support';
import { StagingCards } from './staging-cards';

function renderCards(rows = [makeRow('AAA111'), makeRow('BBB222')], over = {}) {
  const onSelect = vi.fn();
  const onSelectAll = vi.fn();
  const onSelectMany = vi.fn();
  const onOpenDetail = vi.fn();
  const view = render(
    <StagingCards
      rows={rows}
      onSelect={onSelect}
      onSelectAll={onSelectAll}
      onSelectMany={onSelectMany}
      onOpenDetail={onOpenDetail}
      {...over}
    />,
  );
  return { ...view, onSelect, onSelectAll, onSelectMany, onOpenDetail };
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

test('mengetuk kartu membuka dialog ubah baris; kotak centang baru muncul di mode pilih', async () => {
  const { onOpenDetail, onSelect } = renderCards();
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Ubah baris BBB222' }));
  expect(onOpenDetail).toHaveBeenCalledWith('id-BBB222');
  expect(onSelect).not.toHaveBeenCalled();
});

test('tekan lama kartu memilih barisnya tanpa membuka dialog', async () => {
  const { onOpenDetail, onSelect } = renderCards();
  await longPress(screen.getAllByRole('listitem')[0] as HTMLElement);
  expect(onSelect).toHaveBeenCalledWith('id-AAA111', true);
  expect(onOpenDetail).not.toHaveBeenCalled();
});

test('tombol "Pilih baris draft" masuk mode pilih tanpa gestur (review I6)', async () => {
  const { onSelect } = renderCards();
  await userEvent.click(screen.getByRole('button', { name: 'Pilih baris draft' }));
  expect(screen.getByText('0 dipilih')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Pilih baris AAA111' })).not.toBeChecked();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris AAA111' }));
  expect(onSelect).toHaveBeenCalledWith('id-AAA111', true);
});

test('mode pilih (ada baris terpilih): kotak centang tampil dan Pilih semua di header mode pilih', async () => {
  const { onSelectMany, onSelect } = renderCards([
    makeRow('AAA111', { selected: true }),
    makeRow('BBB222'),
  ]);
  expect(screen.getByRole('checkbox', { name: 'Pilih baris AAA111' })).toBeChecked();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  expect(onSelectMany).toHaveBeenCalledWith(['id-AAA111', 'id-BBB222'], true);
  // Ketukan kartu di mode pilih mengubah pilihan, bukan membuka dialog.
  await userEvent.click(screen.getByRole('button', { name: 'Ubah baris BBB222' }));
  expect(onSelect).toHaveBeenCalledWith('id-BBB222', true);
});

test('mode pilih: seret dari lajur kotak centang kartu ke-2 ke kartu ke-4 memilih tiga baris lewat onSelectMany', () => {
  const rows = [
    makeRow('A1', { selected: true }),
    makeRow('B2'),
    makeRow('C3'),
    makeRow('D4'),
    makeRow('E5'),
  ];
  const { onSelectMany } = renderCards(rows);
  const items = screen.getAllByRole('listitem');
  const original = document.elementFromPoint;
  document.elementFromPoint = (_x: number, y: number) => items[Math.round(y / 100) - 1] ?? null;
  try {
    const lane = screen
      .getByRole('checkbox', { name: 'Pilih baris B2' })
      .closest('[data-select-lane]');
    expect(lane).not.toBeNull();
    fireEvent.pointerDown(lane as HTMLElement, {
      clientX: 10,
      clientY: 200,
      button: 0,
      pointerType: 'touch',
    });
    fireEvent.pointerMove(lane as HTMLElement, { clientX: 10, clientY: 400 });
    fireEvent.pointerUp(lane as HTMLElement);
  } finally {
    document.elementFromPoint = original;
  }
  const added = onSelectMany.mock.calls
    .filter(([, on]) => on === true)
    .flatMap(([ids]) => ids as string[]);
  expect(new Set(added)).toEqual(new Set(['id-B2', 'id-C3', 'id-D4']));
  expect(added).not.toContain('id-E5');
});

test('semua baris terpilih: Pilih semua tercentang', () => {
  renderCards([makeRow('A1', { selected: true }), makeRow('B2', { selected: true })]);
  expect(screen.getByRole('checkbox', { name: 'Pilih semua' })).toBeChecked();
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
  expect(card.querySelector('[data-tour="serial-row-select"]')).toBeNull();
});

test('saat disabled kartu terkunci dan tanpa mode pilih', () => {
  renderCards([makeRow('AAA111', { selected: true })], { disabled: true });
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
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

test('catatan Markdown tampil sebagai ringkasan teks polos pada lencana kartu', () => {
  renderCards([makeRow('AAA111', { note: '**Penting**: cek _kabel_\n\n- port 1\n- port 2' })]);
  const card = screen.getByRole('listitem');
  expect(
    within(card).getByText('Catatan: Penting: cek kabel - port 1 - port 2'),
  ).toBeInTheDocument();
});

const uploadEntry = (owner: string, over: Partial<UploadEntry> = {}): UploadEntry => ({
  key: `u-${owner}`,
  owner,
  file: new File([new Uint8Array(2)], 'baru.jpg', { type: 'image/jpeg' }),
  name: 'baru.jpg',
  phase: 'uploading',
  fraction: 0.4,
  error: null,
  ...over,
});

test('F2: unggahan berjalan tampil di kartu barisnya dengan tombol Batalkan', async () => {
  const onCancelUpload = vi.fn();
  renderCards(undefined, {
    uploadEntries: [uploadEntry('id-AAA111')],
    onCancelUpload,
    onRetryUpload: vi.fn(),
  });
  const first = screen.getAllByRole('listitem')[0] as HTMLElement;
  expect(within(first).getByTestId('attachment-pending')).toBeInTheDocument();
  expect(
    within(screen.getAllByRole('listitem')[1] as HTMLElement).queryByTestId('attachment-pending'),
  ).toBeNull();
  await userEvent.click(within(first).getByRole('button', { name: /^Batalkan / }));
  expect(onCancelUpload).toHaveBeenCalledWith('u-id-AAA111');
});

test('F2: unggahan gagal di kartu dapat diulang atau dibuang (pengguna ponsel tidak buntu)', async () => {
  const onRetryUpload = vi.fn();
  const onCancelUpload = vi.fn();
  renderCards(undefined, {
    uploadEntries: [
      uploadEntry('id-AAA111', { phase: 'failed', fraction: null, error: 'Server menolak' }),
    ],
    onRetryUpload,
    onCancelUpload,
  });
  const first = screen.getAllByRole('listitem')[0] as HTMLElement;
  expect(within(first).getByText('Server menolak')).toBeInTheDocument();
  await userEvent.click(within(first).getByRole('button', { name: /^Ulangi / }));
  expect(onRetryUpload).toHaveBeenCalledWith('u-id-AAA111');
  await userEvent.click(within(first).getByRole('button', { name: /^Buang / }));
  expect(onCancelUpload).toHaveBeenCalledWith('u-id-AAA111');
});
