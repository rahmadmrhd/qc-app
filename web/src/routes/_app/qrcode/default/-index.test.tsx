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
// Pustaka logo sungguhan memuat berkas dan unggahan; di sini cukup kontrak `onBusyChange` yang menahan Simpan.
vi.mock('@/modules/qrcode/components/logo-library-field', () => ({
  LogoLibraryField: ({
    onBusyChange,
    onLibraryChange,
  }: {
    onBusyChange?: (busy: boolean) => void;
    onLibraryChange: (ids: string[]) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onLibraryChange(['logo-baru'])}>
        Ubah pustaka
      </button>
      <button type="button" onClick={() => onBusyChange?.(true)}>
        Unggah berjalan
      </button>
      <button type="button" onClick={() => onBusyChange?.(false)}>
        Unggah selesai
      </button>
    </div>
  ),
}));

const preset = (id: string, patch: Partial<QrPresetDto> = {}): QrPresetDto => ({
  id,
  name: `Default ${id}`,
  title: 'Judul',
  subtitle: '',
  footer: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  defaultLogoId: '',
  buId: id === 'p1' ? 'bu1' : 'bu2',
  namePlacement: 'subtitle',
  createdAt: 't',
  createdBy: 'a@x.com',
  updatedAt: '2026-11-02T00:00:00.000Z',
  updatedBy: 'a@x.com',
  ...patch,
});

const design = (id: string, presetId: string): QrDesignDto =>
  ({
    id,
    title: `Judul ${id}`,
    name: `MB ${id}`,
    presetId,
    items: [],
    hiddenItemCount: 0,
  }) as unknown as QrDesignDto;

let live: QrPresetDto[] = [];
let deletedRows: QrPresetDto[] = [];
let calls: { id: string; input: unknown }[] = [];
let media: ReturnType<typeof mockMatchMedia> | undefined;

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  calls = [];
  live = [preset('p1'), preset('p2')];
  deletedRows = [
    preset('p9', { deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } }),
  ];
  apiMock.mockImplementation(async (id: string, input: { ids?: string[]; status?: string }) => {
    calls.push({ id, input });
    switch (id) {
      case 'qrcodes.getDefaults':
        return {
          presets: input?.status === 'deleted' ? deletedRows : live,
          logoFileIds: [],
          logoUpdatedAt: 'v1',
        };
      case 'businessUnits.options':
        return [
          { id: 'bu1', code: 'SPC', name: 'Spectrum', status: 'active' },
          { id: 'bu2', code: 'NXT', name: 'Nexus', status: 'active' },
          { id: 'bu3', code: 'OLD', name: 'Lama', status: 'active' },
        ];
      case 'qrcodes.list':
        return [design('q1', 'p1'), design('q2', 'p1'), design('q3', 'p2')];
      case 'qrcodes.removePresetBatch':
        return { ids: input.ids };
      case 'qrcodes.restorePresetBatch':
        return { items: (input.ids ?? []).map((presetId) => preset(presetId)) };
      case 'qrcodes.clonePreset':
        return preset('p3', { buId: 'bu3', name: 'Salinan' });
      case 'qrcodes.saveLogoLibrary':
        return { logoFileIds: ['logo-baru'], logoUpdatedAt: 'v2' };
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

async function mount({ path = '/_app/qrcode/default/' }: { path?: string } = {}) {
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(meQueryKey, makeMe({ permissions: { qrcode: 'manage', access: 'view' } }));
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: '/_app/qrcode/default/',
    validateSearch: Route.options.validateSearch,
    component: Component as never,
  });
  const created = createRoute({
    getParentRoute: () => root,
    path: '/qrcode/default/new',
    component: () => <p>Form baru</p>,
  });
  const editing = createRoute({
    getParentRoute: () => root,
    path: '/qrcode/default/$presetId/edit',
    component: () => <p>Form ubah</p>,
  });
  // Tipe pohon rute dilonggarkan: beberapa rute berliteral jalur membuat tsc sangat lambat bila diketik penuh.
  const router: AnyRouter = createRouter({
    routeTree: root.addChildren([route, created, editing] as never),
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
  await screen.findByRole('heading', { level: 1, name: 'Konfigurasi default QR' });
  return { router };
}

test('daftar tampil di kit: tabel, nama menaut ke View, BU menaut ke halaman BU', async () => {
  await mount();
  await screen.findByRole('table', { name: 'Daftar konfigurasi default QR' });
  expect(screen.getByText('2 konfigurasi default')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Default p1' })).toHaveAttribute(
    'href',
    '/qrcode/default/p1',
  );
  expect(screen.getByRole('link', { name: 'SPC - Spectrum' })).toHaveAttribute(
    'href',
    '/access/business-units/bu1',
  );
});

test('Tambah default dan Ubah membuka halaman form dengan push', async () => {
  const { router } = await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah default' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/qrcode/default/new'));
  router.history.back();
  await waitFor(() => expect(router.state.location.pathname).toBe('/_app/qrcode/default/'));
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Default p2' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/qrcode/default/p2/edit'));
});

