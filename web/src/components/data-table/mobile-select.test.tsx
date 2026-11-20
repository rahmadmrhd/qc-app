import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GridView } from '@/components/grid/grid-view';
import { ListPage } from '@/components/page/list-page';
import { TooltipProvider } from '@/components/ui/tooltip';
import { mockMatchMedia } from '@/test/match-media';
import { BulkBar } from './bulk-bar';
import { DataTable } from './data-table';
import type { RowAction } from './row-actions';
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
  media = mockMatchMedia(false);
});
afterEach(() => {
  media.restore();
  vi.useRealTimers();
});

function Harness({ onNavigate = () => undefined }: { onNavigate?: () => void }) {
  const selection = useRowSelection('x');
  const actions = (row: Row): RowAction[] => [
    { id: 'edit', action: 'edit', label: `Ubah ${row.name}`, onSelect: () => undefined },
  ];
  return (
    <TooltipProvider>
      <DataTable
        rows={ROWS}
        rowKey={(row) => row.id}
        columns={[
          {
            id: 'name',
            header: 'Nama',
            cell: (row) => (
              <a
                href="/buka"
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate();
                }}
              >
                {row.name}
              </a>
            ),
          },
        ]}
        label="Merk"
        selectLabel={(row) => row.name}
        selection={selection}
        actions={actions}
      />
      <BulkBar count={selection.count} onClear={selection.clear}>
        <button type="button">Satu</button>
        <button type="button">Dua</button>
        <button type="button">Tiga</button>
      </BulkBar>
    </TooltipProvider>
  );
}

function pressCard(card: HTMLElement, x = 10, y = 10) {
  fireEvent.pointerDown(card, { clientX: x, clientY: y, button: 0, pointerType: 'touch' });
}

test('tanpa checkbox sampai tekan lama; tekan lama memilih kartu dan membuka mode pilih', () => {
  vi.useFakeTimers();
  render(<Harness />);
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  expect(screen.getByRole('note')).toHaveTextContent('Tahan kartu untuk memilih beberapa');
  const card = screen.getAllByRole('listitem')[0] as HTMLElement;
  pressCard(card);
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  expect(screen.getByRole('checkbox', { name: 'Pilih Asus' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Keluar dari mode pilih' })).toBeInTheDocument();
  expect(screen.getAllByText('1 dipilih').length).toBeGreaterThan(0);
  // menu aksi kartu disembunyikan di mode pilih
  expect(screen.queryByRole('button', { name: 'Aksi Asus' })).toBeNull();
});

test('geser jari lebih dari toleransi membatalkan tekan lama', () => {
  vi.useFakeTimers();
  render(<Harness />);
  const card = screen.getAllByRole('listitem')[0] as HTMLElement;
  pressCard(card);
  fireEvent.pointerMove(card, { clientX: 10, clientY: 40 });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
});

test('klik setelah tekan lama tidak membuka tautan; di mode pilih ketukan mengubah pilihan', () => {
  vi.useFakeTimers();
  const onNavigate = vi.fn();
  render(<Harness onNavigate={onNavigate} />);
  const first = screen.getAllByRole('listitem')[0] as HTMLElement;
  pressCard(first);
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  fireEvent.click(within(first).getByRole('link'));
  expect(onNavigate).not.toHaveBeenCalled();
  const second = screen.getAllByRole('listitem')[1] as HTMLElement;
  fireEvent.click(within(second).getByRole('link'));
  expect(onNavigate).not.toHaveBeenCalled();
  expect(screen.getByRole('checkbox', { name: 'Pilih Tenda' })).toBeChecked();
  fireEvent.click(within(second).getByRole('link'));
  expect(screen.getByRole('checkbox', { name: 'Pilih Tenda' })).not.toBeChecked();
});

test('tekan lama TANPA click susulan: ketukan pertama pada kartu lain tetap mengubah pilihan (review I1)', () => {
  vi.useFakeTimers();
  render(<Harness />);
  const first = screen.getAllByRole('listitem')[0] as HTMLElement;
  pressCard(first);
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  fireEvent.pointerUp(first);
  // Tanpa `click` pada kartu pertama (perangkat yang membatalkan tap setelah tekan lama): ketukan kartu kedua.
  const second = screen.getAllByRole('listitem')[1] as HTMLElement;
  pressCard(second);
  fireEvent.pointerUp(second);
  fireEvent.click(within(second).getByRole('link'));
  expect(screen.getByRole('checkbox', { name: 'Pilih Tenda' })).toBeChecked();
});

test('menu konteks dicegah untuk sentuhan tetapi klik kanan tetikus tidak diblokir', () => {
  render(<Harness />);
  const first = screen.getAllByRole('listitem')[0] as HTMLElement;
  fireEvent.pointerDown(first, { clientX: 5, clientY: 5, button: 0, pointerType: 'touch' });
  expect(fireEvent.contextMenu(first)).toBe(false);
  fireEvent.pointerUp(first);
  fireEvent.pointerDown(first, { clientX: 5, clientY: 5, button: 2, pointerType: 'mouse' });
  expect(fireEvent.contextMenu(first)).toBe(true);
});

test('jalur cadangan: Pilih di menu aksi; Pilih semua; keluar dengan tombol silang', async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Aksi Asus' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Pilih Asus' }));
  expect(screen.getByRole('checkbox', { name: 'Pilih Asus' })).toBeChecked();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  expect(screen.getByRole('checkbox', { name: 'Pilih Tenda' })).toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: 'Keluar dari mode pilih' }));
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  expect(screen.queryByRole('region', { name: 'Aksi massal' })).toBeNull();
});

