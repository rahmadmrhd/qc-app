import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { resetOutboxEnv } from '@/test/outbox-env';
import { makeHandover } from '../components/test-handover';
import { enqueueCheck } from './check-outbox';
import { readOutbox, removeOutboxEntries } from './outbox';
import { beginSending, resetSendingForTests } from './outbox-status';
import { useOutboxOverlay } from './use-pending-checks';

const OWNER = 'a@x.com';
const entry = (over: Partial<Parameters<typeof enqueueCheck>[1]> = {}) => ({
  taskId: 'h1',
  locationId: 'loc-a',
  index: 0,
  text: 'A = 1',
  checked: true,
  at: Date.now(),
  ...over,
});

beforeEach(() => {
  resetOutboxEnv();
  resetSendingForTests();
});

test('tanpa entri: dto dikembalikan apa adanya dan tidak ada status butir', async () => {
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  expect(result.current.dto).toBe(dto);
  expect(result.current.itemStates.size).toBe(0);
});

test('entri antrean mencentang butir dan menandainya; berubah saat antrean berubah', async () => {
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  await act(async () => {
    await enqueueCheck(OWNER, entry());
  });
  expect(result.current.dto.checklist[0]?.checked).toBe(true);
  expect([...result.current.itemStates]).toEqual([[0, 'waiting']]);
  await act(async () => {
    await removeOutboxEntries(
      OWNER,
      readOutbox(OWNER).map((e) => e.id),
    );
  });
  expect(result.current.dto).toBe(dto);
});

test('entri dengan teks yang sudah berubah dan task lain diabaikan; owner kosong tidak membaca antrean', async () => {
  await enqueueCheck(OWNER, entry({ text: 'sudah beda' }));
  await enqueueCheck(OWNER, entry({ taskId: 'lain' }));
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  expect(result.current.dto.checklist[0]?.checked).toBe(false);
  expect(result.current.itemStates.size).toBe(0);
  const empty = renderHook(() => useOutboxOverlay(dto, ''));
  expect(empty.result.current.dto).toBe(dto);
});

test('tanpa apa pun: peta status identik antar render', async () => {
  const dto = makeHandover();
  const { result, rerender } = renderHook(() => useOutboxOverlay(dto, OWNER));
  const first = result.current.itemStates;
  rerender();
  expect(result.current.itemStates).toBe(first);
});

test('butir tanpa entri tetapi sedang dikirim langsung berstatus sending', async () => {
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  let end: () => void = () => {};
  act(() => {
    end = beginSending(dto.id, 0);
  });
  expect([...result.current.itemStates]).toEqual([[0, 'sending']]);
  act(() => end());
  expect(result.current.itemStates.size).toBe(0);
});

test('entri antrean yang sedang dikirim berstatus sending lalu waiting', async () => {
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  await act(async () => {
    await enqueueCheck(OWNER, entry());
  });
  expect([...result.current.itemStates]).toEqual([[0, 'waiting']]);
  let end: () => void = () => {};
  act(() => {
    end = beginSending(dto.id, 0);
  });
  expect([...result.current.itemStates]).toEqual([[0, 'sending']]);
  act(() => end());
  expect([...result.current.itemStates]).toEqual([[0, 'waiting']]);
});

test('entri dengan teks tidak cocok: sending pada indeksnya tidak menandai butir itu', async () => {
  await enqueueCheck(OWNER, entry({ text: 'sudah beda' }));
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  act(() => {
    beginSending(dto.id, 0);
  });
  expect(result.current.itemStates.size).toBe(0);
});

test('dua tanda kirim bertumpuk pada butir sama: tetap sending sampai keduanya selesai', async () => {
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  let end1: () => void = () => {};
  let end2: () => void = () => {};
  act(() => {
    end1 = beginSending(dto.id, 0);
    end2 = beginSending(dto.id, 0);
  });
  expect([...result.current.itemStates]).toEqual([[0, 'sending']]);
  act(() => end1());
  expect([...result.current.itemStates]).toEqual([[0, 'sending']]);
  act(() => end2());
  expect(result.current.itemStates.size).toBe(0);
});

test('entri kedaluwarsa (> 24 jam) tidak menempel dan tidak menandai butir; entri segar tetap waiting', async () => {
  await enqueueCheck(OWNER, entry({ at: Date.now() - 25 * 3600_000 }));
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  expect(result.current.dto).toBe(dto);
  expect(result.current.itemStates.size).toBe(0);
  await act(async () => {
    await enqueueCheck(OWNER, entry({ index: 1, text: 'B = 2' }));
  });
  expect(result.current.dto.checklist[0]?.checked).toBe(false);
  expect(result.current.dto.checklist[1]?.checked).toBe(true);
  expect([...result.current.itemStates]).toEqual([[1, 'waiting']]);
});
