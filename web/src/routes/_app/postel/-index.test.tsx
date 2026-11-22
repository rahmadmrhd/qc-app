import type { PostelListDto, PostelSummaryDto } from '@shared/contract';
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
import { closeFilterChip } from '@/test/link-field';
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

const summary = (id: string, patch: Partial<PostelSummaryDto> = {}): PostelSummaryDto => ({
  id,
  name: `Postel ${id}`,
  itemCount: 2,
  activeNumber: `NO-${id}`,
  activeExpiresOn: '2027-03-01',
  condition: 'valid',
  daysLeft: 200,
  oldNumberCount: 0,
  numbers: [`NO-${id}`],
  models: [`M-${id}`],
  updatedAt: '2026-11-02T00:00:00.000Z',
  ...patch,
});

const listOf = (postels: PostelSummaryDto[]): PostelListDto => ({
  postels,
  today: '2026-11-12',
  soonDays: 90,
});

let rows: PostelSummaryDto[] = [];
let deletedRows: PostelSummaryDto[] = [];
let calls: { id: string; input: unknown }[] = [];
let media: ReturnType<typeof mockMatchMedia> | undefined;

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  calls = [];
  rows = [
    summary('p1', { condition: 'soon', daysLeft: 20, activeExpiresOn: '2026-12-02' }),
    summary('p2'),
  ];
  deletedRows = [
    summary('p9', { deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } }),
  ];
  apiMock.mockImplementation(async (id: string, input: { ids?: string[]; status?: string }) => {
    calls.push({ id, input });
    switch (id) {
      case 'postels.list':
        return listOf(input?.status === 'deleted' ? deletedRows : rows);
      case 'postels.removeBatch':
        return { ids: input.ids };
      case 'postels.restoreBatch':
        return { items: [] };
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
  level = 'edit',
  path = '/_app/postel/',
}: {
  level?: 'view' | 'edit';
  path?: string;
} = {}) {
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(meQueryKey, makeMe({ permissions: { sticker: level } }));
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: '/_app/postel/',
    validateSearch: Route.options.validateSearch,
    component: Component as never,
  });
  const created = createRoute({
    getParentRoute: () => root,
    path: '/postel/new',
    component: () => <p>Form baru</p>,
  });
  const edits = createRoute({
    getParentRoute: () => root,
    path: '/postel/$postelId/edit',
    component: () => <p>Form ubah</p>,
  });
  // Tipe pohon rute dilonggarkan: beberapa rute berliteral jalur membuat tsc sangat lambat bila diketik penuh.
  const router: AnyRouter = createRouter({
    routeTree: root.addChildren([route, created, edits] as never),
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
  await screen.findByRole('heading', { level: 1, name: 'Postel' });
  return { router };
}

test('daftar tampil di kit: judul, jumlah, tabel, tautan nama ke View, tanpa tombol Lihat', async () => {
  await mount();
  await screen.findByRole('table', { name: 'Daftar catatan Postel' });
  expect(screen.getByText('2 catatan')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Postel p1' })).toHaveAttribute('href', '/postel/p1');
  expect(screen.queryByRole('button', { name: /^Lihat/ })).toBeNull();
});

test('urutan bawaan: tanggal habis nomor Aktif menaik', async () => {
  await mount();
  await screen.findByRole('table', { name: 'Daftar catatan Postel' });
  const names = screen.getAllByRole('link', { name: /^Postel / }).map((link) => link.textContent);
  expect(names).toEqual(['Postel p1', 'Postel p2']);
});

test('Tambah Postel membuka form baru dengan push; hanya untuk pemegang edit', async () => {
  const { router } = await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Postel' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/postel/new'));
});

