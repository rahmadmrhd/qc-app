import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { ListFrameContext } from '@/components/page/list-frame';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BulkBar } from './bulk-bar';
import { type DataColumn, DataTable } from './data-table';
import { LinkCell } from './link-cell';
import type { RowAction } from './row-actions';
import { useRowSelection } from './use-row-selection';

interface Row {
  id: string;
  name: string;
}

const ROWS: Row[] = [
  { id: '1', name: 'Asus' },
  { id: '2', name: 'Tenda' },
  { id: '3', name: 'TP-Link' },
];

const COLUMNS: DataColumn<Row>[] = [{ id: 'name', header: 'Nama', cell: (row) => row.name }];

function mockWidth(desktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: desktop,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

function Harness({
  onEdit = () => undefined,
  withActions = true,
}: {
  onEdit?: () => void;
  withActions?: boolean;
}) {
  const selection = useRowSelection('x');
  const actions = (row: Row): RowAction[] => [
    { id: 'edit', action: 'edit', label: `Ubah ${row.name}`, onSelect: onEdit },
    { id: 'delete', action: 'delete', label: `Hapus ${row.name}`, onSelect: () => undefined },
  ];
  return (
    <TooltipProvider>
      <DataTable
        rows={ROWS}
        rowKey={(row) => row.id}
        columns={COLUMNS}
        label="Merk"
        selectLabel={(row) => row.name}
        selection={selection}
        actions={withActions ? actions : undefined}
      />
      <BulkBar count={selection.count} onClear={selection.clear}>
        <span>aksi</span>
      </BulkBar>
    </TooltipProvider>
  );
}

test('urutan kolom: checkbox, Aksi, lalu kolom data; header sticky', () => {
  render(<Harness />);
  const headers = within(screen.getByRole('table', { name: 'Merk' })).getAllByRole('columnheader');
  expect(headers).toHaveLength(3);
  expect(
    within(headers[0] as HTMLElement).getByRole('checkbox', { name: 'Pilih semua' }),
  ).toBeTruthy();
  expect(headers[1]).toHaveTextContent('Aksi');
  expect(headers[2]).toHaveTextContent('Nama');
  for (const header of headers) expect(header.className).toContain('sticky');
});

test('Pilih semua memilih semua baris termuat dan mengosongkan saat diklik lagi', async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  expect(screen.getByText('3 dipilih')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Pilih Asus' })).toBeChecked();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  expect(screen.queryByText(/dipilih/)).toBeNull();
});

test('sebagian terpilih = indeterminate; Batalkan pilihan mengosongkan', async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Tenda' }));
  expect(screen.getByRole('checkbox', { name: 'Pilih semua' })).toHaveAttribute(
    'aria-checked',
    'mixed',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Batalkan pilihan' }));
  expect(screen.queryByText(/dipilih/)).toBeNull();
});

test('BulkBar count 0 tak dirender', () => {
  const { container } = render(
    <BulkBar count={0} onClear={() => undefined}>
      <span>aksi</span>
    </BulkBar>,
  );
  expect(container).toBeEmptyDOMElement();
});

test('BulkBar menampilkan jumlah dan tombol batal memanggil onClear', async () => {
  const onClear = vi.fn();
  render(
    <BulkBar count={3} onClear={onClear}>
      <span>aksi</span>
    </BulkBar>,
  );
  expect(screen.getByText('3 dipilih')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Batalkan pilihan' }));
  expect(onClear).toHaveBeenCalledTimes(1);
});

test('isError menampilkan alert; kosong menampilkan teks bawaan', () => {
  const { rerender } = render(
    <DataTable rows={[]} rowKey={(row: Row) => row.id} columns={COLUMNS} label="Merk" isError />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Gagal memuat data');
  rerender(<DataTable rows={[]} rowKey={(row: Row) => row.id} columns={COLUMNS} label="Merk" />);
  expect(screen.getByText('Tidak ada data yang cocok.')).toBeInTheDocument();
});

test('muat lebih banyak memanggil onLoadMore dan nonaktif saat memuat', async () => {
  const onLoadMore = vi.fn();
  const { rerender } = render(
    <DataTable
      rows={ROWS}
      rowKey={(row) => row.id}
      columns={COLUMNS}
      label="Merk"
      hasMore
      onLoadMore={onLoadMore}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
  expect(onLoadMore).toHaveBeenCalledTimes(1);
  rerender(
    <DataTable
      rows={ROWS}
      rowKey={(row) => row.id}
      columns={COLUMNS}
      label="Merk"
      hasMore
      loadingMore
    />,
  );
  expect(screen.getByRole('button', { name: 'Memuat…' })).toBeDisabled();
});

test('desktop: satu tombol ikon per aksi, tanpa menu', async () => {
  mockWidth(true);
  const onEdit = vi.fn();
  render(<Harness onEdit={onEdit} />);
  await userEvent.click(screen.getAllByRole('button', { name: 'Ubah Asus' })[0] as HTMLElement);
  expect(onEdit).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Hapus Tenda' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Aksi Asus' })).toBeNull();
});

test('ponsel: kartu bertumpuk (tanpa tabel); satu tombol "Aksi <nama>" membuka menu berlabel singkat tiap aksi', async () => {
  mockWidth(false);
  render(<Harness />);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.queryByRole('button', { name: 'Ubah Asus' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Aksi Asus' }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: 'Ubah' })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitem', { name: 'Hapus' })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
});

test('ponsel: tanpa checkbox di kartu (pilih massal menyusul) dan tak ada render ganda', () => {
  mockWidth(false);
  render(<Harness />);
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  expect(screen.getAllByRole('button', { name: 'Aksi Asus' })).toHaveLength(1);
});

test('ponsel: peran kolom (title, badge, meta berlabel, hide) menentukan isi kartu', () => {
  mockWidth(false);
  const rows = [
    { id: '1', name: 'Asus', status: 'Aktif', note: 'catatan', skip: 'x', empty: null },
  ];
  render(
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      label="Merk"
      columns={[
        { id: 'name', header: 'Nama', cell: (row) => row.name },
        { id: 'status', header: 'Status', cell: (row) => row.status },
        { id: 'note', header: 'Catatan', cell: (row) => row.note },
        { id: 'skip', header: 'Disembunyikan', cell: (row) => row.skip, mobile: 'hide' },
        { id: 'empty', header: 'Kosong', cell: (row) => row.empty },
      ]}
    />,
  );
  const card = screen.getByRole('listitem');
  expect(within(card).getByText('Asus')).toBeInTheDocument();
  expect(within(card).getByText('Aktif')).toBeInTheDocument();
  expect(within(card).getByText('Catatan')).toBeInTheDocument();
  expect(within(card).getByText('catatan')).toBeInTheDocument();
  expect(within(card).queryByText('Disembunyikan')).toBeNull();
  expect(within(card).queryByText('Kosong')).toBeNull();
});

test('ponsel: mobile="title" eksplisit menggantikan kolom pertama sebagai judul', () => {
  mockWidth(false);
  render(
    <DataTable
      rows={[{ id: '1', a: 'Merk A', b: 'Tipe B' }]}
      rowKey={(row) => row.id}
      label="Item"
      columns={[
        { id: 'a', header: 'Merk', cell: (row) => row.a },
        { id: 'b', header: 'Tipe', cell: (row) => row.b, mobile: 'title' },
      ]}
    />,
  );
  const card = screen.getByRole('listitem');
  expect(within(card).getByText('Merk')).toBeInTheDocument();
  expect(within(card).queryByText('Tipe')).toBeNull();
});

test('ponsel: memuat menampilkan kartu kerangka; galat awal tetap alert', () => {
  mockWidth(false);
  const { rerender } = render(
    <DataTable rows={[]} rowKey={(row: Row) => row.id} columns={COLUMNS} label="Merk" isLoading />,
  );
  expect(screen.getByRole('list', { name: 'Merk' })).toHaveAttribute('aria-busy', 'true');
  rerender(
    <DataTable rows={[]} rowKey={(row: Row) => row.id} columns={COLUMNS} label="Merk" isError />,
  );
  expect(screen.getByRole('alert')).toBeInTheDocument();
});

test('desktop: tabel di dalam pembungkus gulir dua sumbu yang dapat difokus dan bernama', () => {
  mockWidth(true);
  render(<Harness />);
  const scroller = screen.getByRole('table', { name: 'Merk' }).parentElement as HTMLElement;
  expect(scroller.dataset.slot).toBe('table-scroller');
  expect(scroller.className).toContain('overflow-auto');
  expect(scroller).toHaveAttribute('tabindex', '0');
  expect(scroller).toBe(screen.getByRole('region', { name: 'Merk (dapat digulir)' }));
});

test('desktop: header menempel di atas pembungkus gulir (top-0), bukan di viewport', () => {
  mockWidth(true);
  render(<Harness />);
  const headers = within(screen.getByRole('table', { name: 'Merk' })).getAllByRole('columnheader');
  for (const header of headers) {
    expect(header.className).toContain('top-0');
    expect(header.className).not.toContain('headroom-offset');
  }
});

test('desktop: kolom checkbox dan Aksi menempel di kiri; Aksi bergeser selebar checkbox', () => {
  mockWidth(true);
  render(<Harness />);
  const table = screen.getByRole('table', { name: 'Merk' });
  const headers = within(table).getAllByRole('columnheader');
  expect(headers[0]?.className).toContain('left-0');
  expect(headers[1]?.className).toContain('left-10');
  expect(headers[2]?.className).not.toContain('left-');
  const cells = within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('cell');
  expect(cells[0]?.className).toContain('sticky');
  expect(cells[0]?.className).toContain('left-0');
  expect(cells[1]?.className).toContain('left-10');
  expect(cells[2]?.className).not.toContain('sticky');
  // Latar sel menempel opak (bukan bg-muted/50 beralfa), kolom lain tak tembus saat tergulir.
  expect(cells[0]?.className).toContain('bg-background');
});

test('desktop: lebar nyata kolom menempel (checkbox + Aksi) menjadi --sticky-w untuk scroll-padding', () => {
  mockWidth(true);
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 40,
  });
  try {
    render(<Harness />);
    const scroller = screen.getByRole('region', { name: 'Merk (dapat digulir)' });
    expect(scroller.style.getPropertyValue('--sticky-w')).toBe('80px');
    expect(scroller.className).toContain('scroll-pl-[calc(var(--sticky-w,7rem)+0.5rem)]');
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', original);
    else Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
  }
});

