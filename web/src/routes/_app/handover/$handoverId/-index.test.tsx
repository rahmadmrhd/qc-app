import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { type ComponentType, Suspense } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { makeHandover } from '@/modules/handover/components/test-handover';

const state = vi.hoisted(() => ({
  me: null as unknown as MeDto,
  selected: ['loc-a'] as string[],
  api: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => state.me }));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ selectedIds: state.selected }),
}));
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: (...args: unknown[]) => state.api(...args),
}));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<object>('@tanstack/react-router')),
  useNavigate: () => state.navigate,
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

import { Route } from './index';

const none = { handover: 'none', qc: 'none', stock: 'none', stickerstock: 'none' } as const;
function me(): MeDto {
  return {
    email: 'u@qc.local',
    name: 'U',
    isSuperAdmin: false,
    permissions: {
      access: 'none',
      item: 'none',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
      serial: 'none',
      serialservice: 'none',
    },
    businessUnits: [],
    locations: [
      { id: 'loc-a', code: 'A', name: 'Lokasi A', permissions: { ...none, handover: 'view' } },
      { id: 'loc-b', code: 'B', name: 'Lokasi B', permissions: { ...none, handover: 'view' } },
      // Hanya stok: lokasi ada di `me`, tetapi task tidak boleh dibaca.
      { id: 'loc-s', code: 'S', name: 'Lokasi S', permissions: { ...none, stock: 'view' } },
    ],
  } as MeDto;
}

async function mount(search: { loc?: string }) {
  vi.spyOn(Route, 'useParams').mockReturnValue({ handoverId: 'h1' } as never);
  vi.spyOn(Route, 'useSearch').mockReturnValue(search as never);
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>memuat</p>}>
        <Component />
      </Suspense>
    </QueryClientProvider>,
  );
}

const getCalls = () => state.api.mock.calls.filter(([id]) => id === 'handovers.get');

beforeEach(() => {
  state.api.mockReset();
  state.navigate.mockReset();
  state.selected = ['loc-a'];
  state.me = me();
  state.api.mockImplementation(async (id: string, input: { locationIds: string[] }) => {
    if (id !== 'handovers.get') throw new Error(`tak terduga: ${id}`);
    return makeHandover({ id: 'h1', number: 'ST-B', locationId: input.locationIds[0] });
  });
});

test('tanpa loc: memuat dari lokasi yang terpilih di header', async () => {
  await mount({});
  await screen.findByText('ST-B');
  expect(state.api).toHaveBeenCalledWith('handovers.get', { id: 'h1', locationIds: ['loc-a'] });
});

test('loc dari notifikasi: memuat task dari lokasi itu walau tak terpilih di header', async () => {
  await mount({ loc: 'loc-b' });
  await screen.findByText('ST-B');
  expect(state.api).toHaveBeenCalledWith('handovers.get', { id: 'h1', locationIds: ['loc-b'] });
  expect(getCalls()).toHaveLength(1);
});

test('loc tanpa hak baca task (atau tak dikenal): tidak meminta ke server, tampil "tidak ditemukan"', async () => {
  await mount({ loc: 'loc-s' });
  expect(await screen.findByRole('alert')).toHaveTextContent('Task tidak ditemukan');
  await waitFor(() => expect(getCalls()).toHaveLength(0));
  state.api.mockClear();
  await mount({ loc: 'loc-tak-dikenal' });
  await waitFor(() =>
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Task tidak ditemukan'),
  );
  expect(getCalls()).toHaveLength(0);
});
