import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { makeHandover } from '../components/test-handover';
import { enqueueCheck, readOutbox, removeEntries } from './check-outbox';
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
  localStorage.clear();
  resetSendingForTests();
});

test('tanpa entri: dto dikembalikan apa adanya dan tidak ada status butir', () => {
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  expect(result.current.dto).toBe(dto);
  expect(result.current.itemStates.size).toBe(0);
});

test('entri antrean mencentang butir dan menandainya; berubah saat antrean berubah', () => {
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  act(() => {
    enqueueCheck(OWNER, entry());
  });
  expect(result.current.dto.checklist[0]?.checked).toBe(true);
  expect([...result.current.itemStates]).toEqual([[0, 'waiting']]);
  act(() =>
    removeEntries(
      OWNER,
      readOutbox(OWNER).map((e) => e.id),
    ),
  );
  expect(result.current.dto).toBe(dto);
});

test('entri dengan teks yang sudah berubah dan task lain diabaikan; owner kosong tidak membaca antrean', () => {
  enqueueCheck(OWNER, entry({ text: 'sudah beda' }));
  enqueueCheck(OWNER, entry({ taskId: 'lain' }));
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  expect(result.current.dto.checklist[0]?.checked).toBe(false);
  expect(result.current.itemStates.size).toBe(0);
  const empty = renderHook(() => useOutboxOverlay(dto, ''));
  expect(empty.result.current.dto).toBe(dto);
});

test('tanpa apa pun: peta status identik antar render', () => {
  const dto = makeHandover();
  const { result, rerender } = renderHook(() => useOutboxOverlay(dto, OWNER));
  const first = result.current.itemStates;
  rerender();
  expect(result.current.itemStates).toBe(first);
});

test('butir tanpa entri tetapi sedang dikirim langsung berstatus sending', () => {
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

test('entri antrean yang sedang dikirim berstatus sending lalu waiting', () => {
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  act(() => {
    enqueueCheck(OWNER, entry());
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

test('entri dengan teks tidak cocok: sending pada indeksnya tidak menandai butir itu', () => {
  enqueueCheck(OWNER, entry({ text: 'sudah beda' }));
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  act(() => {
    beginSending(dto.id, 0);
  });
  expect(result.current.itemStates.size).toBe(0);
});

test('dua tanda kirim bertumpuk pada butir sama: tetap sending sampai keduanya selesai', () => {
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
