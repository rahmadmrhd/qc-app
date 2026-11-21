import { expect, test } from 'bun:test';
import { BATCH_MAX, type ListStatusFilter } from './batch';

test('BATCH_MAX = 100', () => {
  expect(BATCH_MAX).toBe(100);
});

test('ListStatusFilter menerima empat nilai', () => {
  const all: ListStatusFilter[] = ['active', 'inactive', 'deleted', 'all'];
  expect(all).toHaveLength(4);
});
