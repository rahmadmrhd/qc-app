import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { mockMatchMedia } from '@/test/match-media';
import { DataTable } from './data-table';
import { LinkCell } from './link-cell';
import { type RowAction, RowActions } from './row-actions';
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

async function renderInRouter(element: ReactNode) {
  const root = createRootRoute({ component: () => <>{element}</> });
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/merk/$merkId',
    component: () => <p>Detail merk</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([detail]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return router;
}

function Table({
  actions,
  withSelection = false,
}: {
  actions?: (row: Row) => RowAction[];
  withSelection?: boolean;
}) {
  const selection = useRowSelection('x');
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
              <LinkCell to={'/merk/$merkId' as never} params={{ merkId: row.id }}>
                {row.name}
              </LinkCell>
            ),
          },
          { id: 'catatan', header: 'Catatan', cell: () => <span>Catatan biasa</span> },
        ]}
        label="Merk"
        selectLabel={(row) => row.name}
        rowTo={(row) => ({ to: '/merk/$merkId' as never, params: { merkId: row.id } })}
        {...(withSelection ? { selection } : {})}
        {...(actions ? { actions } : {})}
      />
    </TooltipProvider>
  );
}

test('ponsel: klik badan kartu membuka View', async () => {
  media = mockMatchMedia(false);
  const router = await renderInRouter(<Table />);
  const first = screen.getAllByRole('listitem')[0] as HTMLElement;
  await userEvent.click(within(first).getByText('Catatan biasa'));
  expect(router.state.location.pathname).toBe('/merk/1');
});

test('ponsel: tombol ⋯ dan seleksi teks tidak ikut membuka detail kartu', async () => {
  media = mockMatchMedia(false);
  const actions = (row: Row): RowAction[] => [
    { id: 'edit', action: 'edit', label: `Ubah ${row.name}`, onSelect: () => undefined },
  ];
  const router = await renderInRouter(<Table actions={actions} />);
  const second = screen.getAllByRole('listitem')[1] as HTMLElement;
  await userEvent.click(within(second).getByRole('button', { name: 'Aksi Tenda' }));
  await userEvent.keyboard('{Escape}');
  expect(router.state.location.pathname).toBe('/');
  const note = within(second).getByText('Catatan biasa');
  const range = document.createRange();
  range.selectNodeContents(note);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.click(note);
  expect(router.state.location.pathname).toBe('/');
  window.getSelection()?.removeAllRanges();
});

test('ponsel: di mode pilih ketukan kartu mengubah pilihan dan tidak membuka detail', async () => {
  media = mockMatchMedia(false);
  const router = await renderInRouter(<Table withSelection />);
  vi.useFakeTimers();
  const first = screen.getAllByRole('listitem')[0] as HTMLElement;
  fireEvent.pointerDown(first, { clientX: 5, clientY: 5, button: 0, pointerType: 'touch' });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  vi.useRealTimers();
  fireEvent.pointerUp(first);
  const second = screen.getAllByRole('listitem')[1] as HTMLElement;
  fireEvent.pointerDown(second, { clientX: 5, clientY: 5, button: 0, pointerType: 'touch' });
  fireEvent.pointerUp(second);
  fireEvent.click(within(second).getByText('Catatan biasa'));
  expect(screen.getByRole('checkbox', { name: 'Pilih Tenda' })).toBeChecked();
  expect(router.state.location.pathname).toBe('/');
});

test('desktop: klik sel baris membuka View, baris diberi penanda dapat diklik', async () => {
  media = mockMatchMedia(true);
  const router = await renderInRouter(<Table />);
  const row = screen.getAllByRole('row')[1] as HTMLElement;
  expect(row.className).toContain('cursor-pointer');
  await userEvent.click(within(row).getByText('Catatan biasa'));
  expect(router.state.location.pathname).toBe('/merk/1');
});

