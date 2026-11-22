import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { mockMatchMedia } from '@/test/match-media';
import { DetailList, ViewMeta, ViewPage, ViewSection } from './view-page';

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

async function renderInRouter(element: ReactNode) {
  const root = createRootRoute({ component: () => <>{element}</> });
  const target = createRoute({ getParentRoute: () => root, path: '/item', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([target]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
}

test('judul h1, badge, aksi, banner, dan aside dirender', () => {
  render(
    <ViewPage
      title="Asus RT-AX55"
      badge={<span>Aktif</span>}
      actions={<button type="button">Ubah</button>}
      banner={<div>Data ini sudah dihapus</div>}
      aside={<p>samping</p>}
    >
      <p>isi</p>
    </ViewPage>,
  );
  expect(screen.getByRole('heading', { level: 1, name: 'Asus RT-AX55' })).toBeInTheDocument();
  expect(screen.getByText('Aktif')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ubah' })).toBeInTheDocument();
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.getByText('samping')).toBeInTheDocument();
  expect(screen.getByText('isi')).toBeInTheDocument();
});

test('tab berpindah isi saat diklik dan melaporkan lewat onTabChange', async () => {
  const onTabChange = vi.fn();
  render(
    <ViewPage
      title="Merk"
      tabs={[
        { id: 'detail', label: 'Detail', content: <p>isi detail</p> },
        { id: 'riwayat', label: 'Riwayat', content: <p>isi riwayat</p> },
      ]}
      onTabChange={onTabChange}
    />,
  );
  expect(screen.getByText('isi detail')).toBeVisible();
  expect(screen.queryByText('isi riwayat')).toBeNull();
  await userEvent.click(screen.getByRole('tab', { name: 'Riwayat' }));
  expect(screen.getByText('isi riwayat')).toBeVisible();
  expect(onTabChange).toHaveBeenCalledWith('riwayat');
  expect(screen.getByRole('tablist').className).toContain('sticky');
});

test('tab terkendali mengikuti prop tab', () => {
  render(
    <ViewPage
      title="Merk"
      tab="riwayat"
      tabs={[
        { id: 'detail', label: 'Detail', content: <p>isi detail</p> },
        { id: 'riwayat', label: 'Riwayat', content: <p>isi riwayat</p> },
      ]}
    />,
  );
  expect(screen.getByText('isi riwayat')).toBeVisible();
});

test('DetailList: nilai kosong "—", butir hidden dilewati', () => {
  render(
    <DetailList
      items={[
        { label: 'Merk', value: 'Asus' },
        { label: 'Catatan', value: '' },
        { label: 'Kosong', value: null },
        { label: 'Rahasia', value: 'x', hidden: true },
      ]}
    />,
  );
  expect(screen.getByText('Asus')).toBeInTheDocument();
  expect(screen.getAllByText('—')).toHaveLength(2);
  expect(screen.queryByText('Rahasia')).toBeNull();
});

test('ViewSection merender judul dan isi', () => {
  render(
    <ViewSection title="Informasi">
      <p>isi</p>
    </ViewSection>,
  );
  expect(screen.getByRole('heading', { level: 2, name: 'Informasi' })).toBeInTheDocument();
});

test('ViewMeta tanpa createdBy tidak menampilkan "Dibuat"; "Diubah oleh" bila ada', () => {
  render(<ViewMeta updatedBy="budi@qc.local" updatedAt="2026-11-12T03:00:00.000Z" />);
  expect(screen.queryByText(/Dibuat/)).toBeNull();
  expect(screen.getByText(/oleh budi@qc.local/)).toBeInTheDocument();
});

test('ViewMeta menampilkan Dibuat bila DTO punya createdBy dan tautan tanpa angka', async () => {
  await renderInRouter(
    <ViewMeta
      createdBy="ani@qc.local"
      createdAt="2026-11-01T03:00:00.000Z"
      links={[{ label: 'Lihat Serial Number item ini', to: '/item' as never }]}
    />,
  );
  expect(screen.getByText(/oleh ani@qc.local/)).toBeInTheDocument();
  const link = await screen.findByRole('link', { name: 'Lihat Serial Number item ini' });
  expect(link).toHaveAttribute('href', '/item');
  expect(within(link.closest('ul') as HTMLElement).queryByText(/\d/)).toBeNull();
});

test('tab terkendali dengan id tak dikenal jatuh ke tab pertama', () => {
  render(
    <ViewPage
      title="Merk"
      tab="hilang"
      tabs={[
        { id: 'detail', label: 'Detail', content: <p>isi detail</p> },
        { id: 'riwayat', label: 'Riwayat', content: <p>isi riwayat</p> },
      ]}
    />,
  );
  expect(screen.getByText('isi detail')).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Detail' })).toHaveAttribute('aria-selected', 'true');
});

const ITEMS = (onEdit: () => void, onDelete: () => void) => [
  { id: 'edit', action: 'edit' as const, label: 'Ubah', onSelect: onEdit },
  { id: 'delete', action: 'delete' as const, onSelect: onDelete },
];

test('actionItems di desktop: semua aksi jadi tombol di bar judul, tanpa bar bawah', () => {
  mockMatchMedia(true);
  render(<ViewPage title="X" actionItems={ITEMS(vi.fn(), vi.fn())} />);
  expect(screen.getByRole('button', { name: 'Ubah' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Aksi halaman' })).toBeNull();
});

test('actionItems di ponsel: aksi utama di bar bawah, sisanya di menu "Aksi lainnya"', async () => {
  mockMatchMedia(false);
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  render(<ViewPage title="X" actionItems={ITEMS(onEdit, onDelete)} />);
  const bar = screen.getByRole('region', { name: 'Aksi halaman' });
  await userEvent.click(within(bar).getByRole('button', { name: 'Ubah' }));
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(bar.className).toContain('fixed');
  // Aksi utama (Ubah) berwarna primary solid, bukan outline.
  expect(within(bar).getByRole('button', { name: 'Ubah' }).className).toContain('bg-primary');
  expect(screen.getByRole('heading', { level: 1 }).className).toContain('narrow:sr-only');
  expect(within(bar).queryByRole('button', { name: 'Hapus' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Aksi lainnya' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Hapus' }));
  expect(onDelete).toHaveBeenCalledTimes(1);
});

test('ponsel: aksi utama yang nonaktif beralasan tetap mengisi bar bawah (flex-1) dan alasannya terlihat', () => {
  mockMatchMedia(false);
  render(
    <ViewPage
      title="X"
      actionItems={[
        {
          id: 'status',
          action: 'deactivate' as const,
          disabled: true,
          disabledReason: 'Tidak dapat menonaktifkan akun Anda sendiri',
          onSelect: vi.fn(),
        },
      ]}
    />,
  );
  const bar = screen.getByRole('region', { name: 'Aksi halaman' });
  const button = within(bar).getByRole('button', { name: 'Nonaktifkan' });
  expect(button).toBeDisabled();
  expect(button.parentElement).toHaveClass('flex-1');
  expect(within(bar).getByText('Tidak dapat menonaktifkan akun Anda sendiri')).toBeVisible();
});

const UNDUH = (onPdf: () => void, onPng: () => void) => ({
  id: 'download',
  action: 'download' as const,
  label: 'Unduh',
  onSelect: () => undefined,
  submenu: [
    {
      id: 'pdf',
      action: 'download' as const,
      label: 'Unduh PDF',
      shortLabel: 'PDF',
      onSelect: onPdf,
    },
    {
      id: 'png',
      action: 'download' as const,
      label: 'Unduh PNG',
      shortLabel: 'PNG',
      onSelect: onPng,
    },
  ],
});

test('desktop: aksi bersubmenu = satu tombol dengan satu dropdown berisi butirnya', async () => {
  mockMatchMedia(true);
  const onPdf = vi.fn();
  const onPng = vi.fn();
  render(
    <ViewPage title="X" actionItems={[ITEMS(vi.fn(), vi.fn())[0] as never, UNDUH(onPdf, onPng)]} />,
  );
  expect(screen.queryByRole('button', { name: 'Unduh PDF' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Unduh' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Unduh PDF' }));
  expect(onPdf).toHaveBeenCalledTimes(1);
  expect(onPng).not.toHaveBeenCalled();
});

test('ponsel: aksi bersubmenu menjadi grup datar di menu "Aksi lainnya" (tanpa menu bersarang)', async () => {
  mockMatchMedia(false);
  const onPdf = vi.fn();
  render(
    <ViewPage
      title="X"
      actionItems={[ITEMS(vi.fn(), vi.fn())[0] as never, UNDUH(onPdf, vi.fn())]}
    />,
  );
  const bar = screen.getByRole('region', { name: 'Aksi halaman' });
  // Aksi bersubmenu tak pernah menjadi tombol utama di bar.
  expect(within(bar).queryByRole('button', { name: 'Unduh' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Aksi lainnya' }));
  expect(await screen.findAllByRole('menu')).toHaveLength(1);
  expect(screen.getByText('Unduh')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('menuitem', { name: 'PDF' }));
  expect(onPdf).toHaveBeenCalledTimes(1);
});

test('ponsel: beberapa aksi `primary` mengisi bar bawah bersama (Lapor rusak + Ubah), sisanya di menu', () => {
  mockMatchMedia(false);
  render(
    <ViewPage
      title="X"
      actionItems={[
        { id: 'report', action: 'reportDamage', primary: true, onSelect: vi.fn() },
        { id: 'edit', action: 'edit', primary: true, onSelect: vi.fn() },
        { id: 'delete', action: 'delete', onSelect: vi.fn() },
      ]}
    />,
  );
  const bar = screen.getByRole('region', { name: 'Aksi halaman' });
  const labels = within(bar)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent);
  expect(labels).toEqual(['Lapor rusak', 'Ubah', 'Aksi lainnya']);
});

test('ponsel: dua aksi bersubmenu berurutan dipisah satu garis dan induk nonaktif menonaktifkan butirnya', async () => {
  mockMatchMedia(false);
  render(
    <ViewPage
      title="X"
      actionItems={[
        {
          ...UNDUH(vi.fn(), vi.fn()),
          id: 'dl1',
          label: 'Unduh A',
          disabled: true,
          disabledReason: 'Belum siap',
        },
        { ...UNDUH(vi.fn(), vi.fn()), id: 'dl2', label: 'Unduh B' },
        { id: 'delete', action: 'delete', onSelect: vi.fn() },
      ]}
    />,
  );
  const bar = screen.getByRole('region', { name: 'Aksi halaman' });
  await userEvent.click(within(bar).getByRole('button', { name: 'Aksi lainnya' }));
  const menu = await screen.findByRole('menu');
  const separators = within(menu).getAllByRole('separator');
  expect(separators).toHaveLength(1); // grup A | grup B (Hapus jadi tombol utama di bar)
  for (const separator of separators) {
    expect(separator.nextElementSibling?.getAttribute('role')).not.toBe('separator');
  }
  const [pdfA] = within(menu).getAllByRole('menuitem', { name: /PDF/ });
  expect(pdfA).toHaveAttribute('aria-disabled', 'true');
  expect(within(menu).getAllByText('Belum siap').length).toBeGreaterThan(0);
});
