import type { PushUserState, PushUserStatusDto } from '@shared/contract';

/** Label status push per pengguna (halaman admin). Hanya status; tanpa pengenal perangkat atau rincian galat. */
export const PUSH_STATE_LABELS: Record<PushUserState, string> = {
  denied: 'Izin ditolak',
  failing: 'Pengiriman gagal',
  none: 'Belum berlangganan',
  disabled: 'Dimatikan pengguna',
  active: 'Aktif',
};

/** Urutan tampil: yang bermasalah dulu agar admin langsung melihatnya. */
export const PUSH_STATE_ORDER: readonly PushUserState[] = [
  'denied',
  'failing',
  'none',
  'disabled',
  'active',
];

export function sortPushStatuses(rows: readonly PushUserStatusDto[]): PushUserStatusDto[] {
  return [...rows].sort(
    (a, b) =>
      PUSH_STATE_ORDER.indexOf(a.state) - PUSH_STATE_ORDER.indexOf(b.state) ||
      a.name.localeCompare(b.name, 'id') ||
      a.email.localeCompare(b.email),
  );
}

/** Pencarian nama atau email (tanpa membedakan huruf besar/kecil); kata kunci kosong = semua. */
export function filterPushStatuses(
  rows: readonly PushUserStatusDto[],
  query: string,
): PushUserStatusDto[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...rows];
  return rows.filter(
    (row) => row.name.toLowerCase().includes(needle) || row.email.toLowerCase().includes(needle),
  );
}

export function countPushStates(rows: readonly PushUserStatusDto[]): Record<PushUserState, number> {
  const counts: Record<PushUserState, number> = {
    denied: 0,
    failing: 0,
    none: 0,
    disabled: 0,
    active: 0,
  };
  for (const row of rows) counts[row.state] += 1;
  return counts;
}