test('desktop: checkbox (juga selnya), tombol aksi, dan seleksi teks tidak ikut membuka View', async () => {
  media = mockMatchMedia(true);
  const actions = (row: Row): RowAction[] => [
    { id: 'edit', action: 'edit', label: `Ubah ${row.name}`, onSelect: () => undefined },
  ];
  const router = await renderInRouter(<Table withSelection actions={actions} />);
  const second = screen.getAllByRole('row')[2] as HTMLElement;
  await userEvent.click(within(second).getByRole('checkbox', { name: 'Pilih Tenda' }));
  expect(screen.getByRole('checkbox', { name: 'Pilih Tenda' })).toBeChecked();
  // Sel pembungkus checkbox dan sel Aksi (di luar kontrolnya) juga dikecualikan.
  const cells = within(second).getAllByRole('cell');
  fireEvent.click(cells[0] as HTMLElement);
  fireEvent.click(cells[1] as HTMLElement);
  await userEvent.click(within(second).getByRole('button', { name: 'Ubah Tenda' }));
  expect(router.state.location.pathname).toBe('/');
  const note = within(second).getByText('Catatan biasa');
  const range = document.createRange();
  range.selectNodeContents(note);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.click(note);
  expect(router.state.location.pathname).toBe('/');
  window.getSelection()?.removeAllRanges();
});

test('desktop: tanpa rowTo/onOpen baris tidak dapat diklik', async () => {
  media = mockMatchMedia(true);
  render(
    <DataTable
      rows={ROWS}
      rowKey={(row) => row.id}
      columns={[{ id: 'name', header: 'Nama', cell: (row) => row.name }]}
      label="Merk"
    />,
  );
  expect((screen.getAllByRole('row')[1] as HTMLElement).className).not.toContain('cursor-pointer');
});

function RowActionsHarness({ actions }: { actions: RowAction[] }) {
  return <RowActions name="Asus" actions={actions} />;
}

function stockActions(row: Row): RowAction[] {
  return [
    { id: 'edit', action: 'edit', label: `Ubah ${row.name}`, onSelect: () => undefined },
    {
      id: 'stock',
      action: 'download',
      label: `Stok ${row.name}`,
      shortLabel: 'Stok',
      onSelect: () => undefined,
      submenu: [
        {
          id: 'in',
          action: 'create',
          label: `Catat masuk ${row.name}`,
          shortLabel: 'Catat masuk',
          onSelect: () => undefined,
        },
        {
          id: 'out',
          action: 'delete',
          label: `Catat keluar ${row.name}`,
          shortLabel: 'Catat keluar',
          onSelect: () => undefined,
        },
      ],
    },
  ];
}

test('ponsel: submenu menjadi grup DATAR di menu ⋯ yang sama (tanpa menu bersarang)', async () => {
  media = mockMatchMedia(false);
  await renderInRouter(<Table actions={stockActions} />);
  await userEvent.click(screen.getByRole('button', { name: 'Aksi Asus' }));
  const menu = await screen.findByRole('menu');
  expect(screen.getAllByRole('menu')).toHaveLength(1);
  expect(within(menu).queryByRole('menuitem', { name: 'Stok' })).toBeNull();
  expect(within(menu).getByText('Stok')).toBeInTheDocument();
  expect(within(menu).getByRole('menuitem', { name: 'Ubah' })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitem', { name: 'Catat masuk' })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitem', { name: 'Catat keluar' })).toBeInTheDocument();
  expect(menu.querySelector('[aria-haspopup]')).toBeNull();
  expect(menu.querySelector('[data-slot="dropdown-menu-sub-trigger"]')).toBeNull();
});

test('desktop: entri bersubmenu = satu tombol dengan satu dropdown', async () => {
  media = mockMatchMedia(true);
  await renderInRouter(<Table actions={stockActions} />);
  await userEvent.click(screen.getAllByRole('button', { name: 'Stok Asus' })[0] as HTMLElement);
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: 'Catat masuk Asus' })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitem', { name: 'Catat keluar Asus' })).toBeInTheDocument();
  expect(screen.getAllByRole('menu')).toHaveLength(1);
});

