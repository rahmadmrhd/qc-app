import type { Bucket, DashboardRange } from '@shared/dashboard';

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Angka dari hasil agregat (MariaDB dapat mengembalikan `COUNT`/`SUM`/`AVG` sebagai teks atau DECIMAL). */
export function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * SQL hari kalender WIB (`YYYY-MM-DD`) dari kolom waktu ISO UTC (`2026-11-17T17:30:00.000Z`). WIB = UTC+7 tetap:
 * kejadian 17:30 UTC jatuh ke hari berikutnya. `column` HARUS literal kode (alias.kolom), bukan masukan pengguna.
 */
export function wibDaySql(column: string): string {
  return `DATE_FORMAT(DATE_ADD(STR_TO_DATE(LEFT(${column}, 19), '%Y-%m-%dT%H:%i:%s'), INTERVAL 7 HOUR), '%Y-%m-%d')`;
}

/** SQL waktu (DATETIME UTC) dari kolom waktu ISO UTC, untuk selisih waktu. */
export function utcDateTimeSql(column: string): string {
  return `STR_TO_DATE(LEFT(${column}, 19), '%Y-%m-%dT%H:%i:%s')`;
}

/** Klausa `kolom IN (?, ?, ...)` beserta nilainya; `values` TIDAK boleh kosong (pemanggil menangani kasus kosong). */
export function inClause(
  column: string,
  values: readonly string[],
): { sql: string; binds: string[] } {
  return { sql: `${column} IN (${values.map(() => '?').join(', ')})`, binds: [...values] };
}

function ms(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

function dayString(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10);
}

function dayLabel(day: string): string {
  return `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
}

/** Kunci bucket tempat satu hari WIB (`YYYY-MM-DD`) jatuh: hari itu sendiri, Senin pekan itu, atau `YYYY-MM`. */
export function bucketKeyOf(day: string, bucket: Bucket): string {
  if (bucket === 'day') return day;
  if (bucket === 'month') return day.slice(0, 7);
  const epoch = ms(day);
  const weekday = new Date(epoch).getUTCDay();
  return dayString(epoch - ((weekday + 6) % 7) * DAY_MS);
}

function bucketLabel(key: string, bucket: Bucket): string {
  if (bucket === 'month') return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  return dayLabel(key);
}

/** Semua bucket (urut naik) yang menyentuh `range`, termasuk yang kosong. Pekan dimulai Senin; label pekan = tanggal Senin. */
export function bucketKeys(
  range: DashboardRange,
  bucket: Bucket,
): { key: string; label: string }[] {
  const keys: string[] = [];
  const last = ms(range.to);
  for (let epoch = ms(range.from); epoch <= last; epoch += DAY_MS) {
    const key = bucketKeyOf(dayString(epoch), bucket);
    if (keys[keys.length - 1] !== key) keys.push(key);
  }
  return keys.map((key) => ({ key, label: bucketLabel(key, bucket) }));
}

/**
 * Nilai per bucket dari baris harian `{ day, n }` (hasil `GROUP BY` hari WIB). Bucket tanpa baris = 0; baris di luar
 * `points` diabaikan.
 */
export function fillSeries(
  points: readonly { key: string }[],
  rows: readonly { day: string; n: unknown }[],
  bucket: Bucket,
): number[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = bucketKeyOf(row.day, bucket);
    totals.set(key, (totals.get(key) ?? 0) + num(row.n));
  }
  return points.map((point) => totals.get(point.key) ?? 0);
}
