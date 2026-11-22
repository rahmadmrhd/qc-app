import type { NotificationListDto } from '@shared/contract';
import type { NotificationDto } from '@shared/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { savePersistedQueryCache } from '@/app/query-persist';
import { resetOverlayManager } from '@/lib/nav-stack';
import {
  ANONYMOUS_SESSION,
  clearSession,
  initSession,
  PERSISTED_CACHE_KEY,
} from '@/modules/auth/session';
import { mockMatchMedia } from '@/test/match-media';
import { NotificationBell } from './notification-bell';
import { notificationKeys } from './queries';

const apiMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateMock }));

function note(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: 'n1',
    kind: 'done',
    handoverId: 'h1',
    locationId: 'l-a',
    number: 'ST-20261112-001',
    customerName: 'PT Maju',
    actor: 'Budi',
    count: 0,
    preview: '',
    createdAt: '2026-11-12T03:00:00.000Z',
    readAt: '',
    serialId: '',
    photoId: '',
    ...overrides,
  };
}

let state: NotificationListDto;

beforeEach(() => {
  apiMock.mockReset();
  navigateMock.mockReset();
  state = { items: [note()], unread: 1, nextCursor: null };
  apiMock.mockImplementation(async (id: string, input?: { id?: string }) => {
    if (id === 'notifications.list') return state;
    if (id === 'notifications.markRead') {
      return { ok: true, _id: input?.id };
    }
    if (id === 'notifications.markAllRead') return { count: state.unread };
    throw new Error(`id tak terduga: ${id}`);
  });
});

afterEach(() => {
  clearSession();
  localStorage.clear();
});

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <NotificationBell />
    </QueryClientProvider>,
  );
  return { queryClient, ...view };
}

const trigger = () => screen.getByRole('button', { name: /^Notifikasi/ });

test('jumlah belum dibaca tampil pada ikon; tersembunyi bila 0; 99+ bila lebih', async () => {
  state = { items: [], unread: 3, nextCursor: null };
  const first = mount();
  expect(await screen.findByText('3')).toBeInTheDocument();
  expect(trigger()).toHaveAccessibleName('Notifikasi, 3 belum dibaca');
  first.unmount();

  state = { items: [], unread: 0, nextCursor: null };
  const second = mount();
  await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
  expect(trigger()).toHaveAccessibleName('Notifikasi');
  expect(screen.queryByText('0')).not.toBeInTheDocument();
  second.unmount();

  state = { items: [], unread: 150, nextCursor: null };
  mount();
  expect(await screen.findByText('99+')).toBeInTheDocument();
});

test('daftar memakai judul notifikasi dan nama customer; cuplikan sebagai teks biasa', async () => {
  state = {
    items: [
      note({ id: 'n1', kind: 'done' }),
      note({
        id: 'n2',
        kind: 'commented',
        actor: 'Sari',
        preview: '<b>tebal</b> cek lagi',
        readAt: '2026-11-12T04:00:00.000Z',
      }),
    ],
    unread: 1,
    nextCursor: null,
  };
  mount();
  await userEvent.click(await screen.findByRole('button', { name: /Notifikasi, 1 belum dibaca/ }));
  expect(await screen.findByText('Budi menyelesaikan task ST-20261112-001')).toBeInTheDocument();
  expect(screen.getByText('Sari mengomentari task ST-20261112-001')).toBeInTheDocument();
  expect(screen.getAllByText('PT Maju')).toHaveLength(2);
  // Cuplikan tidak diinterpretasikan sebagai HTML.
  expect(screen.getByText('<b>tebal</b> cek lagi')).toBeInTheDocument();
  expect(document.querySelector('b')).toBeNull();
});

test('klik butir menandainya dibaca lalu menavigasi ke detail task', async () => {
  mount();
  await userEvent.click(await screen.findByRole('button', { name: /Notifikasi, 1 belum dibaca/ }));
  await userEvent.click(await screen.findByText('Budi menyelesaikan task ST-20261112-001'));
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('notifications.markRead', { id: 'n1' }));
  // Membawa lokasi notifikasi, sehingga task terbuka walau lokasinya tak terpilih di header.
  expect(navigateMock).toHaveBeenCalledWith({
    to: '/handover/$handoverId',
    params: { handoverId: 'h1' },
    search: { loc: 'l-a' },
  });
  await waitFor(() => expect(trigger()).toHaveAccessibleName('Notifikasi'));
});

test('butir ringkasan batch (tanpa task) menavigasi ke daftar Serah Terima', async () => {
  state = {
    items: [
      note({
        id: 'n9',
        kind: 'createdBatch',
        handoverId: '',
        number: '',
        count: 30,
        customerName: 'Lokasi A',
      }),
    ],
    unread: 1,
    nextCursor: null,
  };
  mount();
  await userEvent.click(await screen.findByRole('button', { name: /Notifikasi, 1 belum dibaca/ }));
  await userEvent.click(await screen.findByText('Budi membuat 30 task baru di Lokasi A'));
  expect(navigateMock).toHaveBeenCalledWith({ to: '/handover', search: { loc: 'l-a' } });
});

