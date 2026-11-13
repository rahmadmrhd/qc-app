import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const navigate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate }) }));

import { isBusy, resetBusyForTests } from '@/app/pwa/busy';
import * as deviceDb from '@/lib/device-db';
import {
  enqueueCheck,
  outboxWritesSuspended,
  resumeOutboxWrites,
} from '@/modules/handover/lib/check-outbox';
import {
  beginSending,
  isItemSending,
  resetSendingForTests,
} from '@/modules/handover/lib/outbox-status';
import { draftWritesSuspended, resumeDraftWrites } from '@/modules/serial/lib/draft-store';
import { clearSession, PERSISTED_CACHE_KEY } from './session';
import { postLogout, useLogout } from './use-logout';

// Pembungkus tipis atas modul nyata agar penghapusan toko perangkat dapat dibuat gagal.
vi.mock('@/lib/device-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/device-db')>();
  return { ...actual, clearDeviceDb: vi.fn(actual.clearDeviceDb) };
});

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const cachesStub = { delete: vi.fn(), keys: vi.fn(), open: vi.fn(), match: vi.fn(), has: vi.fn() };

beforeEach(() => {
  resetSendingForTests();
  resetBusyForTests();
  vi.clearAllMocks();
  localStorage.clear();
  client = new QueryClient();
  // Build produksi (bukan DEV) memanggil POST /auth/logout; jaringan gagal.
  vi.stubEnv('DEV', false);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  vi.stubGlobal('caches', cachesStub);
});
afterEach(() => {
  deviceDb.resetDeviceDbForTests();
  (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
  resumeDraftWrites();
  resumeOutboxWrites();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test('postLogout menelan galat jaringan', async () => {
  await expect(
    postLogout(vi.fn().mockRejectedValue(new Error('offline'))),
  ).resolves.toBeUndefined();
});

test('keluar saat jaringan gagal: cache query tersimpan dibuang, queryClient kosong, ke /login', async () => {
  localStorage.setItem(PERSISTED_CACHE_KEY, '{"owner":"a@x.com"}');
  client.setQueryData(['items'], [{ id: 'i1' }]);
  const { result } = renderHook(() => useLogout(), { wrapper });

  result.current();

  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }));
  expect(localStorage.getItem(PERSISTED_CACHE_KEY)).toBeNull();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(client.getQueryData(['items'])).toBeUndefined();
});

test('keluar tidak menyentuh Cache Storage (cache cangkang boleh tetap, FR-P14)', async () => {
  const { result } = renderHook(() => useLogout(), { wrapper });
  result.current();
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(cachesStub.delete).not.toHaveBeenCalled();
  expect(cachesStub.keys).not.toHaveBeenCalled();
  expect(cachesStub.open).not.toHaveBeenCalled();
});

test('M-f: POST /auth/logout dan pembersihan menandai registri sibuk sampai selesai (muat ulang otomatis tak boleh memotongnya)', async () => {
  let release: () => void = () => undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response(null, { status: 204 }));
        }),
    ),
  );
  const { result } = renderHook(() => useLogout(), { wrapper });
  result.current();
  expect(isBusy()).toBe(true);
  // A5: tetap sibuk selama POST menggantung, bukan hanya sinkron setelah pemanggilan.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(isBusy()).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
  release();
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }));
  await waitFor(() => expect(isBusy()).toBe(false));
});

test('keluar membuang draf tabel sementara Serial Number semua pemilik', async () => {
  localStorage.setItem('qc.serial.draft:a@x.com', '[]');
  localStorage.setItem('qc.serial.draft:b@x.com', '[]');
  localStorage.setItem('tema', 'gelap');
  const { result } = renderHook(() => useLogout(), { wrapper });
  act(() => result.current());
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }));
  expect(localStorage.getItem('qc.serial.draft:a@x.com')).toBeNull();
  expect(localStorage.getItem('qc.serial.draft:b@x.com')).toBeNull();
  expect(localStorage.getItem('tema')).toBe('gelap');
});

test('draf dibuang dan penulisan ditahan SEBELUM navigasi ke /login (halaman Catat yang dilepas tak menulis ulang)', async () => {
  localStorage.setItem('qc.serial.draft:a@x.com', '[]');
  let suspendedAtNavigate: boolean | null = null;
  let draftAtNavigate: string | null = 'belum';
  navigate.mockImplementationOnce(() => {
    suspendedAtNavigate = draftWritesSuspended();
    draftAtNavigate = localStorage.getItem('qc.serial.draft:a@x.com');
    return Promise.resolve();
  });
  const { result } = renderHook(() => useLogout(), { wrapper });
  act(() => result.current());
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(suspendedAtNavigate).toBe(true);
  expect(draftAtNavigate).toBeNull();
});

test('keluar membuang antrean centang semua pemilik, kunci lain tetap (FR-P14, FR-P19)', async () => {
  localStorage.setItem('qc.outbox:a@x.com', '{}');
  localStorage.setItem('qc.outbox:b@x.com', '{}');
  localStorage.setItem('tema', 'gelap');
  const { result } = renderHook(() => useLogout(), { wrapper });
  act(() => result.current());
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }));
  expect(localStorage.getItem('qc.outbox:a@x.com')).toBeNull();
  expect(localStorage.getItem('qc.outbox:b@x.com')).toBeNull();
  expect(localStorage.getItem('tema')).toBe('gelap');
});

