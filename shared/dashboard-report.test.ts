import { describe, expect, test } from 'bun:test';
import {
  initialRunKey,
  isDue,
  isScheduledDay,
  nextRunAt,
  periodKey,
  periodRange,
  REPORT_LIMITS,
  type ReportSchedule,
  scheduleLabel,
  validateSchedule,
  wibNow,
} from './dashboard-report';

/** Epoch ms untuk tanggal WIB `YYYY-MM-DD` pukul `hour:minute`. */
function wib(date: string, hour = 0, minute = 0): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day, hour - 7, minute);
}

const daily = (hour = 8): ReportSchedule => ({
  frequency: 'daily',
  hour,
  weekday: 1,
  monthDay: 1,
});
const weekly = (weekday: number, hour = 8): ReportSchedule => ({
  frequency: 'weekly',
  hour,
  weekday,
  monthDay: 1,
});
const monthly = (monthDay: number, hour = 8): ReportSchedule => ({
  frequency: 'monthly',
  hour,
  weekday: 1,
  monthDay,
});

describe('batas', () => {
  test('nilai tetap sesuai spek', () => {
    expect(REPORT_LIMITS).toEqual({
      widgetsMax: 12,
      perOwner: 20,
      recipientsMax: 20,
      nameMax: 120,
      scopeIdsMax: 200,
      linkDaysMax: 365,
      linkDaysDefault: 14,
      testPerHour: 5,
    });
  });
});

describe('wibNow', () => {
  test('23:30 UTC sudah hari berikutnya di WIB', () => {
    expect(wibNow(Date.UTC(2026, 10, 22, 23, 30))).toEqual({
      date: '2026-11-23',
      hour: 6,
      weekday: 1,
    });
  });
  test('Minggu = 7', () => {
    expect(wibNow(wib('2026-11-22', 12)).weekday).toBe(7);
  });
});

