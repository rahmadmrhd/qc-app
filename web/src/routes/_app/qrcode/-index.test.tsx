import type { QrDesignDto } from '@shared/contract';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type AnyRouter,
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
vi.mock('@/modules/qrcode/components/export-dialog', () => ({
  ExportDialog: () => <p>Dialog ekspor</p>,
}));
vi.mock('@/modules/qrcode/lib/prepare-export', () => ({
  prepareExportFiles: async () => ({
    pdf: new Uint8Array(1),
    png: new Uint8Array(1),
    preview: new Uint8Array(1),
  }),
}));

const design = (id: string, patch: Partial<QrDesignDto> = {}): QrDesignDto => ({
  id,
  title: `Judul ${id}`,
  linkSource: 'url',
  link: 'https://contoh.com/a',
  documentId: '',
  documentName: '',
  subtitle: '',
  footer: '',
  logoFileId: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  overflow: false,
  name: `MB ${id}`,
  namePlacement: '',
  presetId: '',
  items: [{ id: `it-${id}`, brand: 'PBE', model: `M-${id}` }],
  hiddenItemCount: 0,
  stickerVersion: 0,
  stickerStatus: '',
  exportStatus: 'none',
  exportedAt: '',
  exportedBy: '',
  createdAt: 't',
  createdBy: 'a@x.com',
  updatedAt: '2026-11-02T00:00:00.000Z',
  updatedBy: 'a@x.com',
  ...patch,
});

let rows: QrDesignDto[] = [];
let deletedRows: QrDesignDto[] = [];
let calls: { id: string; input: unknown }[] = [];
/** Konfigurasi yang sudah diekspor selama tes (membuat `qrcodes.get` mengembalikan status "current"). */
let exportedIds = new Set<string>();
let media: ReturnType<typeof mockMatchMedia> | undefined;

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  calls = [];
  exportedIds = new Set();
  rows = [design('q1'), design('q2')];
  deletedRows = [
    design('q9', { deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } }),
  ];
  apiMock.mockImplementation(async (id: string, input: { ids?: string[]; status?: string }) => {
    calls.push({ id, input });
    switch (id) {
      case 'qrcodes.list':
        return input?.status === 'deleted' ? deletedRows : rows;
      case 'qrcodes.removeBatch':
        return { ids: input.ids };
      case 'qrcodes.restoreBatch':
        return { items: (input.ids ?? []).map((designId) => design(designId)) };
      case 'qrcodes.get': {
        const found = rows.find((row) => row.id === (input as { id: string }).id);
        if (!found) throw new Error('tak ditemukan');
        return exportedIds.has(found.id)
          ? { ...found, exportStatus: 'current', exportedAt: 'x', exportedBy: 'a@x.com' }
          : found;
      }
      case 'qrcodes.export':
        exportedIds.add((input as { id: string }).id);
        return { jobId: `job-${(input as { id: string }).id}` };
      case 'jobs.get':
        return { id: (input as { id: string }).id, status: 'done', progress: 100 };
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

const callsOf = (id: string) => calls.filter((call) => call.id === id);

async function mount({
  level = 'manage',
  path = '/_app/qrcode/',
}: {
  level?: 'view' | 'edit' | 'manage';
  path?: string;
} = {}) {
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(meQueryKey, makeMe({ permissions: { qrcode: level, item: 'view' } }));
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: '/_app/qrcode/',
    validateSearch: Route.options.validateSearch,
    component: Component as never,
  });
  const created = createRoute({
    getParentRoute: () => root,
    path: '/qrcode/new',
    component: () => <p>Form baru</p>,
  });
  const defaults = createRoute({
    getParentRoute: () => root,
    path: '/qrcode/default',
    component: () => <p>Daftar default</p>,
  });
  // Tipe pohon rute dilonggarkan: tiga rute berliteral jalur membuat tsc sangat lambat bila diketik penuh.
  const router: AnyRouter = createRouter({
    routeTree: root.addChildren([route, created, defaults] as never),
    history: createMemoryHistory({ initialEntries: [path] }),
  } as never);
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <Suspense fallback={<p>memuat</p>}>
            <RouterProvider router={router} />
          </Suspense>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });
  await screen.findByRole('heading', { level: 1, name: 'QR Code Label' });
  return { router };
}

test('daftar tampil di kit: judul, jumlah, tabel, tautan nama ke View', async () => {
  await mount();
  await screen.findByRole('table', { name: 'Daftar konfigurasi QR' });
  expect(screen.getByText('2 konfigurasi')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'MB q1' })).toHaveAttribute('href', '/qrcode/q1');
  expect(screen.queryByRole('button', { name: /^Lihat/ })).toBeNull();
});

test('Buat konfigurasi membuka form baru dengan push; hanya untuk pemegang edit', async () => {
  const { router } = await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Buat konfigurasi' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/qrcode/new'));
});

test('hanya baca: tanpa Buat konfigurasi, checkbox, atau filter status', async () => {
  await mount({ level: 'view' });
  await screen.findByRole('table', { name: 'Daftar konfigurasi QR' });
  expect(screen.queryByRole('button', { name: 'Buat konfigurasi' })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Status' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Konfigurasi default' })).toBeNull();
});

