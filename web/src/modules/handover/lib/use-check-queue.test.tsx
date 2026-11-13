import type { HandoverDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  requestFlush: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => mocks.api(...args) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.error, info: mocks.info } }));
vi.mock('@/app/outbox-sync', () => ({ requestOutboxFlush: () => mocks.requestFlush() }));

import { isBusy, resetBusyForTests } from '@/app/pwa/busy';
import { ApiError } from '@/lib/api/api-error';
import { makeHandover } from '../components/test-handover';
import { handoverKeys } from '../queries';
import { boardColumnData, findHandoverInBoards } from './board-cache';
import { enqueueCheck, OUTBOX_MAX_ENTRIES, readOutbox } from './check-outbox';
import { useCheckQueue } from './use-check-queue';

const items = (n: number) =>
  Array.from({ length: n }, (_, index) => ({
    index,
    text: `B${index} = 1`,
    checked: false,
    by: '',
    at: '',
  }));
const task = makeHandover({ id: 't1', locationId: 'loc-a', checklist: items(5) });
/** Memasang keempat kolom papan lokasi A: semua task di 'new', kolom lain kosong (tujuan pindah kolom). */
function seedBoard(client: QueryClient, tasks: HandoverDto[]) {
  client.setQueryData(handoverKeys.column(['loc-a'], 'new'), boardColumnData(tasks));
  for (const status of ['in_progress', 'done', 'cancelled'] as const) {
    client.setQueryData(handoverKeys.column(['loc-a'], status), boardColumnData([]));
  }
}

function serverAfter(checkedIdx: number[]): HandoverDto {
  const checklist = items(5).map((item) =>
    checkedIdx.includes(item.index) ? { ...item, checked: true, by: 'qc@x', at: 'now' } : item,
  );
  return makeHandover({
    id: 't1',
    locationId: 'loc-a',
    checklist,
    status: checkedIdx.length === 5 ? 'done' : checkedIdx.length > 0 ? 'in_progress' : 'new',
  });
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedBoard(client, [task]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useCheckQueue('qc@x'), { wrapper });
  const cached = () => findHandoverInBoards(client, 't1') as HandoverDto;
  const ref = { id: 't1', locationId: 'loc-a' };
  return { client, hook, cached, ref };
}

/** Panggilan yang diselesaikan manual, urutan terbang dicatat. */
function manualCall() {
  const calls: Array<{
    input: { index: number; checked: boolean };
    resolve: (value: HandoverDto) => void;
    reject: (error: Error) => void;
  }> = [];
  mocks.api.mockImplementation(
    (_method: string, input: { index: number; checked: boolean }) =>
      new Promise<HandoverDto>((resolve, reject) => {
        calls.push({ input, resolve, reject });
      }),
  );
  return calls;
}

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => {
  localStorage.clear();
  resetBusyForTests();
  mocks.api.mockReset();
  mocks.error.mockReset();
  mocks.info.mockReset();
  mocks.requestFlush.mockReset();
});

test('5 klik beruntun: tampilan langsung 5 tercentang, 5 permintaan berurutan (satu terbang), hasil akhir = server', async () => {
  const { hook, cached, ref } = setup();
  const calls = manualCall();
  act(() => {
    for (let i = 0; i < 5; i++)
      hook.result.current.toggle(ref, { index: i, text: `B${i} = 1` }, true);
  });
  // tampilan instan, sebelum permintaan apa pun selesai
  expect(cached().checklist.every((item) => item.checked)).toBe(true);
  expect(cached().status).toBe('new');
  expect(hook.result.current.isSaving('t1')).toBe(true);
  await flush();
  expect(calls).toHaveLength(1);
  for (let i = 0; i < 5; i++) {
    expect(calls).toHaveLength(i + 1);
    expect(calls[i]?.input.index).toBe(i);
    await act(async () => {
      calls[i]?.resolve(serverAfter(Array.from({ length: i + 1 }, (_, k) => k)));
    });
    await flush();
  }
  expect(mocks.api).toHaveBeenCalledTimes(5);
  expect(cached()).toEqual(serverAfter([0, 1, 2, 3, 4]));
  expect(hook.result.current.isSaving('t1')).toBe(false);
});

