import type { SerialEventDto } from '@shared/contract';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Timeline } from './timeline';

function event(seq: number, over: Partial<SerialEventDto> = {}): SerialEventDto {
  return {
    id: `e${seq}`,
    seq,
    caseId: null,
    type: 'note',
    occurredOn: '2026-11-12',
    createdAt: '',
    actorName: 'Budi',
    actorTeam: 'qc',
    message: `Catatan nomor ${seq}`,
    changes: [],
    data: {},
    ...over,
  } as SerialEventDto;
}

const seqsShown = () =>
  within(screen.getByRole('list', { name: 'Linimasa' }))
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('data-seq'))
    .filter(Boolean);

test('semua riwayat lama dilipat jadi satu kelompok; riwayat saat ini selalu tampil', () => {
  render(<Timeline events={[event(3), event(1), event(2)]} />);
  const previous = screen.getByRole('button', { name: 'Tampilkan riwayat sebelumnya' });
  expect(previous).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('heading', { name: 'Riwayat saat ini' })).toBeInTheDocument();
  // Hanya riwayat terbaru yang tampil; isi riwayat lama tidak ada di halaman.
  expect(seqsShown()).toEqual(['3']);
  expect(screen.getByText('Catatan nomor 3')).toBeInTheDocument();
  expect(screen.queryByText('Catatan nomor 1')).toBeNull();
  expect(screen.queryByText('Catatan nomor 2')).toBeNull();
});

test('membuka kelompok sebelumnya menampilkan semua riwayat lama lengkap, urut lama di atas', async () => {
  render(<Timeline events={[event(3), event(1), event(2)]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Tampilkan riwayat sebelumnya' }));
  expect(seqsShown()).toEqual(['1', '2', '3']);
  // Setiap kartu lengkap (tanpa lipatan per kartu): isinya langsung terlihat.
  expect(screen.getByText('Catatan nomor 1')).toBeInTheDocument();
  expect(screen.getByText('Catatan nomor 2')).toBeInTheDocument();
  const hide = screen.getByRole('button', { name: 'Sembunyikan riwayat sebelumnya' });
  expect(hide).toHaveAttribute('aria-expanded', 'true');
  // Tidak ada tombol lipat per kartu maupun untuk riwayat saat ini: hanya satu pelipat (riwayat sebelumnya).
  expect(screen.getAllByRole('button')).toHaveLength(1);
  await userEvent.click(hide);
  expect(seqsShown()).toEqual(['3']);
});

test('riwayat saat ini tidak dapat dilipat: judulnya bukan tombol dan kartunya tetap tampil', async () => {
  render(<Timeline events={[event(1), event(2)]} />);
  expect(screen.queryByRole('button', { name: 'Riwayat saat ini' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Tampilkan riwayat sebelumnya' }));
  await userEvent.click(screen.getByRole('button', { name: 'Sembunyikan riwayat sebelumnya' }));
  expect(screen.getByRole('heading', { name: 'Riwayat saat ini' })).toBeInTheDocument();
  expect(seqsShown()).toEqual(['2']);
});

test('satu riwayat saja: tanpa pelipat riwayat sebelumnya', () => {
  render(<Timeline events={[event(1)]} />);
  expect(screen.queryByRole('button', { name: /riwayat sebelumnya/i })).toBeNull();
  expect(seqsShown()).toEqual(['1']);
});

test('badge Terbaru hanya pada riwayat saat ini dan hanya bila diminta', async () => {
  const { rerender } = render(<Timeline events={[event(1), event(2)]} markLatest />);
  await userEvent.click(screen.getByRole('button', { name: 'Tampilkan riwayat sebelumnya' }));
  expect(screen.getAllByText('Terbaru')).toHaveLength(1);
  expect(
    within(document.querySelector('[data-seq="2"]') as HTMLElement).getByText('Terbaru'),
  ).toBeInTheDocument();
  rerender(<Timeline events={[event(1), event(2)]} />);
  expect(screen.queryByText('Terbaru')).toBeNull();
});

test('slot muat lama berada di dalam kelompok sebelumnya dan memunculkan kelompok walau baru satu riwayat dimuat', async () => {
  render(
    <Timeline
      events={[event(5)]}
      loadOlder={<button type="button">Muat yang lebih lama</button>}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Muat yang lebih lama' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Tampilkan riwayat sebelumnya' }));
  expect(screen.getByRole('button', { name: 'Muat yang lebih lama' })).toBeInTheDocument();
});

test('catatan pengiriman tampil di rincian kartu kirim', () => {
  render(
    <Timeline
      events={[
        event(2, {
          type: 'send',
          message: '',
          data: {
            leg: 'to_service',
            fromLocationName: 'Surabaya',
            toLocationName: 'Jakarta',
            shipmentNote: 'JNE resi 123456',
          },
        }),
      ]}
    />,
  );
  expect(screen.getByText('Catatan pengiriman: JNE resi 123456')).toBeInTheDocument();
});
