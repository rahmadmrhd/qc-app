import type { QrDesignDto } from '@shared/contract';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentType, Suspense } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { meQueryKey } from '@/modules/auth/queries';
import { makeMe } from '@/test/make-me';
import { mockMatchMedia } from '@/test/match-media';
import { Route } from './index';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: false }),
}));
// Riwayat versi memuat berkasnya sendiri; tidak relevan untuk halaman ini.
vi.mock('@/modules/qrcode/components/version-history', () => ({
  VersionHistory: () => <p>Riwayat versi</p>,
}));
// Dialog ekspor memuat berkas besar (pdf-lib); cukup dikenali bahwa ia dibuka.
vi.mock('@/modules/qrcode/components/export-dialog', () => ({
  ExportDialog: () => <p>Dialog ekspor</p>,
}));

const base: QrDesignDto = {
  id: 'd1',
  title: 'Panduan USW',
  linkSource: 'url',
  link: 'https://contoh.com/a',
  documentId: '',
  documentName: '',
  subtitle: 'USW PRO',
  footer: '',
  logoFileId: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  overflow: false,
  name: 'MB USW',
  namePlacement: 'subtitle',
  presetId: '',
  items: [{ id: 'i1', brand: 'PBE', model: 'M5-400' }],
  hiddenItemCount: 0,
  stickerVersion: 1,
  stickerStatus: 'active',
  exportStatus: 'none',
  exportedAt: '',
  exportedBy: '',
  createdAt: '2026-11-01T00:00:00.000Z',
  createdBy: 'a@x.com',
  updatedAt: '2026-11-02T00:00:00.000Z',
  updatedBy: 'a@x.com',
};

let current: QrDesignDto = base;
let calls: { id: string; input: unknown }[] = [];
let media: ReturnType<typeof mockMatchMedia> | undefined;

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  calls = [];
  current = base;
  apiMock.mockImplementation(async (id: string, input: unknown) => {
    calls.push({ id, input });
    switch (id) {
      case 'qrcodes.get':
        return current;
      case 'qrcodes.removeBatch':
        return { ids: (input as { ids: string[] }).ids };
      case 'qrcodes.restoreBatch':
        return { items: [{ ...base }] };
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

afterEach(() => {
  media?.restore();
  media = undefined;
  window.innerWidth = 1024;
});

async function mount({ manage = true, edit = true, path = '/_app/qrcode/d1/' } = {}) {
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    meQueryKey,
    makeMe({
      permissions: { qrcode: manage ? 'manage' : edit ? 'edit' : 'view', item: 'view' },
    }),
  );
  const root = createRootRoute();
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/_app/qrcode/$designId/',
    validateSearch: Route.options.validateSearch,
    component: Component as never,
  });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/qrcode',
    component: () => <p>Daftar QR</p>,
  });
  const edits = createRoute({
    getParentRoute: () => root,
    path: '/qrcode/$designId/edit',
    component: () => <p>Form ubah</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([detail, index, edits]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <Suspense fallback={<p>memuat</p>}>
            <RouterProvider router={router as never} />
          </Suspense>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });
  await screen.findByRole('heading', { level: 1, name: 'MB USW' });
  return { router };
}

test('View: tab Detail, Item, dan Versi stiker; klik tab mengganti search param dengan replace', async () => {
  const { router } = await mount();
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Detail',
    'Item',
    'Versi stiker',
  ]);
  const before = router.history.length;
  await userEvent.click(screen.getByRole('tab', { name: 'Item' }));
  await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'item' }));
  expect(router.history.length).toBe(before);
  expect(screen.getByRole('link', { name: 'PBE M5-400' })).toHaveAttribute('href', '/item/i1');
});

test('?tab= di URL memilih tab; nilai tak dikenal jatuh ke Detail', async () => {
  await mount({ path: '/_app/qrcode/d1/?tab=versi' });
  expect(screen.getByRole('tab', { name: 'Versi stiker', selected: true })).toBeInTheDocument();
  expect(screen.getByText('Riwayat versi')).toBeInTheDocument();
});

test('Hapus dari View: konfirmasi, qrcodes.removeBatch, kembali ke /qrcode, toast "Dihapus" dengan Pulihkan', async () => {
  const { router } = await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('Memuat 1 item');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/qrcode'));
  expect(calls.find((call) => call.id === 'qrcodes.removeBatch')?.input).toEqual({ ids: ['d1'] });
  expect(toast.success).toHaveBeenCalledWith(
    'Dihapus',
    expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
  );
});

test('tanpa hak kelola tombol Hapus tidak tampil; tanpa hak edit tak ada Ubah/Ekspor', async () => {
  await mount({ manage: false, edit: true });
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Ubah' })).toBeInTheDocument();
});

test('hanya baca: tak ada aksi tulis', async () => {
  await mount({ manage: false, edit: false });
  expect(screen.queryByRole('button', { name: /^(Hapus|Ubah|Ekspor)/ })).toBeNull();
});

test('Ubah membuka form dengan push (kembali ke View lewat Batal/Simpan)', async () => {
  const { router } = await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/qrcode/d1/edit'));
});

test('konfigurasi terhapus: banner dan Pulihkan memanggil qrcodes.restoreBatch', async () => {
  current = {
    ...base,
    deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
  };
  await mount();
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  await waitFor(() =>
    expect(calls.find((call) => call.id === 'qrcodes.restoreBatch')?.input).toEqual({
      ids: ['d1'],
    }),
  );
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Konfigurasi dipulihkan'));
});

test('Ekspor dari View membuka dialog ekspor', async () => {
  await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Ekspor' }));
  expect(await screen.findByText('Dialog ekspor')).toBeInTheDocument();
});

test('?export=1 membuka dialog ekspor sekali lalu parameter dibuang', async () => {
  const { router } = await mount({ path: '/_app/qrcode/d1/?export=1' });
  await waitFor(() => expect(router.state.location.search).toEqual({}));
  expect(await screen.findByText('Dialog ekspor')).toBeInTheDocument();
  expect(router.state.location.search).toEqual({});
});

test('konfigurasi yang tak ada: pesan "tidak ditemukan"', async () => {
  const { ApiError } = await import('@/lib/api/api-error');
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'qrcodes.get') throw new ApiError('NOT_FOUND', 'tidak ada', 'req-1');
    throw new Error(`api tak terduga: ${id}`);
  });
  const Component = Route.options.component as ComponentType;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(meQueryKey, makeMe({ permissions: { qrcode: 'view' } }));
  const root = createRootRoute();
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/_app/qrcode/$designId/',
    validateSearch: Route.options.validateSearch,
    component: Component as never,
  });
  const router = createRouter({
    routeTree: root.addChildren([detail]),
    history: createMemoryHistory({ initialEntries: ['/_app/qrcode/x/'] }),
  });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <Suspense fallback={<p>memuat</p>}>
            <RouterProvider router={router as never} />
          </Suspense>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });
  expect(await screen.findByText('Konfigurasi tidak ditemukan')).toBeInTheDocument();
});

test('ponsel (360 px): judul, tab, dan aksi tetap terjangkau lewat menu', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  await mount();
  expect(screen.getAllByRole('tab')).toHaveLength(3);
  expect(screen.getByRole('button', { name: /Aksi|Lainnya/ })).toBeInTheDocument();
});
