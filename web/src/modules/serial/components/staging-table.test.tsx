import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { addSerials, type StagingRow } from '../lib/draft';
import { rowStatus, StagingTable } from './staging-table';

// Regresi (laporan uji PWA ponsel 2026-11-13): teks `sr-only` (position: absolute) di kolom
// paling kanan tabel lebar TIDAK ikut terpotong wadah gulir bila wadahnya bukan blok
// penampung (`position: relative`); ia menambah lebar gulir halaman sehingga peramban
// ponsel memperkecil seluruh halaman begitu draft berisi baris.
test('wadah gulir tabel draft menampung elemen absolut (relative + overflow-x-auto)', () => {
  const noop = vi.fn();
  const { container } = render(
    <StagingTable
      rows={[]}
      onSelect={noop}
      onSelectAll={noop}
      onEdit={noop}
      onCommitSerial={() => null}
      onOpenDetail={noop}
      onRemove={noop}
    />,
  );
  const wrapper = container.querySelector('table')?.parentElement;
  expect(wrapper?.className).toContain('overflow-x-auto');
  expect(wrapper?.className).toContain('relative');
});

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

function photoRow(serial: string, ids: string[]): StagingRow {
  const [row] = addSerials(
    [],
    serial,
    {
      itemId: 'i1',
      itemLabel: 'Cisco',
      buId: 'b1',
      buLabel: 'BU1',
      testDate: '2026-11-12',
      locationId: 'l1',
      locationLabel: 'Jakarta',
      sample: false,
      note: '',
    },
    () => `id-${serial}`,
    () => '2026-11-12T10:00:00.000Z',
  ).rows;
  if (!row) throw new Error('seed');
  return {
    ...row,
    proofPhotos: ids.map((id) => ({
      id,
      mime: 'image/webp',
      size: 1,
      thumbUrl: `/api/v1/serial-proofs/${id}`,
    })),
  };
}

function renderTable(rows: StagingRow[], over: Partial<Parameters<typeof StagingTable>[0]> = {}) {
  const noop = vi.fn();
  const onEdit = vi.fn();
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <StagingTable
        rows={rows}
        onSelect={noop}
        onSelectAll={noop}
        onEdit={onEdit}
        onCommitSerial={() => null}
        onOpenDetail={noop}
        onRemove={noop}
        {...over}
      />
    </QueryClientProvider>,
  );
  return { ...view, onEdit };
}

test('kolom Foto: tiap baris menampilkan jumlah dan kisi fotonya', () => {
  renderTable([photoRow('AAA111', ['p1', 'p2']), photoRow('BBB222', [])]);
  expect(screen.getByRole('columnheader', { name: 'Foto' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Foto (2), AAA111' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Foto (0), BBB222' })).toBeInTheDocument();
  expect(screen.getAllByRole('img')).toHaveLength(2);
});

test('membuang foto di sel memanggil onEdit dengan daftar foto baru', async () => {
  apiMock.mockResolvedValue({ id: 'p1' });
  const { onEdit } = renderTable([photoRow('AAA111', ['p1', 'p2'])]);
  await userEvent.click(screen.getByRole('button', { name: 'Buang foto 1, AAA111' }));
  expect(apiMock).toHaveBeenCalledWith('serialProofs.remove', { id: 'p1' });
  expect(onEdit).toHaveBeenCalledWith('id-AAA111', {
    proofPhotos: [expect.objectContaining({ id: 'p2' })],
  });
});

