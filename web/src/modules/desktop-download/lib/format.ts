const NUMBER = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const DATE = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Jakarta',
});
const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** Ukuran berkas dengan koma desimal Indonesia (`1,5 MB`); satuan naik tiap kelipatan 1024. */
export function formatBytes(size: number): string {
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${NUMBER.format(value)} ${UNITS[unit]}`;
}

/** Tanggal terbit dalam bahasa Indonesia menurut zona WIB (`18 November 2026`). */
export function formatPublishedDate(iso: string): string {
  return DATE.format(new Date(iso));
}
