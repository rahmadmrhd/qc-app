import { expect, test } from 'bun:test';
import { appError_ } from '@gas/core/errors';
import { setPlatform_ } from '@gas/core/platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { isStaleWrite_, syncFailureResult_ } from './conflict';

test('galat aplikasi → invalid per field; galat tak terduga → error yang boleh diulang (bukan invalid), dan dicatat', () => {
  const platform = createMemoryPlatform();
  setPlatform_(platform);
  expect(syncFailureResult_(appError_('VALIDATION', 'x', { merk: 'salah' }), 3)).toEqual({
    index: 3,
    status: 'invalid',
    fields: { merk: 'salah' },
  });
  expect(syncFailureResult_(appError_('CONFLICT', 'bentrok'), 1)).toMatchObject({
    status: 'invalid',
    fields: { _: 'bentrok' },
  });
  const transient = syncFailureResult_(new Error('lock timeout'), 7);
  expect(transient).toMatchObject({
    index: 7,
    status: 'error',
    fields: { _: 'Galat server sementara; ulangi permintaan' },
  });
  expect(platform.errors.join('')).toContain('lock timeout');
});

test('isStaleWrite_: overwrite, baseRev kosong, lebih lama, dan terkini', () => {
  expect(isStaleWrite_(undefined, 5, true)).toBe(false);
  expect(isStaleWrite_(undefined, 5, false)).toBe(true);
  expect(isStaleWrite_(4, 5, false)).toBe(true);
  expect(isStaleWrite_(5, 5, false)).toBe(false);
});
