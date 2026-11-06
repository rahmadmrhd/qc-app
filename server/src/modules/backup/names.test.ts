import { describe, expect, test } from 'bun:test';
import { backupName, isoWeekKey, parseBackupName, wibDate, wibDateEpoch, wibHour } from './names';

describe('nama berkas cadangan (WIB)', () => {
  test('backupName memakai waktu WIB (UTC+7) dan format qc-backup-YYYYMMDD-HHmm.sql.gz', () => {
    // 2026-01-14T19:05Z = 2026-01-15 02:05 WIB
    expect(backupName(Date.parse('2026-01-14T19:05:00Z'))).toBe('qc-backup-20260115-0205.sql.gz');
  });

  test('wibDate dan wibHour mengikuti WIB, melewati tengah malam UTC', () => {
    const ms = Date.parse('2026-01-14T17:30:00Z'); // 00:30 WIB tanggal 15
    expect(wibDate(ms)).toBe('20260115');
    expect(wibHour(ms)).toBe(0);
  });

  test('parseBackupName mengembalikan tanggal, kunci urut, dan epoch (WIB -> UTC)', () => {
    const parsed = parseBackupName('qc-backup-20260115-0205.sql.gz');
    expect(parsed?.date).toBe('20260115');
    expect(parsed?.key).toBe('202601150205');
    expect(parsed?.epochMs).toBe(Date.parse('2026-01-14T19:05:00Z'));
  });

  test('nama tak dikenal atau tanggal/jam mustahil -> null', () => {
    for (const name of [
      'qc-backup-20260115-0205.sql',
      'qc-backup-20260115-0205.sql.gz.partial',
      'x-qc-backup-20260115-0205.sql.gz',
      'qc-backup-20261315-0205.sql.gz',
      'qc-backup-20260230-0205.sql.gz',
      'qc-backup-20260115-2405.sql.gz',
      'qc-backup-20260115-0260.sql.gz',
      'catatan.txt',
      '',
    ]) {
      expect(parseBackupName(name)).toBeNull();
    }
  });

  test('wibDateEpoch: pukul 02:00 WIB (bawaan) pada tanggal itu, dalam UTC', () => {
    expect(wibDateEpoch('20260115')).toBe(Date.parse('2026-01-14T19:00:00Z'));
    expect(wibDateEpoch('20260115', 0)).toBe(Date.parse('2026-01-14T17:00:00Z'));
  });

  test('isoWeekKey: Senin-Minggu satu pekan, batas tahun mengikuti ISO', () => {
    expect(isoWeekKey('20260105')).toBe(isoWeekKey('20260111')); // Senin..Minggu
    expect(isoWeekKey('20260111')).not.toBe(isoWeekKey('20260112'));
    expect(isoWeekKey('20261231')).toBe('2026-W53');
    expect(isoWeekKey('20270101')).toBe('2026-W53');
    expect(isoWeekKey('20241230')).toBe('2025-W01');
  });
});
