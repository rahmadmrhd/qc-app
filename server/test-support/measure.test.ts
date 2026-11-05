import { expect, test } from 'bun:test';
import { measureCpu } from './measure';

test('measureCpu mengembalikan hasil dan durasi non-negatif', async () => {
  const { result, ms } = await measureCpu(async () => 42);
  expect(result).toBe(42);
  expect(ms).toBeGreaterThanOrEqual(0);
});
