import { describe, expect, test } from 'bun:test';
import {
  alertDue,
  alertTarget,
  daysBetween,
  daysUntil,
  isCalendarDate,
  POSTEL_ALERT_DEFAULTS,
  POSTEL_LIMITS,
  postelCondition,
  postelName,
  postelRoles,
  wibDateIso,
} from './postel';

describe('konstanta', () => {
  test('batas dan bawaan peringatan', () => {
    expect(POSTEL_LIMITS.nameMax).toBe(80);
    expect(POSTEL_LIMITS.attachmentMaxBytes).toBe(10_485_760);
    expect(POSTEL_ALERT_DEFAULTS).toEqual({
      enabled: false,
      recipients: [],
      sendHour: 8,
      thresholds: [90, 60, 30],
      repeatEveryDays: 7,
    });
  });
});

describe('wibDateIso', () => {
  test('tanggal WIB memakai offset +7 jam', () => {
    expect(wibDateIso(Date.parse('2026-11-10T16:59:59Z'))).toBe('2026-11-10');
    expect(wibDateIso(Date.parse('2026-11-10T17:00:00Z'))).toBe('2026-11-11');
  });
});

describe('isCalendarDate', () => {
  test('menerima tanggal kalender nyata', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2100-12-31')).toBe(true);
    expect(isCalendarDate('2000-01-01')).toBe(true);
  });
  test('menolak tanggal tidak nyata, format longgar, dan tahun di luar rentang', () => {
    for (const value of ['2027-02-29', '2026-13-01', '1999-12-31', '2101-01-01', '2026-1-5', '']) {
      expect(isCalendarDate(value)).toBe(false);
    }
  });
});

describe('daysBetween dan daysUntil', () => {
  test('selisih hari', () => {
    expect(daysUntil('2026-12-11', '2026-11-11')).toBe(30);
    expect(daysUntil('2026-11-11', '2026-11-11')).toBe(0);
    expect(daysUntil('2026-11-10', '2026-11-11')).toBe(-1);
    expect(daysUntil('2028-03-01', '2028-02-28')).toBe(2);
    expect(daysBetween('2026-11-11', '2026-12-11')).toBe(30);
  });
});

describe('postelCondition', () => {
  test('batas kondisi', () => {
    expect(postelCondition(0, 90)).toBe('soon');
    expect(postelCondition(90, 90)).toBe('soon');
    expect(postelCondition(91, 90)).toBe('valid');
    expect(postelCondition(-1, 90)).toBe('expired');
  });
});

describe('postelRoles', () => {
  test('seq terbesar = active, sisanya old', () => {
    expect(postelRoles([1, 3, 2])).toEqual(['old', 'active', 'old']);
    expect(postelRoles([])).toEqual([]);
  });
});

describe('alertTarget', () => {
  const t = [60, 90, 30];
  test('ambang terkecil yang sudah dicapai', () => {
    expect(alertTarget(100, t)).toBeNull();
    expect(alertTarget(90, t)).toBe(90);
    expect(alertTarget(75, t)).toBe(90);
    expect(alertTarget(60, t)).toBe(60);
    expect(alertTarget(30, t)).toBe(30);
    expect(alertTarget(10, t)).toBe(30);
    expect(alertTarget(0, t)).toBe(30);
  });
  test('kedaluwarsa = -1 dan tanpa ambang = null', () => {
    expect(alertTarget(-1, t)).toBe(-1);
    expect(alertTarget(10, [])).toBeNull();
  });
});

describe('alertDue', () => {
  const base = {
    thresholds: [90, 60, 30],
    repeatEveryDays: 7,
    today: '2026-11-11',
    sentOn: '2026-11-10',
  };
  test('belum pernah dikirim: kirim sasaran', () => {
    expect(alertDue({ ...base, daysLeft: 75, sentThreshold: null, sentOn: '' })).toBe(90);
  });
  test('ambang yang sama sudah dikirim: tidak kirim lagi (bukan ujung)', () => {
    expect(alertDue({ ...base, daysLeft: 75, sentThreshold: 90 })).toBeNull();
    expect(alertDue({ ...base, daysLeft: 75, sentThreshold: 90, sentOn: '2026-10-01' })).toBeNull();
  });
  test('sasaran lebih kecil dari yang terkirim: kirim', () => {
    expect(alertDue({ ...base, daysLeft: 60, sentThreshold: 90 })).toBe(60);
    expect(alertDue({ ...base, daysLeft: -1, sentThreshold: 30 })).toBe(-1);
  });
  test('pengingat ulang di ujung setelah repeatEveryDays', () => {
    expect(alertDue({ ...base, daysLeft: 23, sentThreshold: 30, sentOn: '2026-11-04' })).toBe(30);
    expect(alertDue({ ...base, daysLeft: 23, sentThreshold: 30, sentOn: '2026-11-10' })).toBeNull();
    expect(
      alertDue({
        ...base,
        daysLeft: 23,
        sentThreshold: 30,
        sentOn: '2026-11-04',
        repeatEveryDays: 0,
      }),
    ).toBeNull();
    expect(alertDue({ ...base, daysLeft: -5, sentThreshold: -1, sentOn: '2026-11-04' })).toBe(-1);
  });
  test('ambang diubah: state berupa nilai ambang tetap dipahami', () => {
    expect(alertDue({ ...base, thresholds: [30], daysLeft: 25, sentThreshold: 60 })).toBe(30);
  });
  test('belum ada ambang tercapai: null', () => {
    expect(alertDue({ ...base, daysLeft: 100, sentThreshold: 30 })).toBeNull();
    expect(alertDue({ ...base, daysLeft: 100, sentThreshold: null, sentOn: '' })).toBeNull();
    expect(
      alertDue({ ...base, thresholds: [], daysLeft: 5, sentThreshold: null, sentOn: '' }),
    ).toBeNull();
  });
});

describe('postelName', () => {
  test('menggabungkan tipe model', () => {
    expect(postelName(['M5-400', 'M5-200'])).toBe('M5-200/400');
    expect(postelName(['U6-XG-B', 'U6-XG'])).toBe('U6-XG(-B)');
  });
  test('satu tipe, kosong, dan duplikat beda huruf besar', () => {
    expect(postelName(['M5-400'])).toBe('M5-400');
    expect(postelName([])).toBe('');
    expect(postelName(['  ', ''])).toBe('');
    expect(postelName(['m5-400', 'M5-400'])).toBe('m5-400');
  });
  test('dipotong paling panjang 80 karakter berakhiran elipsis', () => {
    const models = Array.from({ length: 30 }, (_, i) => `AB${String(i).padStart(2, '0')}-XYZ`);
    const name = postelName(models);
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.length).toBeGreaterThan(70);
    expect(name.endsWith('…')).toBe(true);
    expect(postelName(['A-1', 'A-2'])).toBe('A-1/2');
  });
});
