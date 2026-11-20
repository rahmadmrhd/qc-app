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
import { expect, test, vi } from 'vitest';
import { DetailList, ViewMeta, ViewPage, ViewSection } from './view-page';

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