test('pencarian menyaring dan memakai replace (tanpa menambah riwayat)', async () => {
  const { router } = await mount();
  await screen.findByRole('table', { name: 'Daftar konfigurasi QR' });
  const before = router.history.length;
  await userEvent.type(screen.getByRole('searchbox', { name: 'Cari konfigurasi' }), 'q2');
  await waitFor(() => expect(screen.queryByRole('link', { name: 'MB q1' })).toBeNull());
  expect(screen.getByRole('link', { name: 'MB q2' })).toBeInTheDocument();
  await waitFor(() => expect(router.state.location.search).toEqual({ q: 'q2' }));
  expect(router.history.length).toBe(before);
});

test('pilih semua lalu Hapus: konfirmasi menyebut jumlah item, qrcodes.removeBatch, toast dengan Pulihkan', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByText('2 dipilih')).toBeInTheDocument();
  await userEvent.click(within(bar).getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('Memuat 2 item');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('qrcodes.removeBatch')).toHaveLength(1));
  expect(callsOf('qrcodes.removeBatch')[0]?.input).toEqual({ ids: ['q1', 'q2'] });
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      '2 konfigurasi dihapus',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
    ),
  );
});

test('pemegang edit tanpa kelola: checkbox dan Ekspor di bar massal, tanpa Hapus', async () => {
  await mount({ level: 'edit' });
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByRole('button', { name: 'Ekspor' })).toBeInTheDocument();
  expect(within(bar).queryByRole('button', { name: 'Hapus' })).toBeNull();
});

test('pemegang kelola melihat Ekspor dan Hapus di bar massal', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByRole('button', { name: 'Ekspor' })).toBeInTheDocument();
  expect(within(bar).getByRole('button', { name: 'Hapus' })).toBeInTheDocument();
});

test('Ekspor di bar massal tampil bila minimal satu terpilih dapat diekspor, dan hilang bila tak ada', async () => {
  // q1 sudah terbaru (tak perlu diekspor), q2 belum pernah diekspor.
  rows = [
    design('q1', { exportStatus: 'current', exportedAt: 'x', stickerVersion: 1 }),
    design('q2'),
  ];
  await mount({ level: 'edit' });
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih MB q1' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).queryByRole('button', { name: 'Ekspor' })).toBeNull();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih MB q2' }));
  expect(within(bar).getByRole('button', { name: 'Ekspor' })).toBeInTheDocument();
});

test('Ekspor massal: konfirmasi, diekspor berurutan lewat qrcodes.export, yang sukses dibuang dari pilihan', async () => {
  await mount({ level: 'edit' });
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(
    within(screen.getByRole('region', { name: 'Aksi massal' })).getByRole('button', {
      name: 'Ekspor',
    }),
  );
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Ekspor 2 konfigurasi ke Drive?');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ekspor 2 konfigurasi' }));
  await within(dialog).findByText('Ekspor selesai', undefined, { timeout: 5000 });
  const exports = callsOf('qrcodes.export');
  expect(exports.map((call) => (call.input as { id: string }).id)).toEqual(['q1', 'q2']);
  expect(exports.every((call) => (call.input as { reason: string }).reason === '')).toBe(true);
  expect(toast.success).toHaveBeenCalledWith('2 konfigurasi diekspor');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tutup' }));
  await waitFor(() => expect(screen.queryByText(/dipilih/)).toBeNull());
});

test('mengubah filter mengosongkan pilihan', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  expect(screen.getByText('2 dipilih')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('searchbox', { name: 'Cari konfigurasi' }), 'q1');
  await waitFor(() => expect(screen.queryByText(/dipilih/)).toBeNull());
});

test('tampilan Terhapus: bar massal hanya Pulihkan dan memanggil qrcodes.restoreBatch', async () => {
  await mount({ path: '/_app/qrcode/?status=deleted' });
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih MB q9' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(within(bar).queryByRole('button', { name: 'Ekspor' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Pulihkan' }));
  await waitFor(() => expect(callsOf('qrcodes.restoreBatch')).toHaveLength(1));
  expect(callsOf('qrcodes.restoreBatch')[0]?.input).toEqual({ ids: ['q9'] });
  expect(
    callsOf('qrcodes.list').some(
      (call) => (call.input as { status?: string })?.status === 'deleted',
    ),
  ).toBe(true);
});

test('?status=deleted tulisan tangan tanpa hak kelola jatuh ke daftar hidup', async () => {
  await mount({ level: 'edit', path: '/_app/qrcode/?status=deleted' });
  await screen.findByRole('table', { name: 'Daftar konfigurasi QR' });
  expect(screen.getByRole('link', { name: 'MB q1' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'MB q9' })).toBeNull();
  expect(
    callsOf('qrcodes.list').some(
      (call) => (call.input as { status?: string } | null)?.status === 'deleted',
    ),
  ).toBe(false);
});

test('pemegang kelola melihat opsi Terhapus pada filter Status', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Status' }));
  await userEvent.click(await screen.findByRole('combobox', { name: 'Filter status' }));
  const options = await screen.findAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual(['Hidup', 'Terhapus']);
});

test('Konfigurasi default (kelola) membuka daftar default dengan push', async () => {
  const { router } = await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Konfigurasi default' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/qrcode/default'));
});

test('ponsel (360 px): kartu, tombol Buat konfigurasi tetap terjangkau, tanpa tabel', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  await mount();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('link', { name: 'MB q1' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Buat konfigurasi/ }).length).toBeGreaterThan(0);
});
