import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test, vi } from 'vitest';
import { type FilterDraftApi, FilterDraftContext, useChipDraft } from './filter-draft';

function makeChip() {
  let flush: (() => void) | null = null;
  const api: FilterDraftApi = {
    register(fn) {
      flush = fn;
      return () => {
        if (flush === fn) flush = null;
      };
    },
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FilterDraftContext.Provider value={api}>{children}</FilterDraftContext.Provider>
  );
  return { wrapper, close: () => act(() => flush?.()) };
}

test('tanpa chip: nilai dan komit apa adanya', () => {
  const commit = vi.fn();
  const { result } = renderHook(() => useChipDraft<string>('a', commit));
  expect(result.current[0]).toBe('a');
  act(() => result.current[1]('b'));
  expect(commit).toHaveBeenCalledWith('b');
});

test('di dalam chip: perubahan hanya menjadi draf, komit satu kali saat chip menutup', () => {
  const { wrapper, close } = makeChip();
  const commit = vi.fn();
  const { result } = renderHook(() => useChipDraft<string>('a', commit), { wrapper });
  act(() => result.current[1]('b'));
  act(() => result.current[1]('c'));
  expect(result.current[0]).toBe('c');
  expect(commit).not.toHaveBeenCalled();
  close();
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit).toHaveBeenCalledWith('c');
  close();
  expect(commit).toHaveBeenCalledTimes(1);
});

test('nilai yang tampil tetap draf setelah chip menutup sampai pemanggil memperbarui value (tanpa kilas balik ke nilai lama)', () => {
  const { wrapper, close } = makeChip();
  const commit = vi.fn();
  const { result, rerender } = renderHook(({ value }) => useChipDraft(value, commit), {
    wrapper,
    initialProps: { value: 'a' },
  });
  act(() => result.current[1]('b'));
  close();
  expect(commit).toHaveBeenCalledWith('b');
  // Navigasi belum berjalan: value masih 'a', tetapi yang tampil tetap pilihan pengguna.
  expect(result.current[0]).toBe('b');
  rerender({ value: 'a' });
  expect(result.current[0]).toBe('b');
  // Komit sampai: value menyusul draf.
  rerender({ value: 'b' });
  expect(result.current[0]).toBe('b');
  // Setelah menyusul, draf sudah dibuang: perubahan luar berikutnya tampil apa adanya.
  rerender({ value: 'z' });
  expect(result.current[0]).toBe('z');
});

test('draf basi dibuang bila value berubah dari luar ke nilai yang bukan draf', () => {
  const { wrapper, close } = makeChip();
  const commit = vi.fn();
  const { result, rerender } = renderHook(({ value }) => useChipDraft(value, commit), {
    wrapper,
    initialProps: { value: 'a' },
  });
  act(() => result.current[1]('b'));
  close();
  expect(result.current[0]).toBe('b');
  rerender({ value: 'x' });
  expect(result.current[0]).toBe('x');
});

test('pilih lalu batal pilih (draf sama dengan value) tanpa komit dan tanpa draf tersisa', () => {
  const { wrapper, close } = makeChip();
  const commit = vi.fn();
  const { result } = renderHook(() => useChipDraft<string>('a', commit), { wrapper });
  act(() => result.current[1]('b'));
  act(() => result.current[1]('a'));
  close();
  expect(commit).not.toHaveBeenCalled();
  expect(result.current[0]).toBe('a');
});
