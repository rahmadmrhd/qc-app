import { expect, test } from 'vitest';
import {
  CONDITION_LABEL,
  daysLeftLabel,
  formatPostelDate,
  numberStatusLabel,
  ROLE_LABEL,
} from './condition';

test('label kondisi dan peran', () => {
  expect(CONDITION_LABEL).toEqual({
    valid: 'Berlaku',
    soon: 'Segera habis',
    expired: 'Kedaluwarsa',
  });
  expect(ROLE_LABEL).toEqual({ active: 'Aktif', old: 'Lama' });
});

test('status nomor: Aktif selalu dengan kondisi; Lama hanya bila kedaluwarsa', () => {
  expect(numberStatusLabel('active', 'valid')).toBe('Aktif · Berlaku');
  expect(numberStatusLabel('active', 'expired')).toBe('Aktif · Kedaluwarsa');
  expect(numberStatusLabel('old', 'expired')).toBe('Lama · Kedaluwarsa');
  expect(numberStatusLabel('old', 'valid')).toBe('Lama');
  expect(numberStatusLabel('old', 'soon')).toBe('Lama');
});

test('sisa hari', () => {
  expect(daysLeftLabel(12)).toBe('12 hari');
  expect(daysLeftLabel(0)).toBe('Hari ini');
  expect(daysLeftLabel(-3)).toBe('Lewat 3 hari');
});

test('tanggal kalender tampil tanpa pergeseran zona waktu', () => {
  expect(formatPostelDate('2026-12-01')).toMatch(/^1 Des(?:ember)? 2026$/);
  expect(formatPostelDate('bukan tanggal')).toBe('bukan tanggal');
});
