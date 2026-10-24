/** Zona proyek (`appsscript.json`): WIB = UTC+7, tanpa DST. Tanggal tanpa zona ditafsirkan WIB. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISO_VARIANT =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const LOOSE_DATE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

export interface ParsedDate {
  iso: string;
  /** `null` bila sudah bentuk kanonis (`toISOString`). */
  rule: string | null;
}

function build(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millis: number,
  offsetMs: number,
): string | null {
  if (year < 1990 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const local = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  const check = new Date(local);
  // Tanggal mustahil (30 Februari) bergulir ke bulan berikutnya: tolak.
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return new Date(local - offsetMs).toISOString();
}

/**
 * Mengenali format tanggal yang dikenal dan menormalkannya ke ISO 8601 UTC. `null` = tak terbaca.
 * Format: ISO kanonis; ISO dengan/ tanpa zona (tanpa zona = WIB); `YYYY-M-D`, `YYYY/M/D`, `YYYY.M.D`
 * dengan jam opsional (tanpa jam = 00:00 WIB). Format ambigu seperti `5/10/2026` TIDAK dikenali.
 */
export function parseSheetDate(input: string): ParsedDate | null {
  const text = input.trim();
  if (CANONICAL_ISO.test(text)) {
    return Number.isNaN(Date.parse(text)) ? null : { iso: text, rule: null };
  }
  const iso = ISO_VARIANT.exec(text);
  if (iso) {
    const [, y, mo, d, h, mi, s, frac, zone] = iso;
    let offsetMs = WIB_OFFSET_MS;
    if (zone !== undefined) {
      if (zone.toUpperCase() === 'Z') offsetMs = 0;
      else {
        const sign = zone.startsWith('-') ? -1 : 1;
        const digits = zone.slice(1).replace(':', '');
        offsetMs = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60000;
      }
    }
    const millis = frac === undefined ? 0 : Number(frac.padEnd(3, '0').slice(0, 3));
    const out = build(
      Number(y),
      Number(mo),
      Number(d),
      Number(h),
      Number(mi),
      Number(s ?? 0),
      millis,
      offsetMs,
    );
    return out === null
      ? null
      : { iso: out, rule: zone === undefined ? 'tanggal-wib-ke-utc' : 'tanggal-iso' };
  }
  const loose = LOOSE_DATE.exec(text);
  if (loose) {
    const [, y, mo, d, h, mi, s] = loose;
    const out = build(
      Number(y),
      Number(mo),
      Number(d),
      Number(h ?? 0),
      Number(mi ?? 0),
      Number(s ?? 0),
      0,
      WIB_OFFSET_MS,
    );
    return out === null ? null : { iso: out, rule: 'tanggal-wib-ke-utc' };
  }
  return null;
}