test('hanya baca: tanpa Tambah Postel, checkbox, atau filter status', async () => {
  await mount({ level: 'view' });
  await screen.findByRole('table', { name: 'Daftar catatan Postel' });
  expect(screen.queryByRole('button', { name: 'Tambah Postel' })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Status' })).toBeNull();
});

test('pencarian menyaring dan memakai replace (tanpa menambah riwayat)', async () => {
  const { router } = await mount();
  await screen.findByRole('table', { name: 'Daftar catatan Postel' });
  const before = router.history.length;
  await userEvent.type(screen.getByRole('searchbox', { name: 'Cari Postel' }), 'p2');
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Postel p1' })).toBeNull());
  expect(screen.getByRole('link', { name: 'Postel p2' })).toBeInTheDocument();
  await waitFor(() => expect(router.state.location.search).toEqual({ q: 'p2' }));
  expect(router.history.length).toBe(before);
});

test('filter Kondisi multi-value menyaring di klien dan memakai replace', async () => {
  const { router } = await mount();
  await screen.findByRole('table', { name: 'Daftar catatan Postel' });
  const before = router.history.length;
  await userEvent.click(screen.getByRole('button', { name: 'Kondisi' }));
  await userEvent.click(await screen.findByRole('combobox', { name: 'Filter kondisi' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Segera habis' }));
  // Pilihan kedua menambah draf (salah satu dari): URL dan daftar baru berubah SEKALI saat chip menutup.
  await userEvent.click(await screen.findByRole('option', { name: 'Kedaluwarsa' }));
  expect(router.state.location.search).toEqual({});
  expect(screen.getByRole('link', { name: 'Postel p2' })).toBeInTheDocument();
  await closeFilterChip();
  await waitFor(() =>
    expect(router.state.location.search).toEqual({ conditions: ['soon', 'expired'] }),
  );
  expect(
    await screen.findByRole('button', { name: /^Kondisi: Segera habis, Kedaluwarsa/ }),
  ).toBeInTheDocument();
  expect(router.history.length).toBe(before);
});

test('param tunggal lama ?condition= dibaca sebagai conditions', async () => {
  await mount({ path: '/_app/postel/?condition=soon' });
  await screen.findByRole('table', { name: 'Daftar catatan Postel' });
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Postel p2' })).toBeNull());
  expect(screen.getByRole('link', { name: 'Postel p1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Kondisi: Segera habis/ })).toBeInTheDocument();
});

test('pilih semua lalu Hapus: konfirmasi menyebut jumlah item, postels.removeBatch, toast dengan Pulihkan', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByText('2 dipilih')).toBeInTheDocument();
  await userEvent.click(within(bar).getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('Memuat 4 item');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('postels.removeBatch')).toHaveLength(1));
  expect(callsOf('postels.removeBatch')[0]?.input).toEqual({ ids: ['p1', 'p2'] });
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      '2 catatan Postel dihapus',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
    ),
  );
});

test('mengubah filter mengosongkan pilihan', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  expect(screen.getByText('2 dipilih')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('searchbox', { name: 'Cari Postel' }), 'p1');
  await waitFor(() => expect(screen.queryByText(/^\d+ dipilih$/)).toBeNull());
});

test('tampilan Terhapus: bar massal hanya Pulihkan dan memanggil postels.restoreBatch', async () => {
  await mount({ path: '/_app/postel/?status=deleted' });
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih Postel p9' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).queryByRole('button', { name: 'Hapus' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Pulihkan' }));
  await waitFor(() => expect(callsOf('postels.restoreBatch')).toHaveLength(1));
  expect(callsOf('postels.restoreBatch')[0]?.input).toEqual({ ids: ['p9'] });
  expect(
    callsOf('postels.list').some(
      (call) => (call.input as { status?: string })?.status === 'deleted',
    ),
  ).toBe(true);
});

test('?status=deleted tulisan tangan tanpa hak edit jatuh ke daftar hidup', async () => {
  await mount({ level: 'view', path: '/_app/postel/?status=deleted' });
  await screen.findByRole('table', { name: 'Daftar catatan Postel' });
  expect(screen.getByRole('link', { name: 'Postel p1' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Postel p9' })).toBeNull();
  expect(
    callsOf('postels.list').some(
      (call) => (call.input as { status?: string } | null)?.status === 'deleted',
    ),
  ).toBe(false);
});

test('pemegang edit melihat opsi Terhapus pada filter Status', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Status' }));
  await userEvent.click(await screen.findByRole('combobox', { name: 'Filter status' }));
  const options = await screen.findAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual(['Hidup', 'Terhapus']);
});

test('ponsel (360 px): kartu, tombol Tambah Postel tetap terjangkau, tanpa tabel', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  await mount();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('link', { name: 'Postel p1' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Tambah Postel/ }).length).toBeGreaterThan(0);
});
