import type { StockEntryDto } from '@shared/contract';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { mockMatchMedia } from '@/test/match-media';
import { StockHistory } from './stock-history';

const entries: StockEntryDto[] = [
  {
    id: 'e2',
    stickerId: 's1',
    locationId: 'l-a',
    kind: 'out',
    delta: -20,
    qtyAfter: 130,
    count: null,
    reason: 'Dipakai QC',
    actor: 'budi@gmail.com',
    ts: '2026-11-09T09:00:00.000Z',
  },
  {
    id: 'e1',
    stickerId: 's1',
    locationId: 'l-b',
    kind: 'in',
    delta: 155,
    qtyAfter: 155,
    count: {
      rows: [
        { sheets: 10, perSheet: 12 },
        { sheets: 3, perSheet: 10 },
      ],
      loose: 5,
    },
    reason: '',
    actor: 'ani@gmail.com',
    ts: '2026-11-08T09:00:00.000Z',
  },
];
const locationNames = new Map([
  ['l-a', 'Jakarta'],
  ['l-b', 'Bandung'],
]);

test('menampilkan jenis, perubahan bertanda, stok sesudah, alasan, dan pelaku', () => {
  render(
    <StockHistory
      entries={entries}
      locationNames={locationNames}
      showLocation
      hasMore={false}
      loadingMore={false}
      onLoadMore={() => undefined}
    />,
  );
  const out = screen.getByRole('row', { name: /Dipakai QC/ });
  expect(within(out).getByText('Keluar')).toBeInTheDocument();
  expect(within(out).getByText('-20')).toBeInTheDocument();
  expect(within(out).getByText('130')).toBeInTheDocument();
  expect(within(out).getByText('Jakarta')).toBeInTheDocument();
  expect(within(out).getByText('budi@gmail.com')).toBeInTheDocument();
  const masuk = screen.getByRole('row', { name: /ani@gmail.com/ });
  expect(within(masuk).getByText('+155')).toBeInTheDocument();
  expect(within(masuk).getByText(/10 × 12/)).toBeInTheDocument();
  expect(within(masuk).getByText(/5 butir/)).toBeInTheDocument();
});

test('kolom Lokasi hanya bila showLocation', () => {
  render(
    <StockHistory
      entries={entries}
      locationNames={locationNames}
      showLocation={false}
      hasMore={false}
      loadingMore={false}
      onLoadMore={() => undefined}
    />,
  );
  expect(screen.queryByRole('columnheader', { name: 'Lokasi' })).toBeNull();
});

test('kosong menampilkan keterangan; tombol muat lebih banyak memakai kursor server', async () => {
  const onLoadMore = vi.fn();
  const { rerender } = render(
    <StockHistory
      entries={[]}
      locationNames={locationNames}
      showLocation
      hasMore={false}
      loadingMore={false}
      onLoadMore={onLoadMore}
    />,
  );
  expect(screen.getByText('Belum ada riwayat.')).toBeInTheDocument();
  rerender(
    <StockHistory
      entries={entries}
      locationNames={locationNames}
      showLocation
      hasMore
      loadingMore={false}
      onLoadMore={onLoadMore}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
  expect(onLoadMore).toHaveBeenCalledTimes(1);
});

test('desktop: riwayat berupa tabel (tanpa kartu)', () => {
  render(
    <StockHistory
      entries={entries}
      locationNames={locationNames}
      showLocation
      hasMore={false}
      loadingMore={false}
      onLoadMore={() => undefined}
    />,
  );
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(document.querySelector('[data-slot="mobile-card"]')).toBeNull();
});

test('P6 ponsel: riwayat berupa kartu MobileCard (jenis + waktu, meta berlabel), bukan tabel', async () => {
  window.innerWidth = 360;
  const media = mockMatchMedia(false);
  try {
    const onLoadMore = vi.fn();
    render(
      <StockHistory
        entries={entries}
        locationNames={locationNames}
        showLocation
        hasMore
        loadingMore={false}
        onLoadMore={onLoadMore}
      />,
    );
    expect(screen.queryByRole('table')).toBeNull();
    const cards = document.querySelectorAll('[data-slot="mobile-card"]');
    expect(cards).toHaveLength(2);
    const keluar = within(cards[0] as HTMLElement);
    expect(keluar.getByText('Keluar')).toBeInTheDocument();
    expect(keluar.getByText('Perubahan')).toBeInTheDocument();
    expect(keluar.getByText('-20')).toBeInTheDocument();
    expect(keluar.getByText('Stok sesudah')).toBeInTheDocument();
    expect(keluar.getByText('130')).toBeInTheDocument();
    expect(keluar.getByText('Lokasi')).toBeInTheDocument();
    expect(keluar.getByText('Jakarta')).toBeInTheDocument();
    expect(keluar.getByText('Oleh')).toBeInTheDocument();
    expect(keluar.getByText('budi@gmail.com')).toBeInTheDocument();
    expect(keluar.getByText('Alasan')).toBeInTheDocument();
    expect(keluar.getByText('Dipakai QC')).toBeInTheDocument();
    const masuk = within(cards[1] as HTMLElement);
    expect(masuk.getByText('+155')).toBeInTheDocument();
    expect(masuk.getByText(/10 × 12/)).toBeInTheDocument();
    expect(masuk.queryByText('Alasan')).not.toBeNull(); // hitungan lembar tampil sebagai alasan
    await userEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  } finally {
    media.restore();
    window.innerWidth = 1024;
  }
});

test('P6 ponsel: kartu tanpa lokasi bila showLocation false; kosong menampilkan keterangan', () => {
  window.innerWidth = 360;
  const media = mockMatchMedia(false);
  try {
    const { rerender } = render(
      <StockHistory
        entries={entries}
        locationNames={locationNames}
        showLocation={false}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => undefined}
      />,
    );
    expect(screen.queryByText('Lokasi')).toBeNull();
    rerender(
      <StockHistory
        entries={[]}
        locationNames={locationNames}
        showLocation
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => undefined}
      />,
    );
    expect(screen.getByText('Belum ada riwayat.')).toBeInTheDocument();
  } finally {
    media.restore();
    window.innerWidth = 1024;
  }
});