test('respons lambat tidak membalik tampilan: cache baru ditimpa setelah antrean kosong', async () => {
  const { hook, cached, ref } = setup();
  const calls = manualCall();
  act(() => {
    hook.result.current.toggle(ref, { index: 0, text: 'B0 = 1' }, true);
    hook.result.current.toggle(ref, { index: 1, text: 'B1 = 1' }, true);
  });
  await flush();
  // respons pertama hanya memuat butir 0; butir 1 masih terbang: tampilan harus tetap 0 dan 1 tercentang
  await act(async () => {
    calls[0]?.resolve(serverAfter([0]));
  });
  await flush();
  expect(cached().checklist[0]?.checked).toBe(true);
  expect(cached().checklist[1]?.checked).toBe(true);
  await act(async () => {
    calls[1]?.resolve(serverAfter([0, 1]));
  });
  await flush();
  expect(cached()).toEqual(serverAfter([0, 1]));
});

test('kegagalan butir ke-3: butir itu kembali, lainnya tetap, antrean lanjut, toast galat, task dimuat ulang', async () => {
  const { client, hook, cached, ref } = setup();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const calls = manualCall();
  act(() => {
    for (let i = 0; i < 5; i++)
      hook.result.current.toggle(ref, { index: i, text: `B${i} = 1` }, true);
  });
  await flush();
  for (let i = 0; i < 5; i++) {
    expect(calls).toHaveLength(i + 1);
    await act(async () => {
      if (i === 2) calls[i]?.reject(new Error('Gagal menyimpan'));
      else calls[i]?.resolve(serverAfter([0, 1, 3, 4].filter((k) => k <= i)));
    });
    await flush();
    if (i === 2) {
      // hanya butir ke-3 yang kembali; butir 0,1,3,4 tetap tercentang
      expect(cached().checklist.map((item) => item.checked)).toEqual([
        true,
        true,
        false,
        true,
        true,
      ]);
    }
  }
  expect(mocks.api).toHaveBeenCalledTimes(5);
  expect(mocks.error).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: handoverKeys.all });
});

test('task berbeda diproses paralel; whenIdle menunggu antrean task itu kosong', async () => {
  const { client, hook, ref } = setup();
  seedBoard(client, [task, makeHandover({ id: 't2', locationId: 'loc-a', checklist: items(2) })]);
  const calls = manualCall();
  act(() => {
    hook.result.current.toggle(ref, { index: 0, text: 'B0 = 1' }, true);
    hook.result.current.toggle(
      { id: 't2', locationId: 'loc-a' },
      { index: 0, text: 'B0 = 1' },
      true,
    );
  });
  await flush();
  expect(calls).toHaveLength(2);
  let idle = false;
  const waiting = hook.result.current.whenIdle('t1').then(() => {
    idle = true;
  });
  await flush();
  expect(idle).toBe(false);
  await act(async () => {
    calls[0]?.resolve(serverAfter([0]));
  });
  await waiting;
  expect(idle).toBe(true);
});

test('antrean centang yang belum kosong menandai registri sibuk (agar muat ulang otomatis tidak memotong penyimpanan)', async () => {
  const { hook, ref } = setup();
  const calls = manualCall();
  expect(isBusy()).toBe(false);
  act(() => {
    hook.result.current.toggle(ref, { index: 0, text: 'B0 = 1' }, true);
    hook.result.current.toggle(ref, { index: 1, text: 'B1 = 1' }, true);
  });
  expect(isBusy()).toBe(true);
  await flush();
  await act(async () => {
    calls[0]?.resolve(serverAfter([0]));
  });
  await flush();
  // Permintaan kedua masih antre/terbang: tetap sibuk.
  expect(isBusy()).toBe(true);
  await act(async () => {
    calls[1]?.resolve(serverAfter([0, 1]));
  });
  await flush();
  expect(isBusy()).toBe(false);
});

