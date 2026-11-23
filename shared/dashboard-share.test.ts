import { describe, expect, test } from 'bun:test';
import { SHARE_LIMITS, shareStatus } from './dashboard-share';

const NOW = '2026-11-23T05:00:00.000Z';

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