test('butir Serial Number: judul, nomor SN sebagai isi, klik membuka detail Serial Number', async () => {
  state = {
    items: [
      note({
        id: 'n5',
        kind: 'serialProofFailed',
        handoverId: '',
        locationId: 'l-a',
        number: 'ABC123',
        customerName: '',
        actor: '',
        serialId: 's1',
        photoId: 'p1',
      }),
    ],
    unread: 1,
    nextCursor: null,
  };
  mount();
  await userEvent.click(await screen.findByRole('button', { name: /Notifikasi, 1 belum dibaca/ }));
  expect(await screen.findByText('Foto bukti QC bermasalah')).toBeInTheDocument();
  expect(screen.getByText('ABC123')).toBeInTheDocument();
  await userEvent.click(screen.getByText('Foto bukti QC bermasalah'));
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('notifications.markRead', { id: 'n5' }));
  expect(navigateMock).toHaveBeenCalledTimes(1);
  expect(navigateMock).toHaveBeenCalledWith({
    to: '/serial/$serialId',
    params: { serialId: 's1' },
  });
});

test('butir Serial Number tidak merender nama customer Serah Terima walau terisi', async () => {
  state = {
    items: [
      note({
        id: 'n6',
        kind: 'serialProofFailed',
        number: 'XYZ789',
        customerName: 'PT Bocor',
        serialId: 's2',
      }),
    ],
    unread: 1,
    nextCursor: null,
  };
  mount();
  await userEvent.click(await screen.findByRole('button', { name: /Notifikasi, 1 belum dibaca/ }));
  expect(await screen.findByText('XYZ789')).toBeInTheDocument();
  expect(screen.queryByText('PT Bocor')).not.toBeInTheDocument();
});

test('butir yang sudah dibaca tidak memanggil markRead lagi', async () => {
  state = { items: [note({ readAt: '2026-11-12T04:00:00.000Z' })], unread: 0, nextCursor: null };
  mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Notifikasi' }));
  await userEvent.click(await screen.findByText('Budi menyelesaikan task ST-20261112-001'));
  expect(apiMock).not.toHaveBeenCalledWith('notifications.markRead', expect.anything());
  expect(navigateMock).toHaveBeenCalled();
});

test('"Tandai semua dibaca" memanggil rute dan mengosongkan penanda', async () => {
  state = {
    items: [note({ id: 'n1' }), note({ id: 'n2', kind: 'cancelled' })],
    unread: 2,
    nextCursor: null,
  };
  mount();
  await userEvent.click(await screen.findByRole('button', { name: /Notifikasi, 2 belum dibaca/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Tandai semua dibaca' }));
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('notifications.markAllRead', {}));
  await waitFor(() => expect(trigger()).toHaveAccessibleName('Notifikasi'));
  expect(screen.getByRole('button', { name: 'Tandai semua dibaca' })).toBeDisabled();
});

test('keadaan kosong menampilkan teks Indonesia', async () => {
  state = { items: [], unread: 0, nextCursor: null };
  mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Notifikasi' }));
  expect(await screen.findByText('Belum ada notifikasi.')).toBeInTheDocument();
});

test('kunci query notifikasi TIDAK disimpan oleh query-persist', () => {
  initSession({ ...ANONYMOUS_SESSION, authenticated: true, email: 'a@x.com' });
  const client = new QueryClient();
  client.setQueryData(notificationKeys.list, {
    items: [note({ preview: 'ISI-NOTIFIKASI' })],
    unread: 1,
    nextCursor: null,
  });
  client.setQueryData(['brands', 'list'], [{ id: 'b1' }]);
  savePersistedQueryCache(client);
  const saved = localStorage.getItem(PERSISTED_CACHE_KEY) ?? '';
  expect(saved).not.toContain('ISI-NOTIFIKASI');
  expect(saved).not.toContain('notifications');
});

describe('ponsel (P9): lembar bawah, bukan popover', () => {
  let media: ReturnType<typeof mockMatchMedia>;
  beforeEach(() => {
    media = mockMatchMedia(false);
    resetOverlayManager();
    window.innerWidth = 360;
    window.history.replaceState({ __TSR_key: 'page', __TSR_index: 1 }, '', '/');
  });
  afterEach(() => {
    media.restore();
    window.innerWidth = 1024;
  });

  test('menekan lonceng membuka lembar bawah berisi daftar notifikasi', async () => {
    mount();
    await userEvent.click(
      await screen.findByRole('button', { name: /Notifikasi, 1 belum dibaca/ }),
    );
    const sheet = await screen.findByRole('dialog');
    expect(sheet.dataset.slot).toBe('sheet-content');
    expect(sheet.dataset.side).toBe('bottom');
    expect(within(sheet).getByText('Budi menyelesaikan task ST-20261112-001')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Tandai semua dibaca' })).toBeInTheDocument();
  });

  test('klik butir menutup lembar lebih dulu lalu menavigasi (runAfterOverlays)', async () => {
    mount();
    await userEvent.click(
      await screen.findByRole('button', { name: /Notifikasi, 1 belum dibaca/ }),
    );
    await userEvent.click(await screen.findByText('Budi menyelesaikan task ST-20261112-001'));
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/handover/$handoverId',
        params: { handoverId: 'h1' },
        search: { loc: 'l-a' },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
