/**
 * Penyimpanan status panduan di perangkat (akun bersama; spek 4.3): satu kunci `localStorage` per email,
 * objek JSON `{ "<id panduan>": <versi> }`. Semua akses dibungkus try/catch (pola `push/lib/storage.ts`): penyimpanan
 * dapat kosong/terblokir (jendela privat) dan halaman harus tetap bekerja; panduan lalu dianggap belum selesai.
 */

const KEY_PREFIX = 'qc.guide.done:';

function keyOf(email: string): string {
  return `${KEY_PREFIX}${email.trim().toLowerCase()}`;
}

function readRecord(email: string): Record<string, number> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(keyOf(email));
  } catch {
    return {};
  }
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const record: Record<string, number> = {};
  for (const [id, version] of Object.entries(parsed)) {
    if (typeof version === 'number' && Number.isInteger(version) && version >= 1) {
      record[id] = version;
    }
  }
  return record;
}

function writeRecord(email: string, record: Record<string, number>): void {
  try {
    localStorage.setItem(keyOf(email), JSON.stringify(record));
  } catch {
    // Penyimpanan tak tersedia: penanda hilang, panduan ditawarkan lagi.
  }
}

/** Peta id panduan -> versi terakhir yang diselesaikan di perangkat ini untuk `email`. */
export function readDone(email: string): Map<string, number> {
  return new Map(Object.entries(readRecord(email)));
}

/** Menggabung `entries` ke catatan yang ada dalam SATU kali tulis; versi tak pernah turun (seperti server). */
export function writeDone(email: string, entries: Record<string, number>): void {
  const record = readRecord(email);
  for (const [id, version] of Object.entries(entries)) {
    record[id] = Math.max(record[id] ?? 0, version);
  }
  writeRecord(email, record);
}

/** Menghapus catatan satu panduan agar dapat diulang. */
export function clearOne(email: string, id: string): void {
  const record = readRecord(email);
  delete record[id];
  writeRecord(email, record);
}
