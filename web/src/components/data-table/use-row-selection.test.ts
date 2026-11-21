import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';
import { useRowSelection } from './use-row-selection';

test('toggle, setAll, remove, dan clear', () => {
  const { result } = renderHook(() => useRowSelection('a'));
  act(() => result.current.toggle('1'));
  expect(result.current.count).toBe(1);
  act(() => result.current.setAll(['1', '2', '3'], true));
  expect(result.current.count).toBe(3);
  act(() => result.current.remove(['1', '2']));
  expect([...result.current.selected]).toEqual(['3']);
  act(() => result.current.toggle('3'));
  expect(result.current.count).toBe(0);
  act(() => result.current.setAll(['4'], true));
  act(() => result.current.clear());
  expect(result.current.count).toBe(0);
});

test('resetKey berubah mengosongkan pilihan', () => {
  const { result, rerender } = renderHook(({ key }) => useRowSelection(key), {
    initialProps: { key: '{"q":""}' },
  });
  act(() => result.current.setAll(['1', '2'], true));
  expect(result.current.count).toBe(2);
  rerender({ key: '{"q":"a"}' });
  expect(result.current.count).toBe(0);
});

test('resetKey sama tidak mengosongkan', () => {
  const { result, rerender } = renderHook(({ key }) => useRowSelection(key), {
    initialProps: { key: 'x' },
  });
  act(() => result.current.toggle('1'));
  rerender({ key: 'x' });
  expect(result.current.count).toBe(1);
});
