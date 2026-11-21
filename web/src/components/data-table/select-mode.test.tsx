import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GridView } from '@/components/grid/grid-view';
import { ListPage } from '@/components/page/list-page';
import { TooltipProvider } from '@/components/ui/tooltip';
import { mockMatchMedia } from '@/test/match-media';
import { BulkBar } from './bulk-bar';
import { DataTable } from './data-table';
import { LONG_PRESS_MS } from './use-long-press-select';
import { useRowSelection } from './use-row-selection';

interface Row {
  id: string;
  name: string;
}
const ROWS: Row[] = [
  { id: '1', name: 'Asus' },
  { id: '2', name: 'Tenda' },
];

let media: ReturnType<typeof mockMatchMedia>;
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  media.restore();
  vi.useRealTimers();
});

function Page() {
  const selection = useRowSelection('x');
  return (
    <TooltipProvider>
      <ListPage
        title="Merk"
        bulkBar={
          <BulkBar count={selection.count} onClear={selection.clear}>
            <button type="button">Aktifkan</button>
            <button type="button">Hapus</button>
          </BulkBar>
        }
      >
        <DataTable
          rows={ROWS}
          rowKey={(row) => row.id}
          columns={[{ id: 'name', header: 'Nama', cell: (row) => row.name }]}
          label="Merk"
          selectLabel={(row) => row.name}
          selection={selection}
        />
      </ListPage>
    </TooltipProvider>
  );
}

test('ponsel: mode pilih punya SATU bar bawah (batal, jumlah, pilih semua, aksi) tanpa header pilihan di atas', async () => {
  media = mockMatchMedia(false);
  vi.useFakeTimers();
  render(<Page />);
  expect(screen.queryByRole('region', { name: 'Aksi massal' })).toBeNull();
  const card = screen.getAllByRole('listitem')[0] as HTMLElement;
  fireEvent.pointerDown(card, { clientX: 10, clientY: 10, button: 0, pointerType: 'touch' });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  vi.useRealTimers();
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(bar.className).toContain('fixed');
  expect(document.querySelector('[data-slot="selection-bar"]')).toBeNull();
  expect(within(bar).getByRole('button', { name: 'Batalkan pilihan' })).toBeInTheDocument();
  expect(within(bar).getByRole('status')).toHaveTextContent('1 dipilih');
  expect(within(bar).getByRole('button', { name: 'Aktifkan' })).toBeInTheDocument();
  // Pilih semua dari bar yang sama.
  await userEvent.click(within(bar).getByRole('checkbox', { name: 'Pilih semua' }));
  expect(within(bar).getByRole('status')).toHaveTextContent('2 dipilih');
  // Batalkan pilihan keluar dari mode pilih: bar hilang.
  await userEvent.click(within(bar).getByRole('button', { name: 'Batalkan pilihan' }));
  expect(screen.queryByRole('region', { name: 'Aksi massal' })).toBeNull();
});

function GridPage() {
  const selection = useRowSelection('g');
  return (
    <ListPage
      title="Gambar"
      bulkBar={
        <BulkBar count={selection.count} onClear={selection.clear}>
          <button type="button">Hapus</button>
        </BulkBar>
      }
    >
      <GridView
        items={ROWS}
        itemKey={(row) => row.id}
        renderItem={(row) => <span>{row.name}</span>}
        label="Gambar"
        selection={selection}
        selectLabel={(row) => row.name}
      />
    </ListPage>
  );
}

test('ponsel: mode pilih dari tombol "Pilih" (0 butir) tetap menampilkan bar bawah tanpa aksi', async () => {
  media = mockMatchMedia(false);
  render(<GridPage />);
  await userEvent.click(screen.getByRole('button', { name: 'Pilih Gambar' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByRole('status')).toHaveTextContent('0 dipilih');
  expect(within(bar).queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(document.querySelector('[data-slot="selection-bar"]')).toBeNull();
});

test('desktop: bar aksi massal di ATAS tabel dengan urutan Batalkan pilihan, jumlah, aksi', async () => {
  media = mockMatchMedia(true);
  render(<Page />);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Asus' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  const table = screen.getByRole('table');
  expect(bar.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const order = Array.from(bar.querySelectorAll('button, [role=status]')).map(
    (node) => node.textContent,
  );
  expect(order).toEqual(['Batalkan pilihan', '1 dipilih', 'Aktifkan', 'Hapus']);
  expect(bar.className).not.toContain('fixed');
});
