import type { PostelDto } from '@shared/contract';
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
import { ApiError } from '@/lib/api/api-error';
import { meQueryKey } from '@/modules/auth/queries';
import { makeMe } from '@/test/make-me';
import { mockMatchMedia } from '@/test/match-media';
import { clickMoreAction } from '@/test/more-actions';
import { Route } from './index';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const base: PostelDto = {
  id: 'p1',
  name: 'M5-400',
  note: '',
  numbers: [
    {
      id: 'n1',
      number: 'AB-1',
      expiresOn: '2027-03-01',
      link: '',
      role: 'active',
      condition: 'valid',
      daysLeft: 200,
    },
  ],
  items: [{ id: 'i1', brand: 'PBE', model: 'M5-400' }],
  itemCount: 1,
  hiddenItemCount: 0,
  attachments: [],
  today: '2026-11-12',
  soonDays: 90,
  createdAt: '2026-11-01T03:00:00.000Z',
  updatedAt: '2026-11-10T03:00:00.000Z',
  updatedBy: 'a@x.com',
};

let current: PostelDto = base;
let calls: { id: string; input: unknown }[] = [];
let media: ReturnType<typeof mockMatchMedia> | undefined;

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  calls = [];
  current = base;
  apiMock.mockImplementation(async (id: string, input: { ids?: string[] }) => {
    calls.push({ id, input });
    switch (id) {
      case 'postels.get':
        return current;
      case 'postels.history':
        return { entries: [], nextCursor: null };
      case 'postels.removeBatch':
        return { ids: input.ids };
      case 'postels.restoreBatch':
        return { items: [base] };
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

async function mount({
  path = '/_app/postel/p1/',
  missing = false,
  level = 'edit',
}: {
  path?: string;
  missing?: boolean;
  level?: 'view' | 'edit';
} = {}) {
  if (missing) {
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'postels.get') throw new ApiError('NOT_FOUND', 'tidak ada', 'req-1');
      throw new Error(`api tak terduga: ${id}`);
    });
  }
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(meQueryKey, makeMe({ permissions: { sticker: level } }));
  const root = createRootRoute();
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/_app/postel/$postelId/',
    validateSearch: Route.options.validateSearch,
    component: Component as never,
  });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/postel',
    component: () => <p>Daftar Postel</p>,
  });
  const edits = createRoute({
    getParentRoute: () => root,
    path: '/postel/$postelId/edit',
    component: () => <p>Form ubah</p>,
  });
  // Tipe pohon rute dilonggarkan: beberapa rute berliteral jalur membuat tsc sangat lambat bila diketik penuh.
  const router: AnyRouter = createRouter({
    routeTree: root.addChildren([detail, index, edits] as never),
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
  if (!missing) await screen.findByRole('heading', { level: 1, name: 'M5-400' });
  return { router, client };
}

const callsOf = (id: string) => calls.filter((call) => call.id === id);

test('View: empat tab; klik tab mengganti search param dengan replace', async () => {
  const { router } = await mount();
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Detail',
    'Item',
    'Lampiran',
    'Riwayat',
  ]);
  const before = router.history.length;
  await userEvent.click(screen.getByRole('tab', { name: 'Lampiran' }));
  await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'lampiran' }));
  expect(router.history.length).toBe(before);
});

test('?tab=riwayat membuka tab Riwayat dan memuat riwayat', async () => {
  await mount({ path: '/_app/postel/p1/?tab=riwayat' });
  expect(await screen.findByText('Belum ada riwayat.')).toBeInTheDocument();
  expect(callsOf('postels.history')).toHaveLength(1);
});

test('Hapus dari View: konfirmasi menyebut jumlah item, removeBatch, kembali ke daftar, toast Dihapus + Pulihkan', async () => {
  const { router } = await mount();
  await clickMoreAction('Hapus');
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('Memuat 1 item');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/postel'));
  expect(callsOf('postels.removeBatch')[0]?.input).toEqual({ ids: ['p1'] });
  expect(toast.success).toHaveBeenCalledWith(
    'Dihapus',
    expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
  );
});

test('Ubah membuka form dengan push', async () => {
  const { router } = await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/postel/p1/edit'));
});

test('hanya baca: tanpa Ubah dan Hapus', async () => {
  await mount({ level: 'view' });
  expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
});

test('catatan terhapus: banner dan Pulihkan memanggil postels.restoreBatch', async () => {
  current = { ...base, deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } };
  await mount();
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  await waitFor(() => expect(callsOf('postels.restoreBatch')[0]?.input).toEqual({ ids: ['p1'] }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Catatan Postel dipulihkan'));
});

test('catatan yang tak ada: pesan tidak ditemukan', async () => {
  await mount({ path: '/_app/postel/x/', missing: true });
  expect(await screen.findByText('Catatan Postel tidak ditemukan')).toBeInTheDocument();
});

test('ponsel (360 px): judul, tab, dan aksi lewat menu', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  await mount();
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.getByRole('button', { name: /Aksi|Lainnya/ })).toBeInTheDocument();
});
