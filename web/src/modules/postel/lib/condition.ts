import type { PostelCondition, PostelRole } from '@shared/postel';

export const CONDITION_LABEL: Record<PostelCondition, string> = {
  valid: 'Berlaku',
  soon: 'Segera habis',
  expired: 'Kedaluwarsa',
};

export const ROLE_LABEL: Record<PostelRole, string> = {
  active: 'Aktif',
  old: 'Lama',
};

/**
 * Status satu nomor: nomor Aktif selalu disertai kondisinya ("Aktif · Kedaluwarsa"); nomor Lama hanya bila sudah
 * kedaluwarsa ("Lama · Kedaluwarsa"), selain itu cukup "Lama" (nomor Lama tidak diperingatkan).
 */
export function numberStatusLabel(role: PostelRole, condition: PostelCondition): string {
  if (role === 'active') return `${ROLE_LABEL.active} · ${CONDITION_LABEL[condition]}`;
  return condition === 'expired'
    ? `${ROLE_LABEL.old} · ${CONDITION_LABEL.expired}`
    : ROLE_LABEL.old;
}

/** "12 hari", "Hari ini", atau "Lewat 3 hari". */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return 'Hari ini';
  if (daysLeft > 0) return `${daysLeft} hari`;
  return `Lewat ${-daysLeft} hari`;
}

/** Tanggal kalender `YYYY-MM-DD` (WIB, tanpa jam) untuk tampilan; masukan tak sah dikembalikan apa adanya. */
export function formatPostelDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString('id-ID', { dateStyle: 'medium', timeZone: 'UTC' });
}
