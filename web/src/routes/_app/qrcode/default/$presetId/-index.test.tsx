import type { QrDesignDto, QrPresetDto } from '@shared/contract';
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
import { ApiError } from '@/lib/api/api-error';
import { meQueryKey } from '@/modules/auth/queries';
import { makeMe } from '@/test/make-me';
import { mockMatchMedia } from '@/test/match-media';
import { clickMoreAction, moreActionNames } from '@/test/more-actions';
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

const base: QrPresetDto = {
  id: 'p1',
  name: 'Standar Spectrum',
  title: 'Judul Preset',
  subtitle: 'Sub',
  footer: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  defaultLogoId: '',
  buId: 'bu1',
  namePlacement: 'subtitle',
  createdAt: '2026-11-01T00:00:00.000Z',
  createdBy: 'a@x.com',
  updatedAt: '2026-11-02T00:00:00.000Z',
  updatedBy: 'a@x.com',
};

const design = (id: string, presetId: string): QrDesignDto =>
  ({
    id,
    title: `Judul ${id}`,
    name: `MB ${id}`,
    presetId,
    items: [],
    hiddenItemCount: 0,
  }) as unknown as QrDesignDto;

let current: QrPresetDto = base;
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
      case 'qrcodes.getPreset':
        return current;
      case 'qrcodes.getDefaults':
        return { presets: [base], logoFileIds: [], logoUpdatedAt: '' };
      case 'businessUnits.options':
        return [
          { id: 'bu1', code: 'SPC', name: 'Spectrum', status: 'active' },
          { id: 'bu2', code: 'NXT', name: 'Nexus', status: 'active' },
        ];
      case 'qrcodes.list':
        return [design('q1', 'p1'), design('q2', 'p1'), design('q3', 'other')];
      case 'qrcodes.removePresetBatch':
        return { ids: input.ids };
      case 'qrcodes.restorePresetBatch':
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

async function mount({ path = '/_app/qrcode/default/p1/', missing = false } = {}) {
  if (missing) {
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'qrcodes.getPreset') throw new ApiError('NOT_FOUND', 'tidak ada', 'req-1');
      if (id === 'businessUnits.options') return [];
      throw new Error(`api tak terduga: ${id}`);
    });
  }
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(meQueryKey, makeMe({ permissions: { qrcode: 'manage', access: 'view' } }));
  const root = createRootRoute();
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/_app/qrcode/default/$presetId/',
    validateSearch: Route.options.validateSearch,
    component: Component as never,
  });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/qrcode/default',
    component: () => <p>Daftar default</p>,
  });
  const edits = createRoute({
    getParentRoute: () => root,
    path: '/qrcode/default/$presetId/edit',
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
  if (!missing) {
    await screen.findByRole('heading', { level: 1, name: 'Standar Spectrum' });
  }
  return { router };
}

test('View: tab Detail dan "Dipakai oleh"; klik tab mengganti search param dengan replace', async () => {
  const { router } = await mount();
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Detail',
    'Dipakai oleh',
  ]);
  expect(screen.getByRole('link', { name: 'SPC - Spectrum' })).toHaveAttribute(
    'href',
    '/access/business-units/bu1',
  );
  const before = router.history.length;
  await userEvent.click(screen.getByRole('tab', { name: 'Dipakai oleh' }));
  await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'dipakai' }));
  expect(router.history.length).toBe(before);
});

test('"Dipakai oleh" mendaftar hanya konfigurasi QR dengan presetId ini, menaut ke View-nya', async () => {
  await mount({ path: '/_app/qrcode/default/p1/?tab=dipakai' });
  const links = await screen.findAllByRole('link', { name: /^MB / });
  expect(links.map((link) => link.textContent)).toEqual(['MB q1', 'MB q2']);
  expect(links[0]).toHaveAttribute('href', '/qrcode/q1');
});

test('Hapus dari View: konfirmasi menyebut pemakai, removePresetBatch, kembali ke daftar, toast "Dihapus"', async () => {
  const { router } = await mount();
  await clickMoreAction('Hapus');
  const dialog = await screen.findByRole('alertdialog');
  await waitFor(() => expect(dialog).toHaveTextContent('Dipakai oleh 2 konfigurasi QR'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/qrcode/default'));
  expect(calls.find((call) => call.id === 'qrcodes.removePresetBatch')?.input).toEqual({
    ids: ['p1'],
  });
  expect(toast.success).toHaveBeenCalledWith(
    'Dihapus',
    expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
  );
});

test('Ubah membuka form dengan push', async () => {
  const { router } = await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/qrcode/default/p1/edit'));
});

test('Kloning ke BU lain membuka dialog kloning', async () => {
  await mount();
  // Kloning dan Hapus bukan aksi utama: tak tampil sebagai tombol, hanya di menu "Aksi lainnya".
  expect(screen.getByRole('button', { name: 'Ubah' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Kloning ke BU lain' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(await moreActionNames()).toEqual(['Kloning ke BU lain', 'Hapus']);
  await clickMoreAction('Kloning ke BU lain');
  expect(await screen.findByRole('dialog')).toHaveTextContent('Kloning ke BU lain');
});

test('preset terhapus: banner dan Pulihkan memanggil qrcodes.restorePresetBatch', async () => {
  current = {
    ...base,
    deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
  };
  await mount();
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  await waitFor(() =>
    expect(calls.find((call) => call.id === 'qrcodes.restorePresetBatch')?.input).toEqual({
      ids: ['p1'],
    }),
  );
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Konfigurasi default dipulihkan'));
});

test('preset yang tak ada: pesan "tidak ditemukan"', async () => {
  await mount({ path: '/_app/qrcode/default/x/', missing: true });
  expect(await screen.findByText('Konfigurasi default tidak ditemukan')).toBeInTheDocument();
});

test('ponsel (360 px): judul, tab, dan aksi lewat menu', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  await mount();
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(screen.getByRole('button', { name: /Aksi|Lainnya/ })).toBeInTheDocument();
});
