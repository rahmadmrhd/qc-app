import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DisabledReason } from '@/components/disabled-reason';
import { GridView } from '@/components/grid/grid-view';
import { ListPage } from '@/components/page/list-page';
import { TooltipProvider } from '@/components/ui/tooltip';
import { mockMatchMedia } from '@/test/match-media';
import { BulkBar } from './bulk-bar';
import { DataTable } from './data-table';
import type { RowAction } from './row-actions';
import { LONG_PRESS_MS, useLongPressSelect } from './use-long-press-select';
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
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Pilih' }));
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

test('BulkBar ponsel: lebih dari dua aksi = aksi pertama langsung, sisanya di menu tambahan (R12)', async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Aksi Asus' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Pilih' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByRole('button', { name: 'Satu' })).toBeInTheDocument();
  expect(within(bar).queryByRole('button', { name: 'Dua' })).toBeNull();
  expect(within(bar).queryByRole('button', { name: 'Tiga' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Aksi lainnya' }));
  expect(await screen.findByRole('button', { name: 'Dua' })).toBeInTheDocument();
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

test('GridView ponsel: tombol "Pilih" masuk mode pilih tanpa gestur; tanda silang keluar (review I6)', async () => {
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
  await userEvent.click(screen.getByRole('button', { name: 'Pilih Gambar' }));
  expect(screen.getByText('0 dipilih')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Asus' }));
  expect(screen.getByText('1 dipilih')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Keluar dari mode pilih' }));
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Pilih Gambar' })).toBeInTheDocument();
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

test('teks kartu dapat diseleksi di luar tekan lama: data-pressing hanya selama menekan (review M6)', () => {
  vi.useFakeTimers();
  render(<Harness />);
  const first = screen.getAllByRole('listitem')[0] as HTMLElement;
  expect(first.className).not.toContain('select-none ');
  pressCard(first);
  expect(first.hasAttribute('data-pressing')).toBe(true);
  fireEvent.pointerUp(first);
  expect(first.hasAttribute('data-pressing')).toBe(false);
});

test('rowSelectable: tekan lama pada kartu tak terpilih tidak masuk mode pilih dan menu tanpa "Pilih"', async () => {
  vi.useFakeTimers();
  function Mixed() {
    const selection = useRowSelection('x');
    return (
      <TooltipProvider>
        <DataTable
          rows={ROWS}
          rowKey={(row) => row.id}
          columns={[{ id: 'name', header: 'Nama', cell: (row) => row.name }]}
          label="Merk"
          selectLabel={(row) => row.name}
          selection={selection}
          rowSelectable={(row) => row.id !== '1'}
          actions={(row) => [
            { id: 'edit', action: 'edit', label: `Ubah ${row.name}`, onSelect: () => undefined },
          ]}
        />
      </TooltipProvider>
    );
  }
  render(<Mixed />);
  const first = screen.getAllByRole('listitem')[0] as HTMLElement;
  pressCard(first);
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  vi.useRealTimers();
  await userEvent.click(screen.getByRole('button', { name: 'Aksi Asus' }));
  expect(await screen.findByRole('menuitem', { name: 'Ubah' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Pilih' })).toBeNull();
});

test('BulkBar ponsel: alasan tombol nonaktif tampil sebagai teks (tanpa hover)', () => {
  render(
    <TooltipProvider>
      <BulkBar count={1} onClear={() => undefined}>
        <DisabledReason reason="Pilihan memuat akun Anda sendiri">
          <button type="button" disabled>
            Nonaktifkan
          </button>
        </DisabledReason>
      </BulkBar>
    </TooltipProvider>,
  );
  expect(screen.getByRole('button', { name: 'Nonaktifkan' })).toBeDisabled();
  expect(screen.getByText('Pilihan memuat akun Anda sendiri')).toBeVisible();
});

// --- Pilih tarik (useLongPressSelect dengan options.ids) ---

const DRAG_IDS = ['a', 'b', 'c', 'd', 'e'];

function DragList() {
  const selection = useRowSelection('d');
  const press = useLongPressSelect(selection, true, { ids: DRAG_IDS });
  return (
    <ul>
      {DRAG_IDS.map((id) => (
        <li key={id} aria-label={`kartu ${id}`} {...press.bind(id)}>
          <span data-select-lane data-testid={`lane-${id}`}>
            {selection.selected.has(id) ? 'v' : '-'}
          </span>
          <span data-testid={`body-${id}`}>isi</span>
        </li>
      ))}
      <output data-testid="out">{[...selection.selected].sort().join(',')}</output>
    </ul>
  );
}

const originalElementFromPoint = document.elementFromPoint;
afterEach(() => {
  document.elementFromPoint = originalElementFromPoint;
});

function stubPoint(ids: string[]) {
  const items = ids.map((id) => screen.getByLabelText(`kartu ${id}`));
  document.elementFromPoint = (_x: number, y: number) => items[Math.round(y / 100) - 1] ?? null;
}
const out = () => screen.getByTestId('out').textContent;

test('seret: tekan lama pada kartu 2 lalu tarik ke kartu 4 memilih 2-4', () => {
  vi.useFakeTimers();
  render(<DragList />);
  stubPoint(DRAG_IDS);
  const card = screen.getByLabelText('kartu b');
  fireEvent.pointerDown(card, { clientX: 10, clientY: 200, button: 0, pointerType: 'touch' });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  fireEvent.pointerMove(card, { clientX: 10, clientY: 400 });
  fireEvent.pointerUp(card);
  expect(out()).toBe('b,c,d');
});

test('seret dari lajur kotak centang saat mode pilih memilih rentang; badan kartu tetap menggulir', () => {
  vi.useFakeTimers();
  render(<DragList />);
  stubPoint(DRAG_IDS);
  const first = screen.getByLabelText('kartu a');
  fireEvent.pointerDown(first, { clientX: 10, clientY: 100, button: 0, pointerType: 'touch' });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  fireEvent.pointerUp(first);
  expect(out()).toBe('a');

  const lane = screen.getByTestId('lane-c');
  fireEvent.pointerDown(lane, { clientX: 10, clientY: 300, button: 0, pointerType: 'touch' });
  fireEvent.pointerMove(lane, { clientX: 10, clientY: 500 });
  fireEvent.pointerUp(lane);
  expect(out()).toBe('a,c,d,e');

  // Badan kartu (bukan lajur) di mode pilih: bergerak jauh tidak memilih apa pun.
  const body = screen.getByTestId('body-b');
  fireEvent.pointerDown(body, { clientX: 10, clientY: 200, button: 0, pointerType: 'touch' });
  fireEvent.pointerMove(body, { clientX: 10, clientY: 400 });
  fireEvent.pointerUp(body);
  expect(out()).toBe('a,c,d,e');
});

test('seret dari tekan lama tetap menelan klik susulan walau gulir otomatis memicu scroll', () => {
  vi.useFakeTimers();
  render(<DragList />);
  stubPoint(DRAG_IDS);
  const card = screen.getByLabelText('kartu b');
  fireEvent.pointerDown(card, { clientX: 10, clientY: 200, button: 0, pointerType: 'touch' });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  // Gulir otomatis memicu scroll (capture) di tengah seret.
  fireEvent.scroll(window);
  fireEvent.pointerMove(card, { clientX: 10, clientY: 400 });
  fireEvent.pointerMove(card, { clientX: 10, clientY: 200 });
  fireEvent.pointerUp(card);
  expect(out()).toBe('b');
  fireEvent.click(card);
  expect(out()).toBe('b');
});

test('seret: pointercancel di tengah gestur tidak melempar dan meninggalkan pilihan sebagian', () => {
  vi.useFakeTimers();
  render(<DragList />);
  stubPoint(DRAG_IDS);
  const card = screen.getByLabelText('kartu b');
  fireEvent.pointerDown(card, { clientX: 10, clientY: 200, button: 0, pointerType: 'touch' });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  fireEvent.pointerMove(card, { clientX: 10, clientY: 300 });
  expect(() => fireEvent.pointerCancel(card)).not.toThrow();
  expect(out()).toBe('b,c');
});

test('tanpa options.ids seret nonaktif: tekan lama lalu bergerak hanya memilih satu kartu', () => {
  vi.useFakeTimers();
  function Plain() {
    const selection = useRowSelection('p');
    const press = useLongPressSelect(selection, true);
    return (
      <ul>
        {DRAG_IDS.map((id) => (
          <li key={id} aria-label={`kartu ${id}`} {...press.bind(id)} />
        ))}
        <output data-testid="out">{[...selection.selected].sort().join(',')}</output>
      </ul>
    );
  }
  render(<Plain />);
  stubPoint(DRAG_IDS);
  const card = screen.getByLabelText('kartu b');
  fireEvent.pointerDown(card, { clientX: 10, clientY: 200, button: 0, pointerType: 'touch' });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  fireEvent.pointerMove(card, { clientX: 10, clientY: 400 });
  fireEvent.pointerUp(card);
  expect(out()).toBe('b');
});

// --- Pilih tarik di DataCards ---

test('DataCards: seret dari lajur kotak centang kartu 2 ke kartu 4 memilih tiga kartu; yang tak boleh dipilih dilewati', () => {
  vi.useFakeTimers();
  const rows: Row[] = ['1', '2', '3', '4', '5'].map((id) => ({ id, name: `Nama${id}` }));
  function Cards() {
    const selection = useRowSelection('cards-drag');
    return (
      <TooltipProvider>
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          columns={[{ id: 'name', header: 'Nama', cell: (row) => <span>{row.name}</span> }]}
          label="Merk"
          selectLabel={(row) => row.name}
          selection={selection}
          rowSelectable={(row) => row.id !== '3'}
        />
        <output data-testid="out">{[...selection.selected].sort().join(',')}</output>
      </TooltipProvider>
    );
  }
  render(<Cards />);
  const items = screen.getAllByRole('listitem');
  document.elementFromPoint = (_x: number, y: number) => items[Math.round(y / 100) - 1] ?? null;
  // Masuk mode pilih lewat tekan lama kartu 1.
  fireEvent.pointerDown(items[0] as HTMLElement, {
    clientX: 10,
    clientY: 100,
    button: 0,
    pointerType: 'touch',
  });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  fireEvent.pointerUp(items[0] as HTMLElement);
  expect(out()).toBe('1');

  const lane = screen.getByRole('checkbox', { name: 'Pilih Nama2' }).closest('[data-select-lane]');
  expect(lane).not.toBeNull();
  fireEvent.pointerDown(lane as HTMLElement, {
    clientX: 10,
    clientY: 200,
    button: 0,
    pointerType: 'touch',
  });
  fireEvent.pointerMove(lane as HTMLElement, { clientX: 10, clientY: 400 });
  fireEvent.pointerUp(lane as HTMLElement);
  expect(out()).toBe('1,2,4');
});