test('keluar membersihkan penanda "mengirim" walau permintaan masih terbang', async () => {
  const end = beginSending('h1', 0);
  expect(isItemSending('h1', 0)).toBe(true);
  const { result } = renderHook(() => useLogout(), { wrapper });
  act(() => result.current());
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }));
  expect(isItemSending('h1', 0)).toBe(false);
  // Permintaan lama yang selesai belakangan tidak boleh mengganggu tanda sesi baru.
  const next = beginSending('h1', 0);
  end();
  expect(isItemSending('h1', 0)).toBe(true);
  next();
});

test('sesi kedaluwarsa (clearSession saja) TIDAK membuang antrean centang', () => {
  localStorage.setItem('qc.outbox:a@x.com', '{}');
  clearSession();
  expect(localStorage.getItem('qc.outbox:a@x.com')).toBe('{}');
});

test('A1: keluar menahan penulisan antrean centang SEBELUM navigasi; penulisan setelahnya tak menghidupkan antrean lagi', async () => {
  let suspendedAtNavigate: boolean | null = null;
  navigate.mockImplementationOnce(() => {
    suspendedAtNavigate = outboxWritesSuspended();
    return Promise.resolve();
  });
  const { result } = renderHook(() => useLogout(), { wrapper });
  act(() => result.current());
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(suspendedAtNavigate).toBe(true);
  // Permintaan centang yang terbang saat keluar lalu gagal UNAVAILABLE mencoba mengantre: ditolak.
  expect(
    enqueueCheck('a@x.com', {
      taskId: 't',
      locationId: 'l',
      index: 0,
      text: 'x',
      checked: true,
      at: Date.now(),
    }),
  ).toBe(false);
  expect(localStorage.getItem('qc.outbox:a@x.com')).toBeNull();
});

test('M6: penulisan antrean sudah ditahan SEBELUM POST /auth/logout selesai (klik gagal UNAVAILABLE saat POST menggantung tak menulis antrean)', async () => {
  let release: () => void = () => undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response(null, { status: 204 }));
        }),
    ),
  );
  const { result } = renderHook(() => useLogout(), { wrapper });
  act(() => result.current());
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(navigate).not.toHaveBeenCalled(); // POST masih menggantung
  expect(outboxWritesSuspended()).toBe(true);
  expect(
    enqueueCheck('a@x.com', {
      taskId: 't',
      locationId: 'l',
      index: 0,
      text: 'x',
      checked: true,
      at: Date.now(),
    }),
  ).toBe(false);
  expect(Object.keys(localStorage).filter((key) => key.startsWith('qc.outbox:'))).toEqual([]);
  release();
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }));
});

function seedDeviceStore() {
  deviceDb.resetDeviceDbForTests();
  globalThis.indexedDB = new IDBFactory();
  const base = { owner: 'a@x.com', v: 1, savedAt: 1 };
  return Promise.all([
    deviceDb.writeRecords('columns', [{ ...base, key: 'a@x.com|l1|new', data: {} }], 40),
    deviceDb.writeRecords(
      'tasks',
      [{ ...base, key: 'a@x.com|h1', locationIds: ['l1'], dto: {} }],
      100,
    ),
  ]);
}

test('keluar mengosongkan papan dan detail task di IndexedDB sebelum navigasi ke /login', async () => {
  await seedDeviceStore();
  expect(await deviceDb.readAllRecords('columns')).toHaveLength(1);
  let columnsAtNavigate = -1;
  let tasksAtNavigate = -1;
  navigate.mockImplementationOnce(async () => {
    columnsAtNavigate = (await deviceDb.readAllRecords('columns')).length;
    tasksAtNavigate = (await deviceDb.readAllRecords('tasks')).length;
  });
  const { result } = renderHook(() => useLogout(), { wrapper });
  act(() => result.current());
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }));
  await waitFor(() => expect(columnsAtNavigate).toBe(0));
  expect(tasksAtNavigate).toBe(0);
});

test('pembersihan toko perangkat yang gagal tidak mencegah keluar menyelesaikan sesi dan navigasi', async () => {
  vi.mocked(deviceDb.clearDeviceDb).mockRejectedValueOnce(new Error('idb gagal'));
  const { result } = renderHook(() => useLogout(), { wrapper });
  act(() => result.current());
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }));
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  await waitFor(() => expect(isBusy()).toBe(false));
});

test('pembersihan toko perangkat yang menggantung: keluar tetap selesai dalam batas waktu (sesi, cache, navigasi)', async () => {
  vi.mocked(deviceDb.clearDeviceDb).mockImplementationOnce(
    () => new Promise<void>(() => undefined),
  );
  client.setQueryData(['items'], [{ id: 'i1' }]);
  const { result } = renderHook(() => useLogout(), { wrapper });
  act(() => result.current());
  // Batas waktu pembersihan toko (BOARD_CLEAR_TIMEOUT_MS) lebih pendek dari batas tunggu ini.
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }), { timeout: 5000 });
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  await waitFor(() => expect(isBusy()).toBe(false));
});
