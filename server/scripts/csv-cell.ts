// Sel CSV untuk laporan skrip operator. Nilai berasal dari data pengguna (serial, nama, catatan) dan laporan dibuka di
// spreadsheet: awalan `=`, `+`, `-`, `@`, tab, atau CR dinetralkan dengan awalan tanda kutip tunggal (injeksi rumus).
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