test('saat menyimpan (disabled) tombol Foto dan buang terkunci', () => {
  renderTable([photoRow('AAA111', ['p1'])], { disabled: true });
  expect(screen.getByRole('button', { name: 'Foto (1), AAA111' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Buang foto 1, AAA111' })).toBeDisabled();
});

test('kamera foto baris memakai data barisnya untuk pratinjau cap (nama pelaku dari actorName)', async () => {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => ({}),
    getSettings: () => ({}),
    applyConstraints: vi.fn(),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(async () => stream), enumerateDevices: vi.fn(async () => []) },
    configurable: true,
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  renderTable([photoRow('AAA111', [])], { actorName: 'Budi' });
  await userEvent.click(screen.getByRole('button', { name: 'Foto (0), AAA111' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Kamera' }));
  const note = await screen.findByRole('note', { name: 'Pratinjau cap' });
  expect(note).toHaveTextContent('SN: AAA111');
  expect(note).toHaveTextContent('Cisco');
  expect(note).toHaveTextContent('BU1 · Jakarta');
  expect(note).toHaveTextContent('Disimpan saat Simpan · Budi (QC)');
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

test('tanpa actorName kamera foto baris tidak menampilkan pratinjau cap', async () => {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => ({}),
    getSettings: () => ({}),
    applyConstraints: vi.fn(),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(async () => stream), enumerateDevices: vi.fn(async () => []) },
    configurable: true,
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  renderTable([photoRow('AAA111', [])]);
  await userEvent.click(screen.getByRole('button', { name: 'Foto (0), AAA111' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Kamera' }));
  await screen.findByRole('button', { name: 'Ambil foto' });
  expect(screen.queryByTestId('stamp-preview')).not.toBeInTheDocument();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

test('rowStatus: item wajib foto dengan foto kurang = error "Butuh n foto lagi"; cukup atau tanpa proofMin = ok', () => {
  const base = photoRow('AAA111', ['p1']);
  expect(rowStatus({ ...base, proofMin: 3 })).toEqual({ tone: 'error', text: 'Butuh 2 foto lagi' });
  expect(rowStatus({ ...base, proofMin: 1 })).toEqual({ tone: 'ok', text: '' });
  expect(rowStatus(base)).toEqual({ tone: 'ok', text: '' });
  // Pemeriksaan lain didahulukan.
  expect(rowStatus({ ...base, proofMin: 3, locationId: '' }).text).toBe('Lokasi belum dipilih');
});

test('kolom Hasil menampilkan "Butuh n foto lagi" pada baris item wajib foto', () => {
  renderTable([{ ...photoRow('AAA111', []), proofMin: 2 }]);
  expect(screen.getByText('Butuh 2 foto lagi')).toBeInTheDocument();
});

test('kolom diringkas: tanpa kolom Sample, Catatan, dan Stiker; Lokasi dan tanggal uji dalam satu sel', () => {
  renderTable([photoRow('AAA111', [])]);
  const headers = screen
    .getAllByRole('columnheader')
    .map((header) => header.textContent?.trim() ?? '');
  expect(headers).toEqual([
    '',
    '#',
    'Serial',
    'Item',
    'Lokasi dan tanggal uji',
    'Foto',
    'Hasil',
    'Aksi',
  ]);
  const cell = screen.getByLabelText('Tanggal uji AAA111').closest('td');
  expect(cell).toHaveTextContent('Jakarta');
});

test('Sample, pilihan stiker, dan catatan tampil sebagai lencana di sel Item', () => {
  const base = photoRow('AAA111', []);
  renderTable([
    {
      ...base,
      sample: true,
      note: 'periksa',
      stickers: [{ stickerId: 's1', name: 'Stiker A', qty: 2 }],
    },
    { ...photoRow('BBB222', []), stickers: null },
  ]);
  const [first, second] = screen.getAllByRole('row').slice(1) as [HTMLElement, HTMLElement];
  expect(within(first).getByText('Sample')).toBeInTheDocument();
  expect(within(first).getByText('Stiker A ×2')).toBeInTheDocument();
  expect(within(first).getByText('Catatan: periksa')).toBeInTheDocument();
  expect(within(second).queryByText('Sample')).toBeNull();
  expect(within(second).queryByText(/Stiker/)).toBeNull();
});

test('atribut Panduan Interaktif tetap ada pada baris tabel', () => {
  const { container } = renderTable([photoRow('AAA111', [])]);
  expect(container.querySelector('tr[data-tour="serial-row"]')).not.toBeNull();
  expect(container.querySelector('[data-tour="serial-row-select"]')).not.toBeNull();
  expect(container.querySelector('[data-tour="serial-row-actions"]')).not.toBeNull();
});