const unavailable = () => new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-');

test('UNAVAILABLE: centang diantrekan di perangkat, tampilan dipertahankan, tanpa galat dan tanpa muat ulang', async () => {
  const { client, hook, cached, ref } = setup();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  mocks.api.mockRejectedValue(unavailable());
  act(() => hook.result.current.toggle(ref, { index: 1, text: 'B1 = 1' }, true));
  await flush();
  const queued = readOutbox('qc@x');
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({
    taskId: 't1',
    locationId: 'loc-a',
    index: 1,
    text: 'B1 = 1',
    checked: true,
  });
  expect(cached().checklist[1]?.checked).toBe(true);
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: handoverKeys.all });
  expect(mocks.error).not.toHaveBeenCalled();
  expect(mocks.info).toHaveBeenCalledTimes(1);
  expect(hook.result.current.isSaving('t1')).toBe(false);
});

test('penyimpanan antrean penuh: butir dikembalikan dan galat biasa tampil', async () => {
  const { client, hook, cached, ref } = setup();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  for (let i = 0; i < OUTBOX_MAX_ENTRIES; i++) {
    enqueueCheck('qc@x', {
      taskId: `lain${i}`,
      locationId: 'loc-a',
      index: 0,
      text: 'x',
      checked: true,
      at: Date.now(),
    });
  }
  mocks.api.mockRejectedValue(unavailable());
  act(() => hook.result.current.toggle(ref, { index: 1, text: 'B1 = 1' }, true));
  await flush();
  expect(cached().checklist[1]?.checked).toBe(false);
  expect(mocks.error).toHaveBeenCalledTimes(1);
  expect(readOutbox('qc@x')).toHaveLength(OUTBOX_MAX_ENTRIES);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: handoverKeys.all });
});

test('galat selain UNAVAILABLE (CONFLICT) tidak diantrekan: perilaku lama', async () => {
  const { hook, cached, ref } = setup();
  mocks.api.mockRejectedValue(new ApiError('CONFLICT', 'Catatan berubah', '-'));
  act(() => hook.result.current.toggle(ref, { index: 1, text: 'B1 = 1' }, true));
  await flush();
  expect(readOutbox('qc@x')).toEqual([]);
  expect(cached().checklist[1]?.checked).toBe(false);
  expect(mocks.error).toHaveBeenCalledTimes(1);
  expect(mocks.info).not.toHaveBeenCalled();
});

test('butir yang sama diklik dua kali saat offline: satu entri bernilai terakhir', async () => {
  const { hook, ref } = setup();
  mocks.api.mockRejectedValue(unavailable());
  act(() => {
    hook.result.current.toggle(ref, { index: 1, text: 'B1 = 1' }, true);
    hook.result.current.toggle(ref, { index: 1, text: 'B1 = 1' }, false);
  });
  await flush();
  const queued = readOutbox('qc@x');
  expect(queued).toHaveLength(1);
  expect(queued[0]?.checked).toBe(false);
  // Klik kedua melihat entri antrean milik task ini dan langsung masuk antrean (tanpa permintaan kedua).
  expect(mocks.api).toHaveBeenCalledTimes(1);
});

test('task masih punya entri antrean: klik baru masuk antrean, tidak dikirim langsung, lalu meminta pengurasan', async () => {
  const { hook, ref } = setup();
  enqueueCheck('qc@x', {
    taskId: 't1',
    locationId: 'loc-a',
    index: 3,
    text: 'B3 = 1',
    checked: true,
    at: Date.now(),
  });
  act(() => hook.result.current.toggle(ref, { index: 0, text: 'B0 = 1' }, true));
  await flush();
  expect(mocks.api).not.toHaveBeenCalled();
  expect(readOutbox('qc@x').map((entry) => entry.index)).toEqual([3, 0]);
  expect(mocks.requestFlush).toHaveBeenCalledTimes(1);
  expect(mocks.error).not.toHaveBeenCalled();
});
