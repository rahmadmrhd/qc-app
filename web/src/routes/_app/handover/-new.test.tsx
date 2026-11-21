import type { HandoverOptionsDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentType, Suspense } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

// Rute dipasang tanpa router sungguhan; formulir diganti kerangka yang memicu onSubmit/onSaved seperti form asli.
const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  api: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  optionsSeen: undefined as unknown,
}));
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<object>('@tanstack/react-router')),
  createFileRoute: () => (options: { component: () => unknown }) => ({ options }),
  useNavigate: () => state.navigate,
  useRouter: () => ({ navigate: state.navigate }),
}));
vi.mock('@/modules/auth/permissions', async () => ({
  requirePermission: vi.fn(),
  locationsWith: () => [{ id: 'loc-a', name: 'Lokasi A' }],
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => ({ email: 'wh@x.id' }) }));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ selectedIds: ['loc-a'] }),
}));
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => state.api(...args) }));
vi.mock('sonner', () => ({
  toast: { success: state.toastSuccess, info: state.toastInfo, error: vi.fn() },
}));
vi.mock('@/modules/handover/components/handover-batch-form', () => ({
  HandoverBatchForm: (props: {
    options: HandoverOptionsDto;
    onSubmit: (values: unknown) => Promise<unknown>;
    onSaved?: (count: number) => void;
  }) => {
    state.optionsSeen = props.options;
    return (
      <button
        type="button"
        onClick={async () => {
          await props.onSubmit({
            locationId: 'loc-a',
            tasks: [{ customerName: 'PT Offline', note: 'catatan' }],
          });
          props.onSaved?.(1);
        }}
      >
        simpan
      </button>
    );
  },
}));

import { ApiError } from '@/lib/api/api-error';
import { readOutbox } from '@/modules/handover/lib/outbox';
import { resetOutboxEnv } from '@/test/outbox-env';
import { Route } from './new';

const Component = (
  Route as unknown as { options: { component: ComponentType & { preload?: () => Promise<void> } } }
).options.component;

async function mount() {
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>memuat</p>}>
        <Component />
      </Suspense>
    </QueryClientProvider>,
  );
}

const unavailable = () => new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-');

beforeEach(() => {
  resetOutboxEnv();
  state.navigate.mockReset();
  state.api.mockReset();
  state.toastInfo.mockReset();
  state.toastSuccess.mockReset();
  state.optionsSeen = undefined;
});

test('offline: opsi gagal UNAVAILABLE, formulir tetap tampil dengan saran customer kosong', async () => {
  state.api.mockRejectedValue(unavailable());
  await mount();
  expect(await screen.findByRole('button', { name: 'simpan' })).toBeInTheDocument();
  expect(state.optionsSeen).toEqual({ customers: [], inactiveCustomerNames: [] });
  expect(screen.queryByText('Gagal memuat daftar customer.')).not.toBeInTheDocument();
});

test('galat opsi selain UNAVAILABLE tetap menampilkan pesan gagal memuat customer', async () => {
  state.api.mockRejectedValue(new ApiError('FORBIDDEN', 'Ditolak', '-'));
  await mount();
  expect(await screen.findByText('Gagal memuat daftar customer.')).toBeInTheDocument();
});

test('offline: simpan mengantre task (clientId), toast info, kembali ke daftar', async () => {
  state.api.mockImplementation(async (method: string) => {
    if (method === 'handovers.options') throw unavailable();
    throw unavailable();
  });
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'simpan' }));
  await waitFor(() =>
    expect(state.navigate).toHaveBeenCalledWith({ to: '/handover', replace: true }),
  );
  const [entry] = readOutbox('wh@x.id');
  expect(entry).toMatchObject({ kind: 'create', locationId: 'loc-a' });
  expect(entry && entry.kind === 'create' ? entry.tasks[0] : null).toMatchObject({
    customerName: 'PT Offline',
    note: 'catatan',
    clientId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
  expect(state.toastInfo).toHaveBeenCalledTimes(1);
  expect(state.toastSuccess).not.toHaveBeenCalled();
});

test('online: simpan sukses memakai toast sukses, tanpa antrean', async () => {
  state.api.mockImplementation(async (method: string) =>
    method === 'handovers.options' ? { customers: [], inactiveCustomerNames: [] } : [],
  );
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'simpan' }));
  await waitFor(() =>
    expect(state.navigate).toHaveBeenCalledWith({ to: '/handover', replace: true }),
  );
  expect(state.toastSuccess).toHaveBeenCalledWith('Task disimpan');
  expect(state.toastInfo).not.toHaveBeenCalled();
  expect(readOutbox('wh@x.id')).toEqual([]);
});
