import { expect, test } from 'vitest';
import { formatBytes, formatPublishedDate } from './format';

test('formatBytes memakai koma desimal dan satuan yang pas', () => {
  expect(formatBytes(0)).toBe('0 B');
  expect(formatBytes(1023)).toBe('1.023 B');
  expect(formatBytes(1_536_000)).toBe('1,5 MB');
  expect(formatBytes(105_906_176)).toBe('101 MB');
  expect(formatBytes(2 * 1024 ** 3)).toBe('2 GB');
});

test('formatPublishedDate memberi tanggal Indonesia (WIB)', () => {
  expect(formatPublishedDate('2026-11-18T10:00:00.000Z')).toContain('18 November 2026');
  // 17:30 UTC sudah lewat tengah malam di WIB: tanggalnya maju sehari.
  expect(formatPublishedDate('2026-11-18T17:30:00.000Z')).toContain('19 November 2026');
});
