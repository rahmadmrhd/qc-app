import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { ensureQrDocFolder_, ensureQrFolder_ } from './folders';

let platform: MemoryPlatform;
beforeEach(() => {
  platform = createMemoryPlatform();
  setPlatform_(platform);
});

test('folder QR dibuat bila properti kosong, idempoten, dan terpisah dari folder dokumen', () => {
  const a = ensureQrFolder_();
  const b = ensureQrDocFolder_();
  expect(a).not.toBe(b);
  expect(platform.getProperty('QR_FOLDER_ID')).toBe(a);
  expect(platform.getProperty('QR_DOC_FOLDER_ID')).toBe(b);
  expect(ensureQrFolder_()).toBe(a);
});

test('properti terisi tetapi folder tidak terakses: galat dan properti TIDAK ditimpa (FS13)', () => {
  platform.setProperty('QR_FOLDER_ID', 'folder-hilang');
  expect(() => ensureQrFolder_()).toThrow('tidak dapat diakses');
  expect(platform.getProperty('QR_FOLDER_ID')).toBe('folder-hilang');
});
