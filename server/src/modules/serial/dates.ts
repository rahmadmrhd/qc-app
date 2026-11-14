/** Selisih hari kalender `from` -> `to` (`YYYY-MM-DD`), tak pernah negatif; `null` bila `from` tak berbentuk tanggal. */
export function daysBetween(from: string, to: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!a || !b) return null;
  const start = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const end = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.max(0, Math.round((end - start) / 86_400_000));
}
