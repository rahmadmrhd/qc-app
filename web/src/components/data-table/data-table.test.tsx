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

test('ponsel: satu tombol "Aksi <nama>" membuka menu berisi tiap aksi; kolom pertama sticky kiri', async () => {
  mockWidth(false);
  render(<Harness />);
  expect(screen.queryByRole('button', { name: 'Ubah Asus' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Aksi Asus' }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: 'Ubah Asus' })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitem', { name: 'Hapus Asus' })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  const cell = screen.getByText('Asus').closest('td');
  expect(cell?.className).toContain('sticky');
  expect(screen.getByRole('table', { name: 'Merk' }).parentElement?.className).toContain(
    'overflow-x-auto',
  );
});

test('desktop: tabel tanpa pembungkus overflow-x-auto agar sticky bekerja', () => {
  mockWidth(true);
  render(<Harness />);
  expect(screen.getByRole('table', { name: 'Merk' }).parentElement?.className).not.toContain(
    'overflow-x-auto',
  );
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
