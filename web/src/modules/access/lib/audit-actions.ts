/** Label aksi audit untuk tampilan; kunci harus sama dengan `action` yang ditulis `access/service.ts`. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'user.create': 'User dibuat',
  'user.update': 'User diubah',
  'user.activate': 'User diaktifkan',
  'user.deactivate': 'User dinonaktifkan',
  'role.create': 'Role dibuat',
  'role.update': 'Role diubah',
  'role.delete': 'Role dihapus',
  'location.create': 'Lokasi dibuat',
  'location.update': 'Lokasi diubah',
  'location.activate': 'Lokasi diaktifkan',
  'location.deactivate': 'Lokasi dinonaktifkan',
  'brand.create': 'Merk dibuat',
  'brand.update': 'Merk diubah',
  'brand.activate': 'Merk diaktifkan',
  'brand.deactivate': 'Merk dinonaktifkan',
  'brand.sync.conflict': 'Konflik sinkronisasi merk',
  'item.sync.conflict': 'Konflik sinkronisasi item',
  'item.create': 'Item dibuat',
  'item.update': 'Item diubah',
  'item.activate': 'Item diaktifkan',
  'item.deactivate': 'Item dinonaktifkan',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function formatAuditTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '—';
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' });
}