test('desktop: showLabel menampilkan ikon + teks (nama aksesibel tetap label panjang); tanpa showLabel ikon saja', () => {
  media = mockMatchMedia(true);
  const actions = (row: Row): RowAction[] => [
    {
      id: 'export',
      action: 'export',
      label: `Ekspor ${row.name}`,
      shortLabel: 'Ekspor',
      showLabel: true,
      onSelect: () => undefined,
    },
    { id: 'edit', action: 'edit', label: `Ubah ${row.name}`, onSelect: () => undefined },
  ];
  render(
    <TooltipProvider>
      <RowActionsHarness actions={actions(ROWS[0] as Row)} />
    </TooltipProvider>,
  );
  const withText = screen.getByRole('button', { name: 'Ekspor Asus' });
  expect(withText).toHaveTextContent('Ekspor');
  expect(screen.getByRole('button', { name: 'Ubah Asus' })).toHaveTextContent('');
});

function twoGroups(overrides: Partial<RowAction> = {}): RowAction[] {
  const sub = (id: string, action: RowAction['action'], label: string): RowAction => ({
    id,
    action,
    label,
    shortLabel: label,
    onSelect: () => undefined,
  });
  return [
    { id: 'edit', action: 'edit', label: 'Ubah Asus', onSelect: () => undefined },
    {
      id: 'stock',
      action: 'download',
      label: 'Stok Asus',
      shortLabel: 'Stok',
      onSelect: () => undefined,
      submenu: [sub('in', 'create', 'Masuk'), sub('out', 'delete', 'Keluar')],
      ...overrides,
    },
    {
      id: 'dl',
      action: 'download',
      label: 'Unduh Asus',
      shortLabel: 'Unduh',
      onSelect: () => undefined,
      submenu: [sub('pdf', 'download', 'PDF')],
    },
    { id: 'del', action: 'delete', label: 'Hapus Asus', onSelect: () => undefined },
  ];
}

test('ponsel: dua grup submenu berurutan dipisah SATU garis (bukan dua), butir di sekitarnya satu garis tiap batas', async () => {
  media = mockMatchMedia(false);
  render(
    <TooltipProvider>
      <RowActionsHarness actions={twoGroups()} />
    </TooltipProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Aksi Asus' }));
  const menu = await screen.findByRole('menu');
  // Ubah | Stok(2) | Unduh(1) | Hapus: tiga batas segmen = tiga garis, tak ada garis berurutan.
  const separators = within(menu).getAllByRole('separator');
  expect(separators).toHaveLength(3);
  for (const separator of separators) {
    expect(separator.previousElementSibling?.getAttribute('role')).not.toBe('separator');
    expect(separator.nextElementSibling?.getAttribute('role')).not.toBe('separator');
  }
});

test('ponsel: entri induk grup nonaktif membuat butirnya nonaktif dan alasannya tampil', async () => {
  media = mockMatchMedia(false);
  render(
    <TooltipProvider>
      <RowActionsHarness
        actions={twoGroups({ disabled: true, disabledReason: 'Sedang diproses' })}
      />
    </TooltipProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Aksi Asus' }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: /Masuk/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  expect(within(menu).getByRole('menuitem', { name: /Keluar/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  expect(within(menu).getAllByText('Sedang diproses')).toHaveLength(2);
  // Grup lain tak terpengaruh.
  expect(within(menu).getByRole('menuitem', { name: 'PDF' })).not.toHaveAttribute('aria-disabled');
});

test('desktop: dropdown grup menampilkan alasan nonaktif butir dan varian merah untuk Hapus', async () => {
  media = mockMatchMedia(true);
  const actions = twoGroups();
  const stock = actions[1] as RowAction;
  const submenu = [
    { ...(stock.submenu?.[0] as RowAction), disabled: true, disabledReason: 'Stok kosong' },
    stock.submenu?.[1] as RowAction,
  ];
  render(
    <TooltipProvider>
      <RowActionsHarness actions={[{ ...stock, submenu }]} />
    </TooltipProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Stok Asus' }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByText('Stok kosong')).toBeInTheDocument();
  expect(menu.querySelector('[data-variant="destructive"]')).not.toBeNull();
});
