// Konfigurasi Multi terakhir (Concurrent dan Exclude IP) diingat per komputer (spek Multi-Device §5; aplikasi lama tidak
// menyimpan Exclude IP). Penyimpanan bisa tidak tersedia atau berisi data rusak: semuanya dibungkus try/catch.

import { isIpv4 } from '@countrylock/multi/lease';

export const MULTI_PREFS_KEY = 'qc.countrylock.multi';
export const MULTI_CONCURRENCY_DEFAULT = 4;
export const MULTI_CONCURRENCY_MIN = 1;
export const MULTI_CONCURRENCY_MAX = 32;

export interface MultiPrefs {
  concurrency: number;
  excludeIp: string;
}

/** Bilangan bulat 1 sampai 32 dari isian teks, atau `null` bila tak sah. */
export function parseConcurrency(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= MULTI_CONCURRENCY_MIN && n <= MULTI_CONCURRENCY_MAX ? n : null;
}

/** Kosong (tak ada IP dikecualikan) atau IPv4 ketat. */
export function isValidExcludeIp(text: string): boolean {
  const value = text.trim();
  return value === '' || isIpv4(value);
}

export function loadMultiPrefs(): MultiPrefs {
  const prefs: MultiPrefs = { concurrency: MULTI_CONCURRENCY_DEFAULT, excludeIp: '' };
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MULTI_PREFS_KEY) ?? 'null');
    if (typeof parsed === 'object' && parsed !== null) {
      const { concurrency, excludeIp } = parsed as Record<string, unknown>;
      if (typeof concurrency === 'number' && parseConcurrency(String(concurrency)) !== null) {
        prefs.concurrency = concurrency;
      }
      if (typeof excludeIp === 'string' && isValidExcludeIp(excludeIp)) {
        prefs.excludeIp = excludeIp.trim();
      }
    }
  } catch {
    // Penyimpanan tak tersedia atau isinya rusak: pakai bawaan.
  }
  return prefs;
}

export function saveMultiPrefs(prefs: MultiPrefs): void {
  try {
    localStorage.setItem(MULTI_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Penyimpanan penuh atau diblokir: nilai hanya berlaku selama jendela ini terbuka.
  }
}
