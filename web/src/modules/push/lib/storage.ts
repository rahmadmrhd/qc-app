/**
 * Penanda sisi klien untuk onboarding push. Semuanya per email (satu perangkat dapat dipakai beberapa akun) dan
 * dibungkus try/catch: penyimpanan dapat kosong/terblokir (jendela privat), dan halaman harus tetap bekerja.
 */

/** Banner "izin ditolak" tampil paling sering sekali per selang ini per pengguna (spek §5.2, pilihan perancang). */
export const BANNER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

const ASKED_KEY = 'qc.push.asked:';
const BANNER_KEY = 'qc.push.banner:';
const SYNCED_KEY = 'qc.push.synced:';

function keyOf(prefix: string, email: string): string {
  return `${prefix}${email.trim().toLowerCase()}`;
}

function read(store: () => Storage, key: string): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}

function write(store: () => Storage, key: string, value: string): void {
  try {
    store().setItem(key, value);
  } catch {
    // Penyimpanan tak tersedia: penanda hilang, perilaku jatuh ke "belum pernah".
  }
}

/** Dialog pra-izin sudah pernah ditampilkan untuk pengguna ini di perangkat ini (apa pun jawabannya). */
export function wasAsked(email: string): boolean {
  return read(() => localStorage, keyOf(ASKED_KEY, email)) === '1';
}

export function markAsked(email: string): void {
  write(() => localStorage, keyOf(ASKED_KEY, email), '1');
}

/** Belum pernah ditampilkan, atau terakhir ditampilkan >= `BANNER_INTERVAL_MS` yang lalu. */
export function bannerDue(email: string, now: number): boolean {
  const raw = read(() => localStorage, keyOf(BANNER_KEY, email));
  const last = raw === null ? Number.NaN : Number(raw);
  return !Number.isFinite(last) || now - last >= BANNER_INTERVAL_MS;
}

export function markBannerShown(email: string, now: number): void {
  write(() => localStorage, keyOf(BANNER_KEY, email), String(now));
}

/** Langganan sudah disinkronkan ke server dalam sesi tab ini (cukup sekali per sesi). */
export function wasSynced(email: string): boolean {
  return read(() => sessionStorage, keyOf(SYNCED_KEY, email)) === '1';
}

export function markSynced(email: string): void {
  write(() => sessionStorage, keyOf(SYNCED_KEY, email), '1');
}
