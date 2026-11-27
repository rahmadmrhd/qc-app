import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import type { UploadEntry } from '@/components/file-dialog/use-background-uploads';
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
      onSelectMany={noop}
      onEdit={noop}
      onCommitSerial={() => null}
      onOpenDetail={noop}
      onRemove={noop}
      uploadEntries={[]}
      onUploadFiles={noop}
      onRetryUpload={noop}
      onCancelUpload={noop}
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
  const onSelectMany = vi.fn();
  const onUploadFiles = vi.fn();
  const onRetryUpload = vi.fn();
  const onCancelUpload = vi.fn();
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <StagingTable
        rows={rows}
        onSelect={noop}
        onSelectAll={noop}
        onSelectMany={onSelectMany}
        onEdit={onEdit}
        onCommitSerial={() => null}
        onOpenDetail={noop}
        onRemove={noop}
        uploadEntries={[]}
        onUploadFiles={onUploadFiles}
        onRetryUpload={onRetryUpload}
        onCancelUpload={onCancelUpload}
        {...over}
      />
    </QueryClientProvider>,
  );
  return { ...view, onEdit, onSelectMany, onUploadFiles, onRetryUpload, onCancelUpload };
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

test('baris hasil inject Country Lock: serial hanya teks, baris manual tetap berupa kolom isian', () => {
  const locked = { ...photoRow('AAA111', []), source: 'countrylock' as const };
  const manual = photoRow('BBB222', []);
  renderTable([locked, manual]);
  expect(screen.queryByRole('textbox', { name: 'Serial AAA111' })).toBeNull();
  expect(screen.getByTitle('Serial dari perangkat, tidak dapat diubah')).toHaveTextContent(
    'AAA111',
  );
  expect(screen.getByRole('textbox', { name: 'Serial BBB222' })).toBeInTheDocument();
});

const entry = (owner: string, over: Partial<UploadEntry> = {}): UploadEntry => ({
  key: `u-${owner}`,
  owner,
  file: new File([new Uint8Array(2)], 'baru.jpg', { type: 'image/jpeg' }),
  name: 'baru.jpg',
  phase: 'uploading',
  fraction: 0.4,
  error: null,
  ...over,
});

test('unggahan latar tampil sebagai kartu progres hanya di baris pemiliknya dan ikut dihitung pada tombol Foto', () => {
  renderTable([photoRow('AAA111', ['p1']), photoRow('BBB222', [])], {
    uploadEntries: [entry('id-AAA111')],
  });
  const [first, second] = screen.getAllByRole('row').slice(1) as [HTMLElement, HTMLElement];
  expect(within(first).getByTestId('attachment-pending')).toBeInTheDocument();
  expect(within(second).queryByTestId('attachment-pending')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Foto (2), AAA111' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Foto (0), BBB222' })).toBeInTheDocument();
});

test('Ulangi dan Batalkan pada kartu progres diteruskan ke halaman per kunci entri', async () => {
  const { onRetryUpload, onCancelUpload } = renderTable([photoRow('AAA111', [])], {
    uploadEntries: [
      entry('id-AAA111', { key: 'k-gagal', phase: 'failed', error: 'Server menolak' }),
      entry('id-AAA111', { key: 'k-jalan' }),
    ],
  });
  await userEvent.click(screen.getByRole('button', { name: 'Ulangi baru.jpg' }));
  expect(onRetryUpload).toHaveBeenCalledWith('k-gagal');
  await userEvent.click(screen.getByRole('button', { name: 'Batalkan baru.jpg' }));
  expect(onCancelUpload).toHaveBeenCalledWith('k-jalan');
});

test('Tambahkan di dialog foto baris mengantrekan berkas untuk baris itu (tanpa mengunggah sendiri)', async () => {
  const { onUploadFiles } = renderTable([photoRow('AAA111', []), photoRow('BBB222', [])]);
  await userEvent.click(screen.getByRole('button', { name: 'Foto (0), BBB222' }));
  await screen.findByRole('alertdialog');
  const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array(4)], 'x.jpg', { type: 'image/jpeg' })] },
  });
  await userEvent.click(await screen.findByRole('button', { name: /^Tambahkan \(1\)/ }));
  expect(onUploadFiles).toHaveBeenCalledTimes(1);
  expect(onUploadFiles).toHaveBeenCalledWith('id-BBB222', [expect.objectContaining({ name: 'x' })]);
  expect(apiMock).not.toHaveBeenCalledWith(
    'serialProofs.upload',
    expect.anything(),
    expect.anything(),
  );
});

