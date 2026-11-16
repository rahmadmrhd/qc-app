import type { NotificationListDto } from '@shared/contract';
import type { NotificationDto } from '@shared/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/lib/api', () => ({ api: (id: string, input: unknown) => mocks.api(id, input) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));

import { notificationKeys } from './queries';
import { TOAST_MAX, takeFresh, useNotificationToasts } from './toast';

function make(id: string, overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id,
    kind: 'commented',
    handoverId: `h-${id}`,
    locationId: 'loc-1',
    number: `ST-${id}`,
    customerName: 'PT Maju',
    actor: 'Budi',
    count: 0,
    preview: '',
    createdAt: '2026-11-16T10:00:00.000Z',
    readAt: '',
    ...overrides,
  } as NotificationDto;
}

function list(...items: NotificationDto[]): NotificationListDto {
  return {
    items,
    unread: items.filter((item) => item.readAt === '').length,
  } as NotificationListDto;
}

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

/** Memasang hook dengan daftar awal lalu menunggu baseline terisi. */
async function mount(initial: NotificationListDto) {
  mocks.api.mockResolvedValue(initial);
  const view = renderHook(() => useNotificationToasts(), { wrapper });
  await waitFor(() => expect(client.getQueryData(notificationKeys.list)).toBeDefined());
  // Beri React kesempatan merender data pertama (efek baseline) sebelum tes mendorong daftar berikutnya.
  await flush();
  return view;
}

/** React Query meneruskan perubahan cache ke pengamat lewat `setTimeout(0)`: tunggu satu putaran. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function push(next: NotificationListDto) {
  act(() => {
    client.setQueryData(notificationKeys.list, next);
  });
  await flush();
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.navigate.mockReset();
  setVisibility('visible');
});

afterEach(() => {
  setVisibility('visible');
});

describe('takeFresh', () => {
  test('hanya yang belum dilihat DAN belum dibaca; semua id dicatat', () => {
    const seen = new Set(['a']);
    const fresh = takeFresh(
      [make('a'), make('b'), make('c', { readAt: '2026-11-16T10:01:00.000Z' })],
      seen,
    );
    expect(fresh.map((item) => item.id)).toEqual(['b']);
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
    // Panggilan kedua dengan daftar sama: tak ada lagi yang baru.
    expect(takeFresh([make('a'), make('b')], seen)).toEqual([]);
  });
});

describe('useNotificationToasts', () => {
  test('pemuatan pertama hanya mengisi baseline: tanpa toast untuk riwayat', async () => {
    await mount(list(make('1'), make('2')));
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  test('notifikasi baru belum dibaca: satu toast berjudul, ber-id notifikasi, dengan cuplikan dan aksi Buka', async () => {
    await mount(list(make('1')));
    await push(list(make('2', { preview: 'Tolong dicek ya' }), make('1')));
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    const [title, options] = mocks.toast.mock.calls[0] as [
      string,
      { id: string; description: string; action: { label: string; onClick: () => void } },
    ];
    expect(title).toBe('Budi mengomentari task ST-2');
    expect(options.id).toBe('notif-2');
    expect(options.description).toBe('Tolong dicek ya');
    expect(options.action.label).toBe('Buka');
  });

  test('aksi Buka membuka task tujuan dan menandai dibaca', async () => {
    await mount(list(make('1')));
    mocks.api.mockResolvedValue({ ok: true });
    await push(list(make('2'), make('1')));
    const options = mocks.toast.mock.calls[0]?.[1] as { action: { onClick: () => void } };
    act(() => options.action.onClick());
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/handover/$handoverId',
      params: { handoverId: 'h-2' },
      search: { loc: 'loc-1' },
    });
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith('notifications.markRead', { id: '2' }),
    );
  });

  test('notifikasi yang sudah dibaca (mis. di tab lain) tidak ditoast', async () => {
    await mount(list(make('1')));
    await push(list(make('2', { readAt: '2026-11-16T10:01:00.000Z' }), make('1')));
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  test('pemuatan ulang daftar yang sama tidak menggandakan toast', async () => {
    await mount(list(make('1')));
    await push(list(make('2'), make('1')));
    await push(list(make('2'), make('1')));
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });

  test('tab tersembunyi: tanpa toast, dan tidak muncul belakangan saat tab terlihat lagi', async () => {
    await mount(list(make('1')));
    setVisibility('hidden');
    await push(list(make('2'), make('1')));
    expect(mocks.toast).not.toHaveBeenCalled();
    setVisibility('visible');
    await push(list(make('2'), make('1')));
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  test(`lebih dari ${TOAST_MAX} sekaligus digabung menjadi satu toast ringkasan`, async () => {
    await mount(list(make('1')));
    await push(list(make('5'), make('4'), make('3'), make('2'), make('1')));
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast.mock.calls[0]?.[0]).toBe('4 notifikasi baru');
  });
});
