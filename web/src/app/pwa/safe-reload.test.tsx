import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { beginBusy, isBusy, resetBusyForTests } from './busy';
import {
  isSafeToReload,
  resetSafeReloadForTests,
  setMutationSource,
  subscribeSafety,
} from './safe-reload';
import { resetUnsavedChangesForTests, useUnsavedChanges } from './unsaved-changes';

beforeEach(() => {
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