test('petunjuk tahan kartu bisa ditutup dan tidak muncul lagi', async () => {
  const { unmount } = render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Tutup petunjuk' }));
  expect(screen.queryByRole('note')).toBeNull();
  unmount();
  render(<Harness />);
  expect(screen.queryByRole('note')).toBeNull();
});

test('BulkBar ponsel: dua aksi utama, sisanya di menu tambahan', async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Aksi Asus' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Pilih Asus' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByRole('button', { name: 'Satu' })).toBeInTheDocument();
  expect(within(bar).getByRole('button', { name: 'Dua' })).toBeInTheDocument();
  expect(within(bar).queryByRole('button', { name: 'Tiga' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Aksi lainnya' }));
  expect(await screen.findByRole('button', { name: 'Tiga' })).toBeInTheDocument();
});

test('>= 768 px: checkbox lama selalu tampil, tanpa mode tekan lama', () => {
  media.set(true);
  render(<Harness />);
  expect(screen.getAllByRole('checkbox', { name: /Pilih / }).length).toBeGreaterThan(0);
  expect(screen.queryByRole('note')).toBeNull();
});

test('GridView ponsel: checkbox hanya di mode pilih (tekan lama)', () => {
  vi.useFakeTimers();
  function Grid() {
    const selection = useRowSelection('g');
    return (
      <GridView
        items={ROWS}
        itemKey={(row) => row.id}
        renderItem={(row) => <div>{row.name}</div>}
        label="Gambar"
        selection={selection}
        selectLabel={(row) => row.name}
      />
    );
  }
  render(<Grid />);
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  pressCard(screen.getAllByRole('listitem')[0] as HTMLElement);
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  expect(screen.getByRole('checkbox', { name: 'Pilih Asus' })).toBeChecked();
});

function Page({ onCreate = () => undefined }: { onCreate?: () => void }) {
  const selection = useRowSelection('p');
  return (
    <ListPage
      title="Merk"
      createAction={{ label: 'Tambah merk', onClick: onCreate }}
      bulkBar={
        <BulkBar count={selection.count} onClear={selection.clear}>
          <button type="button">Aksi</button>
        </BulkBar>
      }
    >
      <button type="button" onClick={() => selection.toggle('1')}>
        pilih
      </button>
    </ListPage>
  );
}

test('ListPage ponsel: Tambah = FAB; hilang saat bar aksi massal tampil', async () => {
  const onCreate = vi.fn();
  render(
    <TooltipProvider>
      <Page onCreate={onCreate} />
    </TooltipProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Tambah merk' }));
  expect(onCreate).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'pilih' }));
  expect(screen.queryByRole('button', { name: 'Tambah merk' })).toBeNull();
});

test('ListPage desktop: Tambah di header, bukan FAB', () => {
  media.set(true);
  render(
    <TooltipProvider>
      <Page />
    </TooltipProvider>,
  );
  const button = screen.getByRole('button', { name: 'Tambah merk' });
  expect(button.className).not.toContain('fixed');
});
