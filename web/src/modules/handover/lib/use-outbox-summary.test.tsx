import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { enqueueCheck, readOutbox, removeEntries } from './check-outbox';
import { beginSending, resetSendingForTests } from './outbox-status';
import { useOutboxSummary } from './use-outbox-summary';

const OWNER = 'a@x.com';
const entry = (index: number, taskId = 'h1') => ({
  taskId,
  locationId: 'loc-a',
  index,
  text: `B${index}`,
  checked: true,
  at: Date.now(),
});

beforeEach(() => {
  localStorage.clear();
  resetSendingForTests();
});

test('tanpa entri: entries kosong dan sending 0', () => {
  const { result } = renderHook(() => useOutboxSummary(OWNER));
  expect(result.current.entries).toHaveLength(0);
  expect(result.current.sending).toBe(0);
});

test('dengan dua entri dan satu sedang dikirim: sending 1', () => {
  enqueueCheck(OWNER, entry(0));
  enqueueCheck(OWNER, entry(1));
  beginSending('h1', 1);
  const { result } = renderHook(() => useOutboxSummary(OWNER));
  expect(result.current.entries).toHaveLength(2);
  expect(result.current.sending).toBe(1);
});

test('butir sedang dikirim tanpa entri antrean tidak dihitung', () => {
  enqueueCheck(OWNER, entry(0));
  beginSending('h1', 5);
  const { result } = renderHook(() => useOutboxSummary(OWNER));
  expect(result.current.sending).toBe(0);
});

test('owner kosong: entries kosong', () => {
  enqueueCheck(OWNER, entry(0));
  const { result } = renderHook(() => useOutboxSummary(''));
  expect(result.current.entries).toHaveLength(0);
  expect(result.current.sending).toBe(0);
});

test('berubah saat antrean dan penanda kirim berubah', () => {
  const { result } = renderHook(() => useOutboxSummary(OWNER));
  expect(result.current.entries).toHaveLength(0);
  act(() => {
    enqueueCheck(OWNER, entry(0));
  });
  expect(result.current.entries).toHaveLength(1);
  let end: () => void = () => {};
  act(() => {
    end = beginSending('h1', 0);
  });
  expect(result.current.sending).toBe(1);
  act(() => end());
  expect(result.current.sending).toBe(0);
  act(() =>
    removeEntries(
      OWNER,
      readOutbox(OWNER).map((e) => e.id),
    ),
  );
  expect(result.current.entries).toHaveLength(0);
});