test('desktop: sel menempel mengikuti sorotan baris saat menu aksi terbuka; bayangan tepi hitam netral', () => {
  mockWidth(true);
  render(<Harness />);
  const headers = within(screen.getByRole('table', { name: 'Merk' })).getAllByRole('columnheader');
  const cells = within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('cell');
  // Baris memakai `has-aria-expanded:bg-muted/50`; sel menempel opak harus mengikutinya agar tak tampak bolong.
  expect(cells[0]?.className).toContain('group-has-aria-expanded/row:bg-[color-mix');
  expect(cells[1]?.className).toContain('group-has-aria-expanded/row:bg-[color-mix');
  // Bayangan tepi: hitam (bukan `foreground`, yang terang di mode gelap sehingga tampak seperti pita cahaya).
  const edge = headers[1]?.className ?? '';
  expect(edge).toContain('after:from-black/10');
  expect(edge).toContain('dark:after:from-black/40');
  expect(edge).not.toContain('from-foreground');
});

test('desktop tanpa checkbox: Aksi menempel di left-0', () => {
  mockWidth(true);
  function ActionsOnly() {
    return (
      <TooltipProvider>
        <DataTable
          rows={ROWS}
          rowKey={(row) => row.id}
          columns={COLUMNS}
          label="Merk"
          selectLabel={(row) => row.name}
          actions={() => [{ id: 'edit', action: 'edit', label: 'Ubah', onSelect: () => undefined }]}
        />
      </TooltipProvider>
    );
  }
  render(<ActionsOnly />);
  const headers = within(screen.getByRole('table', { name: 'Merk' })).getAllByRole('columnheader');
  expect(headers[0]).toHaveTextContent('Aksi');
  expect(headers[0]?.className).toContain('left-0');
});

