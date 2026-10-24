import { expect, test } from 'vitest';
import { handoverSearchSchema, searchFromStatus, statusFromSearch } from './search';

test('search param status: nilai sah dibaca, nilai asing diabaikan, all tidak ditulis ke URL', () => {
  expect(statusFromSearch(handoverSearchSchema.parse({ status: 'done' }))).toBe('done');
  expect(statusFromSearch(handoverSearchSchema.parse({ status: 'xyz' }))).toBe('all');
  expect(statusFromSearch(handoverSearchSchema.parse({}))).toBe('all');
  expect(searchFromStatus('all')).toEqual({});
  expect(searchFromStatus('new')).toEqual({ status: 'new' });
});
