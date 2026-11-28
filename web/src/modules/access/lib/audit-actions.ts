/** Label aksi audit untuk tampilan; kunci harus sama dengan `action` yang ditulis `access/service.ts`. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'user.create': 'User dibuat',
  'user.update': 'User diubah',
  'user.activate': 'User diaktifkan',
  'user.deactivate': 'User dinonaktifkan',
  'user.delete': 'User dihapus',
  'user.restore': 'User dipulihkan',
  'role.create': 'Role dibuat',
  'role.update': 'Role diubah',
  'role.delete': 'Role dihapus',
  'role.restore': 'Role dipulihkan',
  'location.create': 'Lokasi dibuat',
  'location.update': 'Lokasi diubah',
  'location.activate': 'Lokasi diaktifkan',
  'location.deactivate': 'Lokasi dinonaktifkan',
  'location.delete': 'Lokasi dihapus',
  'location.restore': 'Lokasi dipulihkan',
  'businessunit.create': 'Business Unit dibuat',
  'businessunit.update': 'Business Unit diubah',
  'businessunit.activate': 'Business Unit diaktifkan',
  'businessunit.deactivate': 'Business Unit dinonaktifkan',
  'businessunit.delete': 'Business Unit dihapus',
  'businessunit.restore': 'Business Unit dipulihkan',
  'brand.create': 'Merk dibuat',
  'brand.update': 'Merk diubah',
  'brand.activate': 'Merk diaktifkan',
  'brand.deactivate': 'Merk dinonaktifkan',
  'brand.delete': 'Merk dihapus',
  'brand.restore': 'Merk dipulihkan',
  'brand.sync.conflict': 'Konflik sinkronisasi merk',
  'item.sync.conflict': 'Konflik sinkronisasi item',
  'customer.create': 'Customer dibuat',
  'customer.rename': 'Customer diganti nama',
  'customer.activate': 'Customer diaktifkan',
  'customer.deactivate': 'Customer dinonaktifkan',
  'customer.delete': 'Customer dihapus',
  'customer.restore': 'Customer dipulihkan',
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
  'qrcode.restore': 'Label QR dipulihkan',
  'qrcode.export': 'Label QR diekspor ke Drive',
  'qrcode.pdf_upload': 'PDF sumber label QR diunggah',
  'qrcode.defaults_update': 'Konfigurasi default QR diubah',
  'qrcode.pdf_clone': 'PDF sumber label QR disalin dari Drive',
  'qrcode.preset_create': 'Preset QR dibuat',
  'qrcode.preset_update': 'Preset QR diubah',
  'qrcode.preset_delete': 'Preset QR dihapus',
  'qrcode.preset_restore': 'Preset QR dipulihkan',
  'qrcode.preset_clone': 'Preset QR dikloning',
  'qrcode.logo_library_update': 'Pustaka logo QR diubah',
  'sticker.create': 'Stiker dibuat',
  'sticker.update': 'Stiker diubah',
  'sticker.status': 'Status stiker diubah',
  'sticker.delete': 'Stiker dihapus',
  'sticker.restore': 'Stiker dipulihkan',
  'sticker.settings': 'Konfigurasi stiker diubah',
  'stickerType.create': 'Jenis stiker dibuat',
  'stickerType.update': 'Jenis stiker diubah',
  'stickerType.status': 'Status jenis stiker diubah',
  'stickerType.delete': 'Jenis stiker dihapus',
  'stickerType.restore': 'Jenis stiker dipulihkan',
  'stickerGuide.rename': 'Gambar pustaka stiker diganti nama',
  'stickerGuide.remove': 'Gambar pustaka stiker dihapus',
  'postel.create': 'Postel dibuat',
  'postel.update': 'Postel diubah',
  'postel.delete': 'Postel dihapus',
  'postel.restore': 'Postel dipulihkan',
  'postel.settings': 'Konfigurasi Postel diubah',
  'item.create': 'Item dibuat',
  'item.update': 'Item diubah',
  'item.activate': 'Item diaktifkan',
  'item.deactivate': 'Item dinonaktifkan',
  'item.delete': 'Item dihapus',
  'item.restore': 'Item dipulihkan',
  'handover.delete': 'Task serah terima dihapus',
  'handover.restore': 'Task serah terima dipulihkan',
  'serial.delete': 'Serial Number dihapus',
  'serial.restore': 'Serial Number dipulihkan',
  'serial.settings': 'Pengaturan Serial Number diubah',
  'serial.service_locations': 'Lokasi tim servis diubah',
  'serial.proof_remove': 'Foto bukti Serial Number dihapus',
  'serial.proof_reupload': 'Foto bukti Serial Number diunggah ulang',
  'serial.proof_retention': 'Foto bukti gagal dibuang otomatis',
  'serialwh.dispatch_create': 'Penjualan Gudang dicatat',
  'serialwh.dispatch_done': 'Penjualan Gudang selesai',
  'serialwh.dispatch_cancel': 'Penjualan Gudang dibatalkan otomatis',
  'serialwh.ready_create': 'Ready Stock dicatat',
  'serialwh.ready_done': 'Ready Stock selesai',
  'serialwh.links_update': 'Tautan task SO diubah',
  'export.sheets': 'Data diekspor ke Sheets',
  'dashboard.share_create': 'Tautan dashboard dibuat',
  'dashboard.share_update': 'Tautan dashboard diubah',
  'dashboard.share_revoke': 'Tautan dashboard dicabut',
  'dashboard.share_expire': 'Tautan dashboard kedaluwarsa',
  'dashboard.report_create': 'Laporan terjadwal dibuat',
  'dashboard.report_update': 'Laporan terjadwal diubah',
  'dashboard.report_delete': 'Laporan terjadwal dihapus',
  'dashboard.report_pause': 'Laporan terjadwal dijeda',
  'dashboard.report_resume': 'Laporan terjadwal dilanjutkan',
  'dashboard.report_send_test': 'Surel uji laporan terjadwal dikirim',
};

/**
 * Label nama field snapshot audit (kunci snapshot dari `*Snapshot` server). Dipakai tampilan selisih Log Audit dan
 * panel aktivitas View (yang hanya menampilkan NAMA field, tanpa nilai); kunci tak dikenal tampil apa adanya.
 */