test('Kloning membuka dialog; BU yang sudah punya preset tidak ditawarkan; kirim qrcodes.clonePreset', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Kloning Default p1' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Business Unit tujuan' }));
  const options = await screen.findAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual([expect.stringContaining('Lama')]);
  await userEvent.click(options[0] as HTMLElement);
  await userEvent.click(within(dialog).getByRole('button', { name: /^Kloning/ }));
  await waitFor(() => expect(callsOf('qrcodes.clonePreset')).toHaveLength(1));
  expect(callsOf('qrcodes.clonePreset')[0]?.input).toMatchObject({ id: 'p1', buId: 'bu3' });
});

test('Hapus massal: konfirmasi menyebut pemakai, qrcodes.removePresetBatch, toast dengan Pulihkan', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  await userEvent.click(within(bar).getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('Hapus 2 konfigurasi default?');
  await waitFor(() => expect(dialog).toHaveTextContent('Dipakai oleh 3 konfigurasi QR'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('qrcodes.removePresetBatch')).toHaveLength(1));
  expect(callsOf('qrcodes.removePresetBatch')[0]?.input).toEqual({ ids: ['p1', 'p2'] });
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      '2 konfigurasi default dihapus',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
    ),
  );
});

test('tampilan Terhapus: bar massal hanya Pulihkan (qrcodes.restorePresetBatch), tanpa pustaka logo', async () => {
  await mount({ path: '/_app/qrcode/default/?status=deleted' });
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih Default p9' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).queryByRole('button', { name: 'Hapus' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Pulihkan' }));
  await waitFor(() => expect(callsOf('qrcodes.restorePresetBatch')).toHaveLength(1));
  expect(callsOf('qrcodes.restorePresetBatch')[0]?.input).toEqual({ ids: ['p9'] });
  expect(screen.queryByRole('heading', { name: 'Pustaka logo' })).toBeNull();
});

test('pustaka logo: unggahan berjalan menahan Simpan pustaka sampai selesai', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah pustaka' }));
  const save = screen.getByRole('button', { name: 'Simpan pustaka logo' });
  expect(save).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Unggah berjalan' }));
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Unggah selesai' }));
  expect(save).toBeEnabled();
  await userEvent.click(save);
  await waitFor(() => expect(callsOf('qrcodes.saveLogoLibrary')).toHaveLength(1));
  expect(callsOf('qrcodes.saveLogoLibrary')[0]?.input).toEqual({
    expectedUpdatedAt: 'v1',
    logoFileIds: ['logo-baru'],
  });
});

test('mengubah filter mengosongkan pilihan; pencarian memakai replace', async () => {
  const { router } = await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  expect(screen.getByText('2 dipilih')).toBeInTheDocument();
  const before = router.history.length;
  await userEvent.type(screen.getByRole('searchbox', { name: 'Cari konfigurasi default' }), 'p1');
  await waitFor(() => expect(screen.queryByText(/^\d+ dipilih$/)).toBeNull());
  await waitFor(() => expect(router.state.location.search).toEqual({ q: 'p1' }));
  expect(router.history.length).toBe(before);
});

test('ponsel (360 px): kartu, Tambah default tetap terjangkau, pustaka logo tetap ada', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  await mount();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('link', { name: 'Default p1' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Tambah default/ }).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Simpan pustaka logo' })).toBeInTheDocument();
});
