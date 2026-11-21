// Tautan entri Log Audit ke entitasnya (keputusan pemilik 2026-11-20, redesain §5 butir 20). Murni.
//
// `audit_log.target_id` diisi penulis audit untuk entitas ber-View; jenis entitas TIDAK disimpan, melainkan diturunkan
// dari awalan `action` lewat peta tunggal di sini. Entri lama (tanpa `target_id`) dan aksi tanpa entitas (pengaturan,
// pustaka, ekspor) tidak memuat `targetRef`.

export type AuditTargetKind =
  | 'item'
  | 'brand'
  | 'customer'
  | 'sticker'
  | 'stickerType'
  | 'qrDesign'
  | 'qrPreset'
  | 'postel'
  | 'user'
  | 'role'
  | 'location'
  | 'businessUnit'
  | 'serial'
  | 'handover';

/**
 * Jenis entitas yang riwayatnya dibaca lewat `activity.list` (panel aktivitas View). Serial TIDAK termasuk: riwayatnya
 * `serial_events` (`serials.history`).
 */
export type ActivityKind = Exclude<AuditTargetKind, 'serial'>;

export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'item',
  'brand',
  'customer',
  'sticker',
  'stickerType',
  'qrDesign',
  'qrPreset',
  'postel',
  'user',
  'role',
  'location',
  'businessUnit',
  'handover',
];

/** Awalan aksi (sebelum titik pertama) -> jenis entitas. Awalan BU memang `businessunit` (huruf kecil semua). */
const PREFIX_KINDS: Readonly<Record<string, AuditTargetKind>> = {
  item: 'item',
  brand: 'brand',
  customer: 'customer',
  sticker: 'sticker',
  stickerType: 'stickerType',
  qrcode: 'qrDesign',
  postel: 'postel',
  user: 'user',
  role: 'role',
  location: 'location',
  businessunit: 'businessUnit',
  serial: 'serial',
  handover: 'handover',
};

/**
 * Aksi berawalan entitas yang BUKAN perubahan satu entitas ber-View (pengaturan global, pustaka, dokumen PDF QR):
 * tidak membawa `target_id` dan tidak punya `targetRef`.
 */
export const AUDIT_NON_ENTITY_ACTIONS: ReadonlySet<string> = new Set([
  'sticker.settings',
  'postel.settings',
  'serial.settings',
  'serial.service_locations',
  'qrcode.logo_library_update',
  'qrcode.pdf_upload',
  'qrcode.pdf_clone',
]);

/** Jenis entitas yang diubah oleh `action`, atau `undefined` bila aksi itu tak menaut ke entitas ber-View. */
export function auditTargetKind(action: string): AuditTargetKind | undefined {
  if (AUDIT_NON_ENTITY_ACTIONS.has(action)) return undefined;
  const dot = action.indexOf('.');
  if (dot <= 0) return undefined;
  const prefix = action.slice(0, dot);
  if (prefix === 'qrcode' && action.slice(dot + 1).startsWith('preset_')) return 'qrPreset';
  return PREFIX_KINDS[prefix];
}