test('shift-klik kotak centang memilih rentang lewat onSelectMany', async () => {
  const rows = ['A1', 'B2', 'C3', 'D4', 'E5'].map((serial) => photoRow(serial, []));
  const { onSelectMany } = renderTable(rows);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris B2' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris D4' }), { shiftKey: true });
  expect(onSelectMany).toHaveBeenCalledWith(['id-B2', 'id-C3', 'id-D4'], true);
});

test('klik biasa kotak centang tetap memanggil onSelect, bukan onSelectMany', async () => {
  const onSelect = vi.fn();
  const { onSelectMany } = renderTable([photoRow('A1', [])], { onSelect });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris A1' }));
  expect(onSelect).toHaveBeenCalledWith('id-A1', true);
  expect(onSelectMany).not.toHaveBeenCalled();
});

function StatefulTable({ initial }: { initial: StagingRow[] }) {
  const [rows, setRows] = useState(initial);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <StagingTable
        rows={rows}
        onSelect={(id, selected) =>
          setRows((all) => all.map((r) => (r.clientId === id ? { ...r, selected } : r)))
        }
        onSelectAll={() => undefined}
        onSelectMany={(ids, selected) =>
          setRows((all) => all.map((r) => (ids.includes(r.clientId) ? { ...r, selected } : r)))
        }
        onEdit={() => undefined}
        onCommitSerial={() => null}
        onOpenDetail={() => undefined}
        onRemove={() => undefined}
        uploadEntries={[]}
        onUploadFiles={() => undefined}
        onRetryUpload={() => undefined}
        onCancelUpload={() => undefined}
      />
    </QueryClientProvider>
  );
}

function checkedOf(serial: string): boolean {
  return (screen.getByRole('checkbox', { name: `Pilih baris ${serial}` }) as HTMLInputElement)
    .checked;
}

test('shift-klik rentang pilih dengan onSelect nyata: baris target ikut terpilih', async () => {
  const rows = ['A1', 'B2', 'C3', 'D4', 'E5'].map((serial) => photoRow(serial, []));
  render(<StatefulTable initial={rows} />);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris B2' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris D4' }), { shiftKey: true });
  await waitFor(() =>
    expect(['A1', 'B2', 'C3', 'D4', 'E5'].map(checkedOf)).toEqual([false, true, true, true, false]),
  );
});

test('shift-klik rentang lepas dengan onSelect nyata: baris target ikut terlepas', async () => {
  const rows = ['A1', 'B2', 'C3', 'D4', 'E5'].map((serial) => photoRow(serial, []));
  render(<StatefulTable initial={rows} />);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris B2' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris D4' }), { shiftKey: true });
  // D4 tercentang; klik B2 lalu shift-klik D4 melepas rentang.
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris B2' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris D4' }), { shiftKey: true });
  await waitFor(() =>
    expect(['A1', 'B2', 'C3', 'D4', 'E5'].map(checkedOf)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]),
  );
});

test('klik biasa berturut-turut tetap membalik baris dengan benar setelah rentang', async () => {
  const rows = ['A1', 'B2', 'C3'].map((serial) => photoRow(serial, []));
  render(<StatefulTable initial={rows} />);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris A1' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris C3' }), { shiftKey: true });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris B2' }));
  expect(['A1', 'B2', 'C3'].map(checkedOf)).toEqual([true, false, true]);
});

test('Shift+Spasi memilih rentang dengan onSelectMany nyata dan klik sintetis susulan tak membalik baris', async () => {
  const rows = ['A1', 'B2', 'C3', 'D4', 'E5'].map((serial) => photoRow(serial, []));
  render(<StatefulTable initial={rows} />);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris B2' }));
  const target = screen.getByRole('checkbox', { name: 'Pilih baris D4' });
  fireEvent.keyDown(target, { key: ' ', shiftKey: true });
  fireEvent.keyUp(target, { key: ' ', shiftKey: true });
  // Peramban menyusulkan klik sintetis setelah keyup Spasi.
  fireEvent.click(target);
  await waitFor(() =>
    expect(['A1', 'B2', 'C3', 'D4', 'E5'].map(checkedOf)).toEqual([false, true, true, true, false]),
  );
});
