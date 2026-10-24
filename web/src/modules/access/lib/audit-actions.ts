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
  'customer.create': 'Customer dibuat',
  'customer.rename': 'Customer diganti nama',
  'customer.activate': 'Customer diaktifkan',
  'customer.deactivate': 'Customer dinonaktifkan',
  'handover.create': 'Task serah terima dibuat',
  'handover.update': 'Task serah terima diubah',
  'handover.cancel': 'Task serah terima dibatalkan',
  'handover.check': 'Butir checklist dicentang',
  'handover.uncheck': 'Centang butir checklist dibatalkan',
  'handover.done': 'Task serah terima ditandai selesai',
  'handover.uncancel': 'Task serah terima dibuka kembali (batal dicabut)',
  'handover.comment': 'Komentar serah terima ditambahkan',
  'qrcode.create': 'Label QR dibuat',
  'qrcode.update': 'Label QR diubah',
  'qrcode.delete': 'Label QR dihapus',
  'qrcode.export': 'Label QR diekspor ke Drive',
  'qrcode.pdf_upload': 'PDF sumber label QR diunggah',
  'qrcode.defaults_update': 'Konfigurasi default QR diubah',
  'qrcode.pdf_clone': 'PDF sumber label QR disalin dari Drive',
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
