import { expect, test } from 'bun:test';
import { constantTimeEqual, SYNC_ACTOR, SYNC_LIMITS, SYNC_RESOURCES } from './sync';

test('constantTimeEqual: sama, beda satu karakter, beda panjang, kosong', () => {
  expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
  expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
  expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  expect(constantTimeEqual('abcd', 'abc')).toBe(false);
  expect(constantTimeEqual('', '')).toBe(true);
  expect(constantTimeEqual('', 'a')).toBe(false);
});

test('konstanta kontrak', () => {
  expect(SYNC_ACTOR).toBe('sync:desktop');
  expect([...SYNC_RESOURCES]).toEqual(['brands', 'items']);
  expect(SYNC_LIMITS).toMatchObject({
    pullDefault: 100,
    pullMax: 500,
    pullMaxWithDetail: 200,
    pushMax: 50,
    pushMaxWithDetail: 25,
    failedAttempts: 10,
    blockSeconds: 600,
  });
});
