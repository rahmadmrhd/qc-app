import { expect, test } from 'bun:test';
import { dateKeyOf } from './handover';
import { wibDateIso } from './postel';
import { qrPdfFileName } from './qrcode';
import { WIB_OFFSET_MS, wibParts } from './wib';

test('WIB = UTC+7 tetap', () => {
  expect(WIB_OFFSET_MS).toBe(7 * 60 * 60 * 1000);
});

test('wibParts melewati tengah malam WIB (17:00 UTC) ke hari berikutnya', () => {
  expect(wibParts(Date.parse('2026-12-31T16:59:59.000Z'))).toEqual({
    year: 2026,
    month: 12,
    day: 31,
    hour: 23,
    minute: 59,
    second: 59,
  });
  expect(wibParts(Date.parse('2026-12-31T17:00:00.000Z'))).toEqual({
    year: 2027,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
  });
});

test('pemformat tanggal WIB yang berbagi wibParts memberi hari yang sama dengan format berbeda', () => {
  const ms = Date.parse('2026-10-15T17:05:09.000Z'); // 16 Okt 2026 00:05:09 WIB
  expect(dateKeyOf(ms)).toBe('20261016');
  expect(wibDateIso(ms)).toBe('2026-10-16');
  expect(qrPdfFileName('A', '', ms)).toBe('A-20261016-000509.pdf');
});
