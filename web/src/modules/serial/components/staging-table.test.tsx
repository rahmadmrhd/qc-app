import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { addSerials, type StagingRow } from '../lib/draft';
import { StagingTable } from './staging-table';

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
