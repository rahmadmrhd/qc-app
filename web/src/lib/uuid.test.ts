import { afterEach, expect, test, vi } from 'vitest';
import { newUuid } from './uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

test('newUuid: UUID v4 huruf kecil dan unik', () => {
  const a = newUuid();
  expect(a).toMatch(UUID_V4);
  expect(newUuid()).not.toBe(a);
});

test('newUuid: tanpa randomUUID (konteks tak aman) tetap menghasilkan UUID v4 sah', () => {
  vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(255) });
  expect(newUuid()).toMatch(UUID_V4);
});

test('newUuid: tanpa crypto sama sekali tetap menghasilkan UUID v4 sah', () => {
  vi.stubGlobal('crypto', undefined);
  expect(newUuid()).toMatch(UUID_V4);
});
