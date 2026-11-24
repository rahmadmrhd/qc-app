// Zona WIB (Asia/Jakarta, UTC+7 tetap, tanpa DST): SATU definisi offset dan pemecah waktu untuk semua pemformat tanggal WIB
// (handover, postel, serials, qrcode, skrip rilis, dan sisi server). Murni, tanpa API runtime/DOM.

/** Selisih WIB terhadap UTC dalam milidetik. */
export const WIB_OFFSET_MS = 7 * 3_600_000;

export interface WibParts {
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Bagian-bagian waktu WIB dari epoch milidetik. */
export function wibParts(epochMs: number): WibParts {
  const date = new Date(epochMs + WIB_OFFSET_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}
