import { renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';
import { useFrozen } from './use-frozen';

test('useFrozen mengembalikan nilai PERTAMA walau nilai berikutnya berubah (form ubah tidak di-reset diam-diam)', () => {
  const { result, rerender } = renderHook(({ value }) => useFrozen(value), {
    initialProps: { value: 'v1' },
  });
  expect(result.current).toBe('v1');
  rerender({ value: 'v2' });
  expect(result.current).toBe('v1');
});
