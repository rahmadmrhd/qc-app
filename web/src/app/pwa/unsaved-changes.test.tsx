import { act, render, renderHook } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import {
  hasUnsavedChanges,
  resetUnsavedChangesForTests,
  useHasUnsavedChanges,
  useUnsavedChanges,
} from './unsaved-changes';

function Dirty({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  return null;
}

beforeEach(() => {
  resetUnsavedChangesForTests();
});

test('formulir kotor terdaftar selama terpasang dan lepas saat dilepas', () => {
  expect(hasUnsavedChanges()).toBe(false);
  const view = render(<Dirty dirty />);
  expect(hasUnsavedChanges()).toBe(true);
  view.unmount();
  expect(hasUnsavedChanges()).toBe(false);
});

test('formulir bersih tidak terdaftar', () => {
  render(<Dirty dirty={false} />);
  expect(hasUnsavedChanges()).toBe(false);
});

test('dua formulir kotor: melepas satu tetap menyisakan perubahan belum disimpan', () => {
  const first = render(<Dirty dirty />);
  render(<Dirty dirty />);
  first.unmount();
  expect(hasUnsavedChanges()).toBe(true);
});

test('dirty kembali false melepas pendaftaran', () => {
  const view = render(<Dirty dirty />);
  expect(hasUnsavedChanges()).toBe(true);
  view.rerender(<Dirty dirty={false} />);
  expect(hasUnsavedChanges()).toBe(false);
  view.rerender(<Dirty dirty />);
  expect(hasUnsavedChanges()).toBe(true);
});

test('useHasUnsavedChanges merender ulang saat status berubah', () => {
  const hook = renderHook(() => useHasUnsavedChanges());
  expect(hook.result.current).toBe(false);
  const form = render(<Dirty dirty />);
  expect(hook.result.current).toBe(true);
  act(() => form.unmount());
  expect(hook.result.current).toBe(false);
});