const AUDIT_FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  name: 'Nama',
  status: 'Status',
  roleIds: 'Role',
  description: 'Deskripsi',
  permissions: 'Akses per modul',
  code: 'Kode',
  assignments: 'Penugasan',
  buAssignments: 'Penugasan BU',
  sharedAccount: 'Akun bersama',
  brand: 'Merk',
  model: 'Tipe',
  businessUnits: 'Business Unit',
  isCountryLock: 'Country lock',
  firmware: 'Firmware',
  proofRequired: 'Wajib foto',
  proofMin: 'Minimum foto',
  aliases: 'Nama lain',
  alias: 'Alias',
  stickers: 'Stiker',
  stickerPhotos: 'Instruksi stiker',
  accessories: 'Kelengkapan',
  attachments: 'Gambar lampiran',
  detailLength: 'Panjang detail (karakter)',
  detailHash: 'Isi detail',
  number: 'Nomor',
  numbers: 'Nomor',
  items: 'Item',
  location: 'Lokasi',
  customer: 'Customer',
  note: 'Catatan',
  item: 'Tipe',
  checked: 'Butir tercentang',
  resets: 'Centang direset',
  quote: 'Kutipan',
  comment: 'Komentar',
  type: 'Jenis',
  rule: 'Aturan',
  fileId: 'Gambar',
  minQty: 'Minimum stok',
  defaultMinQty: 'Minimum stok bawaan',
  openingStock: 'Total stok awal',
  openingStocks: 'Stok awal per lokasi',
  // Entri audit lama (sebelum 2026-11-26) mencatat id lokasi mentah.
  openingStockLocation: 'Lokasi stok awal',
  presetId: 'Preset',
  buId: 'Business Unit',
  title: 'Judul',
  subtitle: 'Subjudul',
  footer: 'Footer',
  linkSource: 'Sumber link',
  link: 'Tautan',
  logo: 'Logo',
  defaultLogoId: 'Logo bawaan',
  layout: 'Tata letak',
  frame: 'Bingkai',
  style: 'Gaya',
  namePlacement: 'Letak nama',
  enabled: 'Aktif',
  schedule: 'Jadwal',
  period: 'Periode',
  widgets: 'Widget',
  buCount: 'Jumlah BU',
  locationCount: 'Jumlah lokasi',
  locationFiltered: 'Pembatasan lokasi',
  recipientCount: 'Jumlah penerima',
  recipientsMark: 'Daftar penerima',
  linkDays: 'Masa berlaku tautan',
  dispatchId: 'Pengeluaran',
  dispatchedOn: 'Tanggal keluar',
  itemId: 'Tipe',
  serialTotal: 'Jumlah serial',
  serialCount: 'Serial Number masuk',
  createdCount: 'Serial baru',
  skippedCount: 'Serial dilewati',
  newOrder: 'SO baru',
};

export function auditFieldLabel(key: string): string {
  return AUDIT_FIELD_LABELS[key] ?? key;
}

/** Aksi Keluar Gudang yang berbagi kunci antara mode SO dan ready; label ready dipilih menurut jenis/target. */
const READY_ACTION_LABELS: Record<string, string> = {
  'serialwh.dispatch_cancel': 'Ready Stock dibatalkan otomatis',
};

/** Label untuk catatan Gudang (mode note) pada aksi yang kuncinya dipakai bersama mode SO. */
const NOTE_ACTION_LABELS: Record<string, string> = {
  'serialwh.dispatch_create': 'Catatan Gudang dicatat',
  'serialwh.dispatch_done': 'Catatan Gudang selesai',
  'serialwh.dispatch_cancel': 'Catatan Gudang dibatalkan otomatis',
};

/**
 * Label aksi audit. `context` (jenis aktivitas `warehouseReady` atau target jejak berawalan "Ready ") memilih label
 * mode ready untuk aksi yang kuncinya dipakai bersama mode SO.
 */
export function auditActionLabel(
  action: string,
  context?: { kind?: string; target?: string; note?: boolean },
): string {
  if (context?.note === true || context?.target?.startsWith('Catatan ') === true) {
    const label = NOTE_ACTION_LABELS[action];
    if (label) return label;
  }
  const ready =
    context?.kind === 'warehouseReady' || context?.target?.startsWith('Ready ') === true;
  if (ready) {
    const label = READY_ACTION_LABELS[action];
    if (label) return label;
  }
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function formatAuditTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '—';
  // Tampilan audit memakai detik; zona WIB seperti semua waktu sistem lain.
  return date.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Jakarta',
  });
}
