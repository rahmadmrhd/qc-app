import { isoWeekKey, parseBackupName } from './names';

/** Harian: berkas terbaru dari 7 hari TERBARU yang punya berkas. */
export const BACKUP_KEEP_DAILY = 7;
/** Mingguan: berkas terbaru dari tiap pekan ISO pada 4 pekan terbaru di luar jendela harian. */
export const BACKUP_KEEP_WEEKLY = 4;
/** Pengaman: salinan yang tersisa tidak pernah kurang dari ini (di bawahnya tidak ada yang dihapus). */
export const BACKUP_MIN_KEEP = 3;

/**
 * Retensi cadangan (fungsi murni): mengembalikan entri yang BOLEH dihapus. Berbasis jumlah, bukan umur: tidak
 * bergantung pada jam sekarang, jadi unggahan yang berhenti berbulan-bulan tidak menghabiskan cadangan. Hanya nama
 * `qc-backup-YYYYMMDD-HHmm.sql.gz` yang dihitung dan dapat dihapus; nama lain tidak pernah disentuh. Nama kembar
 * dipertahankan bersama (kunci pertahanan = nama). Bila salinan yang tersisa akan kurang dari `BACKUP_MIN_KEEP`,
 * tidak ada yang dihapus.
 */
export function selectBackupsToDelete<T extends { name: string }>(entries: T[]): T[] {
  const recognized = entries
    .flatMap((entry) => {
      const parsed = parseBackupName(entry.name);
      return parsed === null ? [] : [{ entry, parsed }];
    })
    .sort((a, b) => (a.parsed.key < b.parsed.key ? 1 : a.parsed.key > b.parsed.key ? -1 : 0));
  if (recognized.length === 0) return [];

  // Terbaru per hari (urutan menurun: kemunculan pertama = terbaru).
  const newestPerDay = new Map<string, string>();
  for (const { entry, parsed } of recognized) {
    if (!newestPerDay.has(parsed.date)) newestPerDay.set(parsed.date, entry.name);
  }
  const days = [...newestPerDay.keys()]; // menurun
  const keep = new Set<string>();
  for (const day of days.slice(0, BACKUP_KEEP_DAILY)) keep.add(newestPerDay.get(day) as string);

  // Mingguan: dari hari-hari di luar jendela harian, terbaru per pekan ISO, 4 pekan terbaru.
  const newestPerWeek = new Map<string, string>();
  for (const day of days.slice(BACKUP_KEEP_DAILY)) {
    const week = isoWeekKey(day);
    if (!newestPerWeek.has(week)) newestPerWeek.set(week, newestPerDay.get(day) as string);
  }
  for (const name of [...newestPerWeek.values()].slice(0, BACKUP_KEEP_WEEKLY)) keep.add(name);

  if (keep.size < BACKUP_MIN_KEEP) return [];
  return recognized.filter(({ entry }) => !keep.has(entry.name)).map(({ entry }) => entry);
}
