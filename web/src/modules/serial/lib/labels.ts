import type { FlowRow, SendLeg } from '@shared/serial-flow';
import {
  SERIAL_STATUS_LABELS,
  type SerialAction,
  type SerialCustody,
  type SerialEventType,
  type SerialStatus,
} from '@shared/serials';

export const STATUS_LABEL: Record<SerialStatus, string> = SERIAL_STATUS_LABELS;

/** Posisi fisik serial: di tangan QC, dalam pengiriman, atau di servis. */
export const CUSTODY_LABEL: Record<SerialCustody, string> = {
  qc: 'Di QC',
  transit: 'Dalam pengiriman',
  service: 'Di servis',
};

export const EVENT_LABEL: Record<SerialEventType, string> = {
  recorded: 'Dicatat',
  data_changed: 'Data diubah',
  recheck: 'Cek ulang',
  note: 'Catatan',
  report_failure: 'Dilaporkan rusak',
  // Dua jenis berikut tidak punya penulis lagi; tetap dirender untuk riwayat lama.
  identify_damage: 'Kerusakan diidentifikasi',
  attempt_repair: 'Perbaikan dicoba',
  send: 'Dikirim',
  receive: 'Diterima',
  service_diagnosis: 'Diagnosis',
  declare_broken: 'Dinyatakan rusak',
  recheck_pass: 'Cek ulang lolos',
  recheck_fail: 'Cek ulang tidak lolos',
  stickers_applied: 'Stiker ditempel',
};

/** Nama field pada chip perubahan (`SerialChangeDto.field`). */
export const FIELD_LABEL: Record<string, string> = {
  status: 'Status',
  custody: 'Posisi',
  damage: 'Kerusakan',
  serial: 'Serial',
  item: 'Item',
  testDate: 'Tanggal uji',
  sample: 'Sample',
  note: 'Catatan',
  location: 'Lokasi',
  stickers: 'Stiker',
};

/** Label tombol aksi di baris Riwayat (`SerialAction`); kirim/terima memakai `flowRowLabel` (menurut leg). */
export const ACTION_LABEL: Record<SerialAction, string> = {
  note: 'Catatan',
  recheck: 'Cek ulang',
  report_failure: 'Lapor rusak',
  send: 'Kirim',
  receive: 'Terima',
  service_diagnosis: 'Diagnosis',
  declare_broken: 'Nyatakan rusak',
  recheck_pass: 'Cek ulang: lolos',
  recheck_fail: 'Cek ulang: tidak lolos',
  apply_stickers: 'Tempel stiker',
};

/**
 * Frasa tujuan tiap leg pengiriman: "Kirim ke servis", "Terima di QC", dst. `to_qc`/`between` tidak punya penulis
 * lagi, tetapi kejadian lama dengan leg itu tetap dirender (rancangan laporan rusak §4.9).
 */
export const LEG_LABEL: Record<SendLeg | 'to_qc' | 'between', string> = {
  to_service: 'ke servis',
  at_service: 'di servis',
  at_qc: 'di QC',
  to_qc: 'balik ke QC',
  between: 'antar lokasi',
};

/** Label tombol/pilihan aksi untuk satu baris tabel transisi (kirim/terima mengikuti leg). */
export function flowRowLabel(row: Pick<FlowRow, 'action' | 'leg'>): string {
  if ((row.action === 'send' || row.action === 'receive') && row.leg) {
    return `${ACTION_LABEL[row.action]} ${LEG_LABEL[row.leg]}`;
  }
  return ACTION_LABEL[row.action];
}

/** Judul kartu riwayat untuk kejadian kirim/terima (menurut `data.leg`). */
export function legEventLabel(type: 'send' | 'receive', leg: unknown): string {
  const phrase = typeof leg === 'string' ? (LEG_LABEL as Record<string, string>)[leg] : undefined;
  const base = type === 'send' ? 'Dikirim' : 'Diterima';
  return phrase ? `${base} ${phrase}` : base;
}

/**
 * Nama pilihan filter Riwayat (`serials.history` `group`): sumber tunggal untuk label tombol dan butir menu
 * (`TimelineSection`); label tombol mengikuti pilihan aktif.
 */
export const HISTORY_GROUP_LABEL = {
  all: 'Semua Riwayat',
  checks: 'Riwayat Pengecekan',
  changes: 'Riwayat Perubahan Data',
} as const;

/** "N hari" untuk durasi laporan (angka negatif dari selisih tanggal dibulatkan ke 0). */
export function daysSpan(days: number): string {
  return `${Math.max(0, days)} hari`;
}

/** Tahap pada baris tahap di kepala detail; tahap terakhir (Lolos/Rusak) memakai label menurut status. */
export const STEP_ORDER = [
  { key: 'good', label: STATUS_LABEL.good },
  { key: 'reported', label: STATUS_LABEL.reported },
  { key: 'at_service', label: STATUS_LABEL.at_service },
  { key: 'diagnosis', label: STATUS_LABEL.diagnosis },
  { key: 'service_repair', label: STATUS_LABEL.service_repair },
  { key: 'recheck', label: STATUS_LABEL.recheck },
  { key: 'final', label: 'Lolos / Rusak' },
] as const;

export const TEAM_LABEL = { qc: 'QC', service: 'Servis', system: 'Sistem' } as const;

export const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as SerialStatus[]).map((value) => ({
  value,
  label: STATUS_LABEL[value],
}));

/** `YYYY-MM-DD` -> "12 Nov 2026" (kalender murni, tanpa zona). */
export function formatDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString('id-ID', { dateStyle: 'medium', timeZone: 'UTC' });
}

export { formatStamp } from '@/lib/format-stamp';
