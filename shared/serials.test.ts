import { describe, expect, test } from 'bun:test';
import {
  caseNumberPeriod,
  isIsoDate,
  listSerialsTooLong,
  normalizeSerial,
  proofMinimumOf,
  publicActorName,
  recheckBuCandidates,
  reportLinkExpiresAt,
  SERIAL_ACTIONS,
  SERIAL_EVENT_TYPES,
  SERIAL_HISTORY_GROUPS,
  SERIAL_LIMITS,
  SERIAL_STATUS_LABELS,
  SERIAL_STATUSES,
  SERVICE_DIAGNOSIS_STAGES,
  serialCaseNumber,
  serialProblem,
  splitSerialInput,
} from './serials';

describe('normalizeSerial', () => {
  test('semua varian MAC menjadi satu bentuk', () => {
    for (const raw of [
      '  4c:5e:0c:1a:2b:3d ',
      '4C-5E-0C-1A-2B-3D',
      '4C5E.0C1A.2B3D',
      '4c5e0c1a2b3d',
    ]) {
      expect(normalizeSerial(raw)).toBe('4C5E0C1A2B3D');
    }
  });

  test('bukan MAC tidak diubah selain huruf besar', () => {
    expect(normalizeSerial('sn-12345')).toBe('SN-12345');
    expect(normalizeSerial('4C:5E-0C:1A:2B:3D')).toBe('4C:5E-0C:1A:2B:3D');
    expect(normalizeSerial('0x4C5E0C1A2B3D')).toBe('0X4C5E0C1A2B3D');
  });
});

describe('serialProblem', () => {
  test('kosong, terlalu panjang, karakter kontrol, dan sah', () => {
    expect(serialProblem('')).toBe('empty');
    expect(serialProblem('A'.repeat(SERIAL_LIMITS.serialMax))).toBeNull();
    expect(serialProblem('A'.repeat(SERIAL_LIMITS.serialMax + 1))).toBe('too_long');
    expect(serialProblem('AB\u0000C')).toBe('control_chars');
    expect(serialProblem('AB‮C')).toBe('control_chars');
    expect(serialProblem('AB12')).toBeNull();
  });
});