test('fit: di luar ListPage bawaannya content (tanpa batas tinggi); fit="viewport" memberi max-height', () => {
  mockWidth(true);
  const { unmount } = render(<Harness />);
  const content = screen.getByRole('table', { name: 'Merk' }).parentElement as HTMLElement;
  expect(content.dataset.fit).toBe('content');
  expect(content.style.maxHeight).toBe('');
  unmount();
  render(
    <DataTable
      rows={ROWS}
      rowKey={(row) => row.id}
      columns={COLUMNS}
      label="Merk"
      fit="viewport"
      hasMore
    />,
  );
  const viewport = screen.getByRole('table', { name: 'Merk' }).parentElement as HTMLElement;
  expect(viewport.dataset.fit).toBe('viewport');
  expect(viewport.style.maxHeight).toContain('100dvh');
  // Tombol "Muat lebih banyak" di bawah pembungkus ikut dikurangkan.
  expect(viewport.style.maxHeight).toContain('- 48px -');
});

test('di dalam ListPage tabel mengisi viewport tanpa menyebut fit', () => {
  mockWidth(true);
  render(
    <ListFrameContext.Provider value>
      <DataTable rows={ROWS} rowKey={(row) => row.id} columns={COLUMNS} label="Merk" />
    </ListFrameContext.Provider>,
  );
  expect(screen.getByRole('table', { name: 'Merk' }).parentElement?.dataset.fit).toBe('viewport');
});

