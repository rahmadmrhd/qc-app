import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { beginBusy, isBusy, resetBusyForTests } from './busy';
import {
  isSafeToReload,
  isUnsafeForDisplay,
  resetSafeReloadForTests,
  setMutationSource,
  subscribeSafety,
} from './safe-reload';
import { resetUnsavedChangesForTests, useUnsavedChanges } from './unsaved-changes';

beforeEach(() => {
  vi.useFakeTimers();
  resetSafeReloadForTests();
  resetBusyForTests();
  resetUnsavedChangesForTests();
});

test('tanpa formulir kotor, penulisan, atau mutasi: aman dimuat ulang', () => {
  expect(isSafeToReload()).toBe(true);
});

test('formulir belum disimpan membuat tidak aman, dan kembali aman bila dilepas', () => {
  const hook = renderHook(() => useUnsavedChanges(true));
  expect(isSafeToReload()).toBe(false);
  hook.unmount();
  expect(isSafeToReload()).toBe(true);
});

test('penulisan yang sedang berjalan (registri sibuk) membuat tidak aman; token ganda dihitung terpisah', () => {
  const endA = beginBusy();
  const endB = beginBusy();
  expect(isBusy()).toBe(true);
  expect(isSafeToReload()).toBe(false);
  endA();
  endA();
  expect(isSafeToReload()).toBe(false);
  endB();
  expect(isSafeToReload()).toBe(true);
});

test('mutasi react-query yang berjalan membuat tidak aman', () => {
  let count = 1;
  setMutationSource({ isMutating: () => count, subscribe: () => () => undefined });
  expect(isSafeToReload()).toBe(false);
  count = 0;
  expect(isSafeToReload()).toBe(true);
});

test('subscribeSafety memberi tahu saat registri sibuk, formulir kotor, atau cache mutasi berubah; berhenti setelah unsubscribe', () => {
  let notifyMutation: () => void = () => undefined;
  setMutationSource({
    isMutating: () => 0,
    subscribe: (callback) => {
      notifyMutation = callback;
      return () => {
        notifyMutation = () => undefined;
      };
    },
  });
  const listener = vi.fn();
  const off = subscribeSafety(listener);
  const end = beginBusy();
  expect(listener).toHaveBeenCalledTimes(1);
  end();
  expect(listener).toHaveBeenCalledTimes(2);
  const hook = renderHook(() => useUnsavedChanges(true));
  expect(listener).toHaveBeenCalledTimes(3);
  act(() => notifyMutation());
  expect(listener).toHaveBeenCalledTimes(4);
  off();
  hook.unmount();
  beginBusy();
  expect(listener).toHaveBeenCalledTimes(4);
});

test('M-d: sibuk singkat (200 ms) tidak dianggap tidak aman UNTUK TAMPILAN, tetapi tetap menghalangi muat ulang; sibuk >= 1 dtk menjadi tidak aman untuk tampilan dan memberi tahu pelanggan', () => {
  const listener = vi.fn();
  subscribeSafety(listener);
  const end = beginBusy();
  expect(isSafeToReload()).toBe(false);
  expect(isUnsafeForDisplay()).toBe(false);
  vi.advanceTimersByTime(200);
  end();
  vi.advanceTimersByTime(5_000);
  expect(isUnsafeForDisplay()).toBe(false);
  expect(isSafeToReload()).toBe(true);

  const endLong = beginBusy();
  listener.mockClear();
  vi.advanceTimersByTime(999);
  expect(isUnsafeForDisplay()).toBe(false);
  vi.advanceTimersByTime(2);
  expect(isUnsafeForDisplay()).toBe(true);
  expect(listener).toHaveBeenCalled();
  endLong();
  expect(isUnsafeForDisplay()).toBe(false);
});

test('M-d: mutasi react-query yang berjalan lama juga tidak aman untuk tampilan setelah 1 dtk; formulir kotor seketika', () => {
  let count = 1;
  let notify: () => void = () => undefined;
  setMutationSource({
    isMutating: () => count,
    subscribe: (callback) => {
      notify = callback;
      return () => undefined;
    },
  });
  notify();
  expect(isUnsafeForDisplay()).toBe(false);
  vi.advanceTimersByTime(1_100);
  expect(isUnsafeForDisplay()).toBe(true);
  count = 0;
  notify();
  expect(isUnsafeForDisplay()).toBe(false);
  const hook = renderHook(() => useUnsavedChanges(true));
  expect(isUnsafeForDisplay()).toBe(true);
  hook.unmount();
});
