import { describe, expect, test } from 'bun:test';
import { reportLinkExpiresAt } from '@shared/serials';
import { reportLinkBaseDate } from './alert-job';

// Dasar kedaluwarsa tautan publik = waktu SERVER saat laporan ditutup, bukan tanggal kejadian pilihan pengguna
// (keputusan pemilik 2026-11-23). Murni, tanpa basis data.
describe('reportLinkBaseDate', () => {
  test('tanggal kejadian mundur jauh: dasar = tanggal WIB penutupan di server', () => {
    // Ditutup 2026-11-23 10:00 WIB (03:00Z) dengan tanggal kejadian 45 hari lalu.
    expect(reportLinkBaseDate('2026-10-09', '2026-11-23T03:00:00.000Z')).toBe('2026-11-23');
  });

  test('batas hari WIB: 17:00Z sudah hari berikutnya di WIB', () => {
    expect(reportLinkBaseDate('2026-11-23', '2026-11-23T17:30:00.000Z')).toBe('2026-11-24');
  });

  test('tanggal kejadian sama atau lebih akhir dari penutupan server: tanggal kejadian dipakai', () => {
    expect(reportLinkBaseDate('2026-11-23', '2026-11-23T03:00:00.000Z')).toBe('2026-11-23');
    expect(reportLinkBaseDate('2026-11-25', '2026-11-23T03:00:00.000Z')).toBe('2026-11-25');
  });

  test('updated_at tak terbaca: jatuh ke tanggal kejadian; laporan belum tertutup: kosong (tanpa tautan)', () => {
    expect(reportLinkBaseDate('2026-11-12', 't')).toBe('2026-11-12');
    expect(reportLinkBaseDate('2026-11-12', '')).toBe('2026-11-12');
    expect(reportLinkBaseDate('', '2026-11-23T03:00:00.000Z')).toBe('');
    expect(
      Number.isFinite(reportLinkExpiresAt(reportLinkBaseDate('', '2026-11-23T03:00:00.000Z'))),
    ).toBe(false);
  });

  test('tautan tidak langsung kedaluwarsa untuk kejadian bertanggal lama', () => {
    const expiresAt = reportLinkExpiresAt(
      reportLinkBaseDate('2026-09-01', '2026-11-23T03:00:00.000Z'),
    );
    expect(expiresAt).toBeGreaterThan(Date.parse('2026-11-23T03:00:00.000Z'));
  });
});