describe('splitSerialInput', () => {
  test('memecah semua jenis baris, menormalisasi, membuang kosong dan menghitung duplikat', () => {
    const result = splitSerialInput('a\r\nb\n\nA\rc\n');
    expect(result.serials).toEqual(['A', 'B', 'C']);
    expect(result.duplicates).toBe(1);
    expect(result.rejected).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test('baris bermasalah masuk rejected', () => {
    const result = splitSerialInput('OK1\nAB\u0000C\n' + 'X'.repeat(65));
    expect(result.serials).toEqual(['OK1']);
    expect(result.rejected).toHaveLength(2);
  });

  test('dipotong pada batas', () => {
    const text = Array.from({ length: 1001 }, (_, i) => `S${i}`).join('\n');
    const result = splitSerialInput(text);
    expect(result.serials).toHaveLength(1000);
    expect(result.truncated).toBe(true);
    expect(splitSerialInput('A\nB\nC', 2).serials).toEqual(['A', 'B']);
    expect(splitSerialInput('A\nB', 2).truncated).toBe(false);
  });

  test('isi QR dengan dua baris menghasilkan dua serial', () => {
    expect(splitSerialInput('4C:5E:0C:1A:2B:3D\n4C5E0C1A2B3E').serials).toEqual([
      '4C5E0C1A2B3D',
      '4C5E0C1A2B3E',
    ]);
  });
});

describe('isIsoDate', () => {
  test('tanggal kalender sah saja', () => {
    expect(isIsoDate('2026-11-12')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    for (const bad of ['2026-13-01', '2026-02-30', '12-11-2026', '2026-1-1', '']) {
      expect(isIsoDate(bad)).toBe(false);
    }
  });
});

describe('listSerialsTooLong', () => {
  const MAX = SERIAL_LIMITS.listSerialsEncodedMax;

  test('tepat di batas ter-encode lolos, satu lebih ditolak', () => {
    expect(listSerialsTooLong('A'.repeat(MAX))).toBe(false);
    expect(listSerialsTooLong('A'.repeat(MAX + 1))).toBe(true);
  });

  test('baris baru dihitung 3 karakter (%0A) dan CRLF/CR dinormalkan menjadi satu', () => {
    // n x 'A' + 1 baris baru = n + 3 karakter ter-encode.
    expect(listSerialsTooLong(`${'A'.repeat(MAX - 3)}\n`)).toBe(false);
    expect(listSerialsTooLong(`${'A'.repeat(MAX - 2)}\n`)).toBe(true);
    expect(listSerialsTooLong(`${'A'.repeat(MAX - 3)}\r\n`)).toBe(false);
    expect(listSerialsTooLong(`${'A'.repeat(MAX - 3)}\r`)).toBe(false);
  });

  test("karakter ! ' ( ) ~ dihitung 3 karakter seperti URLSearchParams, bukan 1 seperti encodeURIComponent", () => {
    for (const char of ['!', "'", '(', ')', '~']) {
      const encodedThree = new URLSearchParams({ serials: char })
        .toString()
        .slice('serials='.length);
      expect(encodedThree.length).toBe(3);
      const fits = Math.floor(MAX / 3);
      expect(listSerialsTooLong(char.repeat(fits))).toBe(false);
      expect(listSerialsTooLong(char.repeat(fits + 1))).toBe(true);
    }
    // 50 x 64 '~': lolos bila dihitung 1 karakter, tetapi terkirim ~9,6 KB.
    expect(listSerialsTooLong(Array.from({ length: 50 }, () => '~'.repeat(64)).join('\n'))).toBe(
      true,
    );
  });

  test('karakter non-ASCII membengkak sesuai percent-encode UTF-8', () => {
    // 'é' = 2 byte = 6 karakter ter-encode.
    expect(listSerialsTooLong('é'.repeat(Math.floor(MAX / 6)))).toBe(false);
    expect(listSerialsTooLong('é'.repeat(Math.floor(MAX / 6) + 1))).toBe(true);
  });

  test('serial ASCII alfanumerik biasa (50 x 64) lolos', () => {
    expect(listSerialsTooLong(Array.from({ length: 50 }, () => 'X'.repeat(64)).join('\n'))).toBe(
      false,
    );
  });
});

describe('serialCaseNumber dan kelompok riwayat (5b)', () => {
  test('nomor kasus LP/<BU>/YYMM-iiii', () => {
    expect(serialCaseNumber('SBY', '2611', 1)).toBe('LP/SBY/2611-0001');
    expect(serialCaseNumber('SBY', '2611', 42)).toBe('LP/SBY/2611-0042');
    expect(serialCaseNumber('UM-1', '2611', 1)).toBe('LP/UM-1/2611-0001');
    expect(serialCaseNumber('SBY', '2611', 9999)).toBe('LP/SBY/2611-9999');
    expect(serialCaseNumber('SBY', '2611', 10000)).toBe('LP/SBY/2611-10000');
  });

  test('periode nomor kasus dari tanggal WIB', () => {
    expect(caseNumberPeriod('2026-11-18')).toBe('2611');
    expect(caseNumberPeriod('2027-01-05')).toBe('2701');
    expect(caseNumberPeriod('2026-12-31')).toBe('2612');
  });

  test('kelompok jenis kejadian', () => {
    expect([...SERIAL_HISTORY_GROUPS.checks]).toEqual([
      'recorded',
      'recheck',
      'recheck_pass',
      'recheck_fail',
    ]);
    expect([...SERIAL_HISTORY_GROUPS.changes]).toEqual(['data_changed']);
    for (const type of [...SERIAL_HISTORY_GROUPS.checks, ...SERIAL_HISTORY_GROUPS.changes]) {
      expect(SERIAL_EVENT_TYPES).toContain(type);
    }
  });

  test('batas 5b', () => {
    expect(SERIAL_LIMITS.publicLinkDays).toBe(30);
    expect(SERIAL_LIMITS.reportSummaryMax).toBe(120);
    expect(SERIAL_LIMITS.messageImagesMax).toBe(10);
    expect(SERIAL_LIMITS.historyDefaultLimit).toBe(50);
    expect(SERIAL_LIMITS.historyMaxLimit).toBe(100);
  });
});

describe('reportLinkExpiresAt (tautan laporan, H+30 akhir hari WIB)', () => {
  test('akhir hari WIB tanggal selesai + 30 hari', () => {
    expect(reportLinkExpiresAt('2026-11-14')).toBe(Date.UTC(2026, 11, 14, 16, 59, 59, 999));
  });

  test('melewati batas bulan dan tahun', () => {
    expect(reportLinkExpiresAt('2026-12-15')).toBe(Date.UTC(2027, 0, 14, 16, 59, 59, 999));
  });

  test('bukan tanggal = NaN', () => {
    expect(Number.isNaN(reportLinkExpiresAt('besok'))).toBe(true);
  });
});

describe('status dan aksi alur laporan rusak', () => {
  test('status baru dan labelnya', () => {
    expect([...SERIAL_STATUSES]).toEqual([
      'good',
      'reported',
      'at_service',
      'diagnosis',
      'service_repair',
      'recheck',
      'broken',
    ]);
    expect(SERIAL_STATUS_LABELS.reported).toBe('Dilaporkan');
    expect(SERIAL_STATUS_LABELS.recheck).toBe('Menunggu cek ulang');
  });

  test('aksi lama tidak lagi ada, jenis kejadian lama tetap dikenali', () => {
    expect(SERIAL_ACTIONS).not.toContain('identify_damage' as never);
    expect(SERIAL_ACTIONS).not.toContain('attempt_repair' as never);
    expect(SERIAL_EVENT_TYPES).toContain('identify_damage');
    expect(SERIAL_EVENT_TYPES).toContain('attempt_repair');
    expect([...SERVICE_DIAGNOSIS_STAGES]).toEqual(['diagnosis', 'repairing', 'done']);
  });
});

describe('publicActorName (nama pelaku tanpa alamat surel)', () => {
  test('nama biasa tetap; surel diganti bagian lokal; kosong menjadi Admin', () => {
    expect(publicActorName('Budi Servis')).toBe('Budi Servis');
    expect(publicActorName('  Wati  ')).toBe('Wati');
    expect(publicActorName('super.admin@gmail.com')).toBe('super.admin');
    expect(publicActorName('@gmail.com')).toBe('Admin');
    expect(publicActorName('')).toBe('Admin');
    expect(publicActorName('   ')).toBe('Admin');
  });
});

describe('proofMinimumOf', () => {
  test('0 bila item tidak wajib foto, selain itu proofMin', () => {
    expect(proofMinimumOf({ proofRequired: false, proofMin: 3 })).toBe(0);
    expect(proofMinimumOf({ proofRequired: true, proofMin: 3 })).toBe(3);
    expect(proofMinimumOf({ proofRequired: true, proofMin: 1 })).toBe(1);
  });
});

describe('recheckBuCandidates', () => {
  test('A lalu B: dari B kandidatnya B dan BU yang belum pernah, bukan A', () => {
    expect(
      recheckBuCandidates({
        currentBuId: 'B',
        involvedBuIds: ['A', 'B'],
        writableBuIds: ['A', 'B', 'C'],
      }),
    ).toEqual(['B', 'C']);
  });
  test('BU yang tak boleh ditulis pengguna dikeluarkan, termasuk BU saat ini', () => {
    expect(
      recheckBuCandidates({
        currentBuId: 'B',
        involvedBuIds: ['A', 'B'],
        writableBuIds: ['C', 'D'],
      }),
    ).toEqual(['C', 'D']);
  });
  test('tanpa riwayat selain BU saat ini: semua BU tulis boleh', () => {
    expect(
      recheckBuCandidates({ currentBuId: 'A', involvedBuIds: ['A'], writableBuIds: ['A', 'B'] }),
    ).toEqual(['A', 'B']);
  });
  test('kosong bila tak ada BU tulis yang memenuhi syarat', () => {
    expect(
      recheckBuCandidates({ currentBuId: 'B', involvedBuIds: ['A', 'B'], writableBuIds: ['A'] }),
    ).toEqual([]);
    expect(
      recheckBuCandidates({ currentBuId: 'B', involvedBuIds: ['B'], writableBuIds: [] }),
    ).toEqual([]);
  });
  test('urutan masukan dipertahankan dan duplikat dibuang', () => {
    expect(
      recheckBuCandidates({
        currentBuId: 'B',
        involvedBuIds: ['B'],
        writableBuIds: ['C', 'B', 'C'],
      }),
    ).toEqual(['C', 'B']);
  });
});
