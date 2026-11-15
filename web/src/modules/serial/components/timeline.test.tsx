import type { SerialEventDto, SerialProofPhotoDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
    proofPhotos: [],
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

const proof = (id: string, over: Partial<SerialProofPhotoDto> = {}): SerialProofPhotoDto => ({
  id,
  state: 'done',
  mime: 'image/webp',
  size: 1,
  width: 1,
  height: 1,
  filename: `bukti-${id}.webp`,
  error: null,
  ...over,
});

function renderWithClient(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

test('kartu dengan foto bukti menampilkan badge dan kisi; kartu tanpa foto tidak', () => {
  renderWithClient(
    <Timeline
      events={[
        event(1, { type: 'note' }),
        event(2, {
          type: 'recheck',
          data: { result: 'pass' },
          proofPhotos: [proof('p1'), proof('p2')],
        }),
      ]}
    />,
  );
  // Riwayat saat ini = seq 2 (berfoto).
  expect(screen.getAllByText('Bukti foto QC')).toHaveLength(1);
  expect(screen.getAllByRole('img')).toHaveLength(2);
});

test('kartu lama tanpa foto: tidak ada badge maupun kisi', () => {
  renderWithClient(<Timeline events={[event(1, { type: 'recorded' })]} />);
  expect(screen.queryByText('Bukti foto QC')).not.toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Foto bukti QC' })).not.toBeInTheDocument();
});

test('Coba lagi hanya muncul pada foto gagal bila proofCanRetry mengizinkan kejadiannya', () => {
  const failed = proof('p9', { state: 'failed', error: 'rusak' });
  const events = [event(1, { type: 'recorded', proofPhotos: [failed] })];
  const first = renderWithClient(<Timeline events={events} proofCanRetry={() => false} />);
  expect(screen.queryByRole('button', { name: 'Coba lagi' })).not.toBeInTheDocument();
  first.unmount();
  renderWithClient(<Timeline events={events} proofCanRetry={(entry) => entry.seq === 1} />);
  expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
});
