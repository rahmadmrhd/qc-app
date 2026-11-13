import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useUrlSyncedText } from './use-url-synced-text';

const trimEnd = (value: string) => value.trimEnd();

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test('mengetik mengirim nilai terakhir sekali setelah jeda', () => {
  const commit = vi.fn();
  const { result } = renderHook(() => useUrlSyncedText('', commit, 300));
  act(() => result.current[1]('b'));
  act(() => result.current[1]('bu'));
  act(() => result.current[1]('budi'));
  expect(commit).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(300));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit).toHaveBeenCalledWith('budi');
});

test('URL yang berubah dari luar mengosongkan teks dan tidak mengirim ulang nilai lama', () => {
  const commit = vi.fn();
  const { result, rerender } = renderHook(({ url }) => useUrlSyncedText(url, commit, 300), {
    initialProps: { url: '' },
  });
  act(() => result.current[1]('budi'));
  act(() => vi.advanceTimersByTime(300));
  rerender({ url: 'budi' });
  expect(commit).toHaveBeenCalledTimes(1);
  rerender({ url: '' });
  expect(result.current[0]).toBe('');
  act(() => vi.advanceTimersByTime(1000));
  expect(commit).toHaveBeenCalledTimes(1);
});

test('gema URL dari nilai yang baru dikirim tidak memicu pengiriman kedua', () => {
  const commit = vi.fn();
  const { result, rerender } = renderHook(({ url }) => useUrlSyncedText(url, commit, 300), {
    initialProps: { url: '' },
  });
  act(() => result.current[1]('sup'));
  act(() => vi.advanceTimersByTime(300));
  rerender({ url: 'sup' });
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current[0]).toBe('sup');
  expect(commit).toHaveBeenCalledTimes(1);
});

test('nilai awal berasal dari URL tanpa mengirim apa pun', () => {
  const commit = vi.fn();
  const { result } = renderHook(() => useUrlSyncedText('awal', commit, 300));
  expect(result.current[0]).toBe('awal');
  act(() => vi.advanceTimersByTime(1000));
  expect(commit).not.toHaveBeenCalled();
});

test('normalize: baris baru di ujung tidak dihapus oleh gema URL yang dipangkas', () => {
  const commit = vi.fn();
  const { result, rerender } = renderHook(
    ({ url }) => useUrlSyncedText(url, commit, 300, { normalize: trimEnd }),
    { initialProps: { url: '' } },
  );
  act(() => result.current[1]('AAA\n'));
  act(() => vi.advanceTimersByTime(300));
  expect(commit).toHaveBeenCalledWith('AAA\n');
  rerender({ url: 'AAA' });
  expect(result.current[0]).toBe('AAA\n');
  // Perubahan di ujung saja tidak memicu pengiriman baru.
  act(() => result.current[1]('AAA\n\n'));
  act(() => vi.advanceTimersByTime(300));
  expect(commit).toHaveBeenCalledTimes(1);
});
