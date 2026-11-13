import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { makeHandover } from '../components/test-handover';
import { enqueueCheck, readOutbox, removeEntries } from './check-outbox';
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

beforeEach(() => localStorage.clear());

test('tanpa entri: dto dikembalikan apa adanya dan tidak ada indeks tertunda', () => {
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  expect(result.current.dto).toBe(dto);
  expect(result.current.pendingIndexes.size).toBe(0);
});

test('entri antrean mencentang butir dan menandainya; berubah saat antrean berubah', () => {
  const dto = makeHandover();
  const { result } = renderHook(() => useOutboxOverlay(dto, OWNER));
  act(() => {
    enqueueCheck(OWNER, entry());
  });
  expect(result.current.dto.checklist[0]?.checked).toBe(true);
  expect([...result.current.pendingIndexes]).toEqual([0]);
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
  expect(result.current.pendingIndexes.size).toBe(0);
  const empty = renderHook(() => useOutboxOverlay(dto, ''));
  expect(empty.result.current.dto).toBe(dto);
});
