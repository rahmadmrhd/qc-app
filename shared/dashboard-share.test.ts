import { describe, expect, test } from 'bun:test';
import { endOfWibDayMs, SHARE_LIMITS, shareExpiry, shareStatus } from './dashboard-share';

const NOW = '2026-11-23T05:00:00.000Z';
const NOW_MS = Date.parse(NOW);

describe('shareExpiry (butir 9 review: tanggal tertentu = akhir hari WIB)', () => {
  test('endOfWibDayMs = 23:59:59.999 WIB (16:59:59.999 UTC)', () => {
    expect(new Date(endOfWibDayMs('2026-12-20')).toISOString()).toBe('2026-12-20T16:59:59.999Z');
    expect(Number.isNaN(endOfWibDayMs('2026-13-40'))).toBe(true);
    expect(Number.isNaN(endOfWibDayMs('besok'))).toBe(true);
  });

  test('durasi: sekarang + N x 24 jam (tak berubah)', () => {
    const out = shareExpiry({ expiresInDays: 30 }, NOW_MS);
    expect(out).toEqual({ ok: true, ms: NOW_MS + 30 * 86_400_000 });
  });

  test('tanggal: akhir hari WIB, bukan jam pembuatan', () => {
    const out = shareExpiry({ expiresOn: '2026-12-01' }, NOW_MS);
    if (!out.ok) throw new Error('harus sah');
    expect(new Date(out.ms).toISOString()).toBe('2026-12-01T16:59:59.999Z');
  });

  test('hari ini (WIB) sah; kemarin dan lebih dari 365 hari ditolak', () => {
    expect(shareExpiry({ expiresOn: '2026-11-23' }, NOW_MS).ok).toBe(true);
    const yesterday = shareExpiry({ expiresOn: '2026-11-22' }, NOW_MS);
    expect(yesterday).toMatchObject({ ok: false, field: 'expiresOn' });
    expect(shareExpiry({ expiresOn: '2027-11-23' }, NOW_MS).ok).toBe(true);
    expect(shareExpiry({ expiresOn: '2027-11-24' }, NOW_MS)).toMatchObject({
      ok: false,
      field: 'expiresOn',
    });
  });

  test('tepat satu dari expiresInDays dan expiresOn', () => {
    expect(shareExpiry({}, NOW_MS)).toMatchObject({ ok: false });
    expect(shareExpiry({ expiresInDays: 7, expiresOn: '2026-12-01' }, NOW_MS)).toMatchObject({
      ok: false,
    });
    expect(shareExpiry({ expiresInDays: 0 }, NOW_MS)).toMatchObject({
      ok: false,
      field: 'expiresInDays',
    });
    expect(shareExpiry({ expiresInDays: 366 }, NOW_MS)).toMatchObject({ ok: false });
  });
});

describe('SHARE_LIMITS', () => {
  test('nilai batas sesuai spek (7.5 dan K4)', () => {
    expect(SHARE_LIMITS).toEqual({
      widgetsMax: 30,
      activePerSharer: 50,
      expiryDaysMax: 365,
      expiryDaysDefault: 30,
      titleMax: 120,
    });
  });
});

describe('shareStatus', () => {
  test('revoked bila revoked_at terisi, walau belum kedaluwarsa', () => {
    expect(
      shareStatus(
        { expires_at: '2026-12-01T00:00:00.000Z', revoked_at: '2026-11-22T00:00:00.000Z' },
        NOW,
      ),
    ).toBe('revoked');
  });

  test('revoked menang atas expired', () => {
    expect(
      shareStatus(
        { expires_at: '2026-11-01T00:00:00.000Z', revoked_at: '2026-10-30T00:00:00.000Z' },
        NOW,
      ),
    ).toBe('revoked');
  });

  test('expired bila expires_at <= sekarang (batas tepat sudah kedaluwarsa)', () => {
    expect(shareStatus({ expires_at: NOW, revoked_at: '' }, NOW)).toBe('expired');
    expect(shareStatus({ expires_at: '2026-11-23T04:59:59.999Z', revoked_at: '' }, NOW)).toBe(
      'expired',
    );
  });

  test('active selain itu', () => {
    expect(shareStatus({ expires_at: '2026-11-23T05:00:00.001Z', revoked_at: '' }, NOW)).toBe(
      'active',
    );
  });
});
