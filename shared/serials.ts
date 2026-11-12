import { hasControlChars } from './postel';

export const SERIAL_STATUSES = [
  'good',
  'failed',
  'qc_repair',
  'at_service',
  'service_repair',
  'recheck',
  'broken',
] as const;
export type SerialStatus = (typeof SERIAL_STATUSES)[number];

export const SERIAL_CUSTODIES = ['qc', 'transit', 'service'] as const;
export type SerialCustody = (typeof SERIAL_CUSTODIES)[number];

export const SERIAL_EVENT_TYPES = [
  'recorded',
  'data_changed',
  'recheck',
  'note',
  'report_failure',
  'identify_damage',
  'attempt_repair',
  'send',
  'receive',
  'service_diagnosis',
  'declare_broken',
  'recheck_pass',
  'recheck_fail',
] as const;
export type SerialEventType = (typeof SERIAL_EVENT_TYPES)[number];

export const SERIAL_LIMITS = {
  serialMax: 64,
  noteMax: 1000,
  messageMax: 5000,
  inputLines: 1000,
  tableRows: 1000,
  batchRows: 200,
  stickerQtyMax: 99,
} as const;

const MAC_COLON_DASH = /^[0-9A-F]{2}([:-])(?:[0-9A-F]{2}\1){4}[0-9A-F]{2}$/;
const MAC_DOTTED = /^[0-9A-F]{4}\.[0-9A-F]{4}\.[0-9A-F]{4}$/;

/**
 * Bentuk kanonis serial: dipangkas dan huruf besar; alamat MAC lengkap (pemisah seragam `:` atau `-`, atau
 * format titik 4-4-4) kehilangan pemisahnya. Selain itu tidak diubah.
 */
export function normalizeSerial(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (MAC_COLON_DASH.test(upper)) return upper.replace(/[:-]/g, '');
  if (MAC_DOTTED.test(upper)) return upper.replace(/\./g, '');
  return upper;
}

export function serialProblem(normalized: string): 'empty' | 'too_long' | 'control_chars' | null {
  if (normalized === '') return 'empty';
  if (hasControlChars(normalized)) return 'control_chars';
  if ([...normalized].length > SERIAL_LIMITS.serialMax) return 'too_long';
  return null;
}

export interface SplitResult {
  serials: string[];
  duplicates: number;
  rejected: string[];
  truncated: boolean;
}

/** Memecah teks per baris menjadi serial ternormalisasi (urutan pertama dipertahankan), dipotong di `max`. */
export function splitSerialInput(
  text: string,
  max: number = SERIAL_LIMITS.inputLines,
): SplitResult {
  const serials: string[] = [];
  const seen = new Set<string>();
  const rejected: string[] = [];
  let duplicates = 0;
  let truncated = false;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const normalized = normalizeSerial(line);
    if (normalized === '') continue;
    if (serialProblem(normalized) !== null) {
      rejected.push(line.trim());
      continue;
    }
    if (seen.has(normalized)) {
      duplicates++;
      continue;
    }
    if (serials.length >= max) {
      truncated = true;
      continue;
    }
    seen.add(normalized);
    serials.push(normalized);
  }
  return { serials, duplicates, rejected, truncated };
}

/** `YYYY-MM-DD` yang merupakan tanggal kalender sah. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