describe('periodRange', () => {
  test('Senin 23 Nov 2026', () => {
    const today = '2026-11-23';
    expect(periodRange('yesterday', today)).toEqual({ from: '2026-11-22', to: '2026-11-22' });
    expect(periodRange('last7', today)).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(periodRange('last30', today)).toEqual({ from: '2026-10-24', to: '2026-11-22' });
    expect(periodRange('lastWeek', today)).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(periodRange('lastMonth', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
  test('Rabu: minggu lalu tetap Senin sampai Minggu minggu sebelumnya', () => {
    expect(periodRange('lastWeek', '2026-11-25')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
  });
  test('Minggu: minggu lalu = minggu sebelum minggu yang berjalan', () => {
    expect(periodRange('lastWeek', '2026-11-22')).toEqual({ from: '2026-11-09', to: '2026-11-15' });
  });
  test('pergantian tahun', () => {
    expect(periodRange('lastMonth', '2026-01-01')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(periodRange('yesterday', '2026-01-01')).toEqual({
      from: '2025-12-31',
      to: '2025-12-31',
    });
    // 1 Jan 2026 Kamis: minggu lalu = Senin 22 Des - Minggu 28 Des 2025.
    expect(periodRange('lastWeek', '2026-01-01')).toEqual({ from: '2025-12-22', to: '2025-12-28' });
    expect(periodRange('last30', '2026-01-01')).toEqual({ from: '2025-12-02', to: '2025-12-31' });
  });
  test('bulan lalu Februari kabisat dan bukan', () => {
    expect(periodRange('lastMonth', '2028-03-10')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(periodRange('lastMonth', '2027-03-10')).toEqual({
      from: '2027-02-01',
      to: '2027-02-28',
    });
  });
});

describe('periodKey', () => {
  test('harian memakai tanggal, bulanan memakai bulan', () => {
    const now = wibNow(wib('2026-11-23', 9));
    expect(periodKey(daily(), now)).toBe('2026-11-23');
    expect(periodKey(monthly(1), now)).toBe('2026-11');
  });
  test('mingguan memakai minggu ISO, termasuk batas tahun', () => {
    expect(periodKey(weekly(1), wibNow(wib('2026-01-01', 9)))).toBe('2026-W01');
    expect(periodKey(weekly(1), wibNow(wib('2025-12-29', 9)))).toBe('2026-W01');
    expect(periodKey(weekly(1), wibNow(wib('2026-11-23', 9)))).toBe('2026-W48');
    expect(periodKey(weekly(1), wibNow(wib('2027-01-03', 9)))).toBe('2026-W53');
  });
});

describe('isScheduledDay', () => {
  test('harian setiap hari', () => {
    expect(isScheduledDay(daily(), wibNow(wib('2026-11-24', 1)))).toBe(true);
  });
  test('mingguan hanya pada hari yang cocok', () => {
    const schedule = weekly(1);
    expect(isScheduledDay(schedule, wibNow(wib('2026-11-23', 9)))).toBe(true); // Senin
    expect(isScheduledDay(schedule, wibNow(wib('2026-11-24', 9)))).toBe(false);
  });
  test('bulanan akhir bulan: 28 Feb 2027, 29 Feb 2028, 30 Apr, 31 Jan', () => {
    const schedule = monthly(0);
    expect(isScheduledDay(schedule, wibNow(wib('2027-02-28', 9)))).toBe(true);
    expect(isScheduledDay(schedule, wibNow(wib('2027-02-27', 9)))).toBe(false);
    expect(isScheduledDay(schedule, wibNow(wib('2028-02-29', 9)))).toBe(true);
    expect(isScheduledDay(schedule, wibNow(wib('2028-02-28', 9)))).toBe(false);
    expect(isScheduledDay(schedule, wibNow(wib('2026-04-30', 9)))).toBe(true);
    expect(isScheduledDay(schedule, wibNow(wib('2026-01-31', 9)))).toBe(true);
    expect(isScheduledDay(schedule, wibNow(wib('2026-01-30', 9)))).toBe(false);
  });
  test('bulanan tanggal 15 hanya tanggal 15', () => {
    const schedule = monthly(15);
    expect(isScheduledDay(schedule, wibNow(wib('2026-11-15', 9)))).toBe(true);
    expect(isScheduledDay(schedule, wibNow(wib('2026-11-14', 9)))).toBe(false);
    expect(isScheduledDay(schedule, wibNow(wib('2026-11-16', 9)))).toBe(false);
  });
});

describe('isDue', () => {
  test('sebelum jam jadwal false, tepat jam jadwal true', () => {
    expect(isDue(daily(8), wibNow(wib('2026-11-23', 7, 55)), '')).toBe(false);
    expect(isDue(daily(8), wibNow(wib('2026-11-23', 8, 0)), '')).toBe(true);
    expect(isDue(daily(8), wibNow(wib('2026-11-23', 8, 5)), '')).toBe(true);
  });
  test('kunci periode sama = sudah dikirim', () => {
    expect(isDue(daily(8), wibNow(wib('2026-11-23', 9)), '2026-11-23')).toBe(false);
    expect(isDue(daily(8), wibNow(wib('2026-11-24', 9)), '2026-11-23')).toBe(true);
  });
  test('hari tak terjadwal false', () => {
    expect(isDue(weekly(1), wibNow(wib('2026-11-24', 9)), '')).toBe(false);
    expect(isDue(weekly(1), wibNow(wib('2026-11-23', 9)), '')).toBe(true);
    expect(isDue(weekly(1), wibNow(wib('2026-11-23', 9)), '2026-W48')).toBe(false);
  });
  test('tengah malam WIB: 23:59 UTC sudah 06:59 hari berikutnya', () => {
    const now = wibNow(Date.UTC(2026, 10, 22, 23, 59));
    expect(now.date).toBe('2026-11-23');
    expect(isDue(daily(8), now, '')).toBe(false);
  });
});

describe('initialRunKey (laporan baru tidak langsung terkirim)', () => {
  test('mingguan Senin 08.00 dibuat Senin 10.00: slot lewat, kunci minggu itu', () => {
    expect(initialRunKey(weekly(1, 8), wibNow(wib('2026-11-23', 10)))).toBe('2026-W48');
  });
  test('dibuat Senin 07.00: slot belum lewat, kosong', () => {
    expect(initialRunKey(weekly(1, 8), wibNow(wib('2026-11-23', 7)))).toBe('');
  });
  test('dibuat Selasa: kunci minggu itu', () => {
    expect(initialRunKey(weekly(1, 8), wibNow(wib('2026-11-24', 6)))).toBe('2026-W48');
  });
  test('mingguan Rabu dibuat Senin: slot belum lewat', () => {
    expect(initialRunKey(weekly(3, 8), wibNow(wib('2026-11-23', 12)))).toBe('');
  });
  test('harian pada pukul yang sama dengan jam jadwal: kunci hari ini', () => {
    expect(initialRunKey(daily(8), wibNow(wib('2026-11-23', 8, 0)))).toBe('2026-11-23');
    expect(initialRunKey(daily(8), wibNow(wib('2026-11-23', 7, 59)))).toBe('');
  });
  test('bulanan: setelah tanggal jadwal = kunci bulan; sebelum = kosong; akhir bulan sebelum hari terakhir = kosong', () => {
    expect(initialRunKey(monthly(15), wibNow(wib('2026-11-20', 9)))).toBe('2026-11');
    expect(initialRunKey(monthly(15), wibNow(wib('2026-11-10', 9)))).toBe('');
    expect(initialRunKey(monthly(0), wibNow(wib('2026-11-29', 9)))).toBe('');
    expect(initialRunKey(monthly(0), wibNow(wib('2026-11-30', 9)))).toBe('2026-11');
  });
});

describe('validateSchedule', () => {
  test('jam 24 dan -1 tak sah, 0 dan 23 sah', () => {
    expect(validateSchedule({ ...daily(), hour: 24 })).not.toBeNull();
    expect(validateSchedule({ ...daily(), hour: -1 })).not.toBeNull();
    expect(validateSchedule({ ...daily(), hour: 0 })).toBeNull();
    expect(validateSchedule({ ...daily(), hour: 23 })).toBeNull();
  });
  test('weekday 0 dan 8 tak sah', () => {
    expect(validateSchedule({ ...weekly(1), weekday: 0 })).not.toBeNull();
    expect(validateSchedule({ ...weekly(1), weekday: 8 })).not.toBeNull();
    expect(validateSchedule({ ...weekly(7) })).toBeNull();
  });
  test('monthDay 29 tak sah, 0 dan 28 sah', () => {
    expect(validateSchedule(monthly(29))).not.toBeNull();
    expect(validateSchedule(monthly(0))).toBeNull();
    expect(validateSchedule(monthly(28))).toBeNull();
  });
  test('frekuensi tak dikenal dan bukan bilangan bulat', () => {
    expect(validateSchedule({ ...daily(), frequency: 'yearly' as never })).not.toBeNull();
    expect(validateSchedule({ ...daily(), hour: 8.5 })).not.toBeNull();
  });
});

describe('nextRunAt', () => {
  test('harian 08.00 setelah terkirim hari ini: besok 08.00 WIB = 01:00 UTC', () => {
    expect(nextRunAt(daily(8), wib('2026-11-23', 9), '2026-11-23')).toBe(
      '2026-11-24T01:00:00.000Z',
    );
  });
  test('harian sebelum jam jadwal: hari ini', () => {
    expect(nextRunAt(daily(8), wib('2026-11-23', 7), '')).toBe('2026-11-23T01:00:00.000Z');
  });
  test('harian lewat jam tetapi belum dikirim: jatuh tempo sekarang (hari ini)', () => {
    expect(nextRunAt(daily(8), wib('2026-11-23', 9), '')).toBe('2026-11-23T01:00:00.000Z');
  });
  test('mingguan melewati akhir pekan', () => {
    // Jumat 27 Nov 2026 setelah Senin terkirim: Senin 30 Nov 08.00 WIB.
    expect(nextRunAt(weekly(1), wib('2026-11-27', 12), '2026-W48')).toBe(
      '2026-11-30T01:00:00.000Z',
    );
  });
  test('bulanan akhir bulan Februari', () => {
    expect(nextRunAt(monthly(0), wib('2027-02-10', 12), '2027-01')).toBe(
      '2027-02-28T01:00:00.000Z',
    );
  });
  test('bulanan tanggal 1 setelah terkirim: bulan depan', () => {
    expect(nextRunAt(monthly(1), wib('2026-11-01', 9), '2026-11')).toBe('2026-12-01T01:00:00.000Z');
  });
});

describe('scheduleLabel', () => {
  test('contoh label', () => {
    expect(scheduleLabel(daily(8))).toBe('Setiap hari 08.00 WIB');
    expect(scheduleLabel(weekly(1, 8))).toBe('Senin 08.00 WIB');
    expect(scheduleLabel(weekly(7, 17))).toBe('Minggu 17.00 WIB');
    expect(scheduleLabel(monthly(1, 8))).toBe('Tanggal 1 pukul 08.00 WIB');
    expect(scheduleLabel(monthly(0, 8))).toBe('Akhir bulan 08.00 WIB');
  });
});