test('selection.remove membuang hanya id itu', async () => {
  function Remover() {
    const selection = useRowSelection('x');
    return (
      <>
        <DataTable
          rows={ROWS}
          rowKey={(row) => row.id}
          columns={COLUMNS}
          label="Merk"
          selectLabel={(row) => row.name}
          selection={selection}
        />
        <button type="button" onClick={() => selection.setAll(['1', '2', '3'], true)}>
          semua
        </button>
        <button type="button" onClick={() => selection.remove(['1', '3'])}>
          buang
        </button>
      </>
    );
  }
  render(<Remover />);
  await userEvent.click(screen.getByRole('button', { name: 'semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'buang' }));
  expect(screen.getByRole('checkbox', { name: 'Pilih Tenda' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Pilih Asus' })).not.toBeChecked();
});

function withRouter(element: ReactNode) {
  const root = createRootRoute({ component: () => <>{element}</> });
  return createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
}

test('LinkCell merender tautan berkelas text-info-text dan meneruskan data-tour', async () => {
  const router = withRouter(
    <LinkCell to={'/item/brands' as never} tour="x">
      Asus
    </LinkCell>,
  );
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  const link = await screen.findByRole('link', { name: 'Asus' });
  expect(link).toHaveAttribute('href', '/item/brands');
  expect(link.className).toContain('text-info-text');
  expect(link).toHaveAttribute('data-tour', 'x');
});

test('galat refetch dengan baris tetap menampilkan baris; galat awal punya Coba lagi', async () => {
  const onRetry = vi.fn();
  const { rerender } = render(
    <DataTable rows={ROWS} rowKey={(row) => row.id} columns={COLUMNS} label="Merk" isError />,
  );
  expect(screen.getByText('Asus')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
  rerender(
    <DataTable
      rows={[]}
      rowKey={(row: Row) => row.id}
      columns={COLUMNS}
      label="Merk"
      isError
      onRetry={onRetry}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('loadMoreError menampilkan pesan dan Coba lagi memanggil onLoadMore', async () => {
  const onLoadMore = vi.fn();
  render(
    <DataTable
      rows={ROWS}
      rowKey={(row) => row.id}
      columns={COLUMNS}
      label="Merk"
      hasMore
      loadMoreError
      onLoadMore={onLoadMore}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Gagal memuat halaman berikutnya');
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  expect(onLoadMore).toHaveBeenCalledTimes(1);
});

test('pilihan dipangkas ke baris yang masih dimuat', async () => {
  function Prune({ rows }: { rows: Row[] }) {
    const selection = useRowSelection('x');
    return (
      <>
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          columns={COLUMNS}
          label="Merk"
          selectLabel={(row) => row.name}
          selection={selection}
        />
        <BulkBar count={selection.count} onClear={selection.clear}>
          <span>aksi</span>
        </BulkBar>
      </>
    );
  }
  const { rerender } = render(<Prune rows={ROWS} />);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  expect(screen.getByText('3 dipilih')).toBeInTheDocument();
  rerender(<Prune rows={ROWS.slice(0, 1)} />);
  expect(await screen.findByText('1 dipilih')).toBeInTheDocument();
});

test('rowSelectable: baris tak terpilih tanpa checkbox; Pilih semua hanya memilih yang dapat dipilih', async () => {
  function Mixed() {
    const selection = useRowSelection('x');
    return (
      <>
        <DataTable
          rows={ROWS}
          rowKey={(row) => row.id}
          columns={COLUMNS}
          label="Merk"
          selectLabel={(row) => row.name}
          selection={selection}
          rowSelectable={(row) => row.id !== '2'}
        />
        <BulkBar count={selection.count} onClear={selection.clear}>
          <span>aksi</span>
        </BulkBar>
      </>
    );
  }
  render(<Mixed />);
  expect(screen.queryByRole('checkbox', { name: 'Pilih Tenda' })).toBeNull();
  expect(screen.getByRole('checkbox', { name: 'Pilih Asus' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  expect(screen.getByText('2 dipilih')).toBeInTheDocument();
});
