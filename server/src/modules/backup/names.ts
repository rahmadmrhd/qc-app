/**
 * Nama berkas cadangan dan waktu WIB. Satu-satunya tempat yang menafsirkan `qc-backup-YYYYMMDD-HHmm.sql.gz`:
 * dipakai pembuat nama, retensi, peringatan basi, dan pemulihan (waktu di nama = WIB, UTC+7 tanpa DST).
 */
import { WIB_OFFSET_MS } from '@shared/wib';

const NAME_PATTERN = /^qc-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.sql\.gz$/;

export interface ParsedBackupName {
  /** `YYYYMMDD` (WIB). */
  date: string;
  /** `YYYYMMDDHHmm` (WIB), urut leksikografis = urut waktu. */
  key: string;
  /** Epoch milidetik (UTC) dari waktu WIB di nama. */
  epochMs: number;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Komponen kalender WIB dari epoch UTC. */
function wibParts(ms: number): { y: number; m: number; d: number; h: number; min: number } {
  const date = new Date(ms + WIB_OFFSET_MS);
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    h: date.getUTCHours(),
    min: date.getUTCMinutes(),
  };
}

/** `YYYYMMDD` menurut WIB. */
export function wibDate(ms: number): string {
  const { y, m, d } = wibParts(ms);
  return `${pad(y, 4)}${pad(m, 2)}${pad(d, 2)}`;
}

/** Jam (0-23) menurut WIB. */
export function wibHour(ms: number): number {
  return wibParts(ms).h;
}

export function backupName(ms: number): string {
  const { h, min } = wibParts(ms);
  return `qc-backup-${wibDate(ms)}-${pad(h, 2)}${pad(min, 2)}.sql.gz`;
}

/** `null` bila bukan nama cadangan buatan kita atau tanggal/jamnya mustahil. */
export function parseBackupName(name: string): ParsedBackupName | null {
  const match = NAME_PATTERN.exec(name);
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number) as [number, number, number, number, number, number];
  const utc = Date.UTC(y, m - 1, d, h, min);
  const check = new Date(utc);
  if (
    h > 23 ||
    min > 59 ||
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  ) {
    return null;
  }
  return {
    date: `${pad(y, 4)}${pad(m, 2)}${pad(d, 2)}`,
    key: `${pad(y, 4)}${pad(m, 2)}${pad(d, 2)}${pad(h, 2)}${pad(min, 2)}`,
    epochMs: utc - WIB_OFFSET_MS,
  };
}

/** Epoch (UTC) pukul `hour`:00 WIB pada tanggal `YYYYMMDD` (bawaan 02:00, jam cadangan terjadwal). */
export function wibDateEpoch(date: string, hour = 2): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(4, 6));
  const d = Number(date.slice(6, 8));
  return Date.UTC(y, m - 1, d, hour) - WIB_OFFSET_MS;
}

/** Kunci pekan ISO 8601 (`YYYY-Www`) dari `YYYYMMDD`. */
export function isoWeekKey(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(4, 6));
  const d = Number(date.slice(6, 8));
  const day = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = day.getUTCDay() || 7; // Senin = 1 .. Minggu = 7
  day.setUTCDate(day.getUTCDate() + 4 - dayOfWeek); // Kamis pekan itu menentukan tahun ISO
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${pad(week, 2)}`;
}
