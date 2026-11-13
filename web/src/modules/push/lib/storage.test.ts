import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  BANNER_INTERVAL_MS,
  bannerDue,
  markAsked,
  markBannerShown,
  markSynced,
  wasAsked,
  wasSynced,
} from './storage';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('penanda per email', () => {
  test('wasAsked terpisah per email dan tak peka huruf besar/kecil', () => {
    expect(wasAsked('a@qc.local')).toBe(false);
    markAsked('A@QC.local');
    expect(wasAsked('a@qc.local')).toBe(true);
    expect(wasAsked('b@qc.local')).toBe(false);
  });

  test('bannerDue: belum pernah = true; kurang dari 7 hari = false; tepat 7 hari = true', () => {
    const t0 = 1_700_000_000_000;
    expect(bannerDue('a@qc.local', t0)).toBe(true);
    markBannerShown('a@qc.local', t0);
    expect(bannerDue('a@qc.local', t0 + BANNER_INTERVAL_MS - 1)).toBe(false);
    expect(bannerDue('a@qc.local', t0 + BANNER_INTERVAL_MS)).toBe(true);
    expect(bannerDue('b@qc.local', t0 + 1)).toBe(true);
  });

  test('bannerDue: nilai tersimpan rusak dianggap belum pernah', () => {
    localStorage.setItem('qc.push.banner:a@qc.local', 'bukan-angka');
    expect(bannerDue('a@qc.local', 1)).toBe(true);
  });

  test('wasSynced memakai sessionStorage, bukan localStorage', () => {
    expect(wasSynced('a@qc.local')).toBe(false);
    markSynced('a@qc.local');
    expect(wasSynced('a@qc.local')).toBe(true);
    expect(localStorage.length).toBe(0);
  });
});

describe('penyimpanan terblokir', () => {
  test('semua fungsi tetap aman dan jatuh ke "belum pernah"', () => {
    const boom = () => {
      throw new DOMException('terblokir', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    expect(() => markAsked('a@qc.local')).not.toThrow();
    expect(() => markBannerShown('a@qc.local', 1)).not.toThrow();
    expect(() => markSynced('a@qc.local')).not.toThrow();
    expect(wasAsked('a@qc.local')).toBe(false);
    expect(bannerDue('a@qc.local', 1)).toBe(true);
    expect(wasSynced('a@qc.local')).toBe(false);
  });
});
