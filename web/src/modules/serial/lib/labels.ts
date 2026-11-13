import type { FlowRow, SendLeg } from '@shared/serial-flow';
import type { SerialAction, SerialCustody, SerialEventType, SerialStatus } from '@shared/serials';

export const STATUS_LABEL: Record<SerialStatus, string> = {
  good: 'Lolos',
  failed: 'Tidak lolos',
  qc_repair: 'Perbaikan QC',
  at_service: 'Di servis',
  service_repair: 'Perbaikan servis',
  recheck: 'Cek ulang',
  broken: 'Rusak',
};

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
  report_failure: 'Dilaporkan tidak lolos',
  identify_damage: 'Kerusakan diidentifikasi',
  attempt_repair: 'Perbaikan dicoba',
  send: 'Dikirim',
  receive: 'Diterima',
  service_diagnosis: 'Diagnosis servis',
  declare_broken: 'Dinyatakan rusak',
  recheck_pass: 'Cek ulang lolos',
  recheck_fail: 'Cek ulang tidak lolos',
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

/** Pilihan aksi di kotak "Update baru" (`SerialAction`); kirim/terima memakai `flowRowLabel` (menurut leg). */
export const ACTION_LABEL: Record<SerialAction, string> = {
  note: 'Catatan',
  recheck: 'Cek ulang',
  report_failure: 'Laporkan tidak lolos',
  identify_damage: 'Perbarui kerusakan',
  attempt_repair: 'Mulai perbaikan QC',
  send: 'Kirim',
  receive: 'Terima',
  service_diagnosis: 'Diagnosis servis',
  declare_broken: 'Nyatakan rusak',
  recheck_pass: 'Cek ulang: lolos',
  recheck_fail: 'Cek ulang: tidak lolos',
};

/** Frasa tujuan tiap leg pengiriman: "Kirim ke servis", "Terima di QC", "Dikirim antar lokasi", dst. */
export const LEG_LABEL: Record<SendLeg, string> = {
  to_service: 'ke servis',
  at_service: 'di servis',
  to_qc: 'balik ke QC',
  at_qc: 'di QC',
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
  const phrase = typeof leg === 'string' ? LEG_LABEL[leg as SendLeg] : undefined;
  const base = type === 'send' ? 'Dikirim' : 'Diterima';
  return phrase ? `${base} ${phrase}` : base;
}

/** Tab "Pengecekan"/"Perubahan data" pada linimasa (`serials.history` `group`). */
export const HISTORY_GROUP_LABEL = {
  all: 'Semua',
  checks: 'Pengecekan',
  changes: 'Perubahan data',
} as const;

/** Tahap pada baris tahap di kepala detail; tahap terakhir (Lolos/Rusak) memakai label menurut status. */
export const STEP_ORDER = [
  { key: 'good', label: STATUS_LABEL.good },
  { key: 'failed', label: STATUS_LABEL.failed },
  { key: 'qc_repair', label: STATUS_LABEL.qc_repair },
  { key: 'at_service', label: STATUS_LABEL.at_service },
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

/** Waktu server (ISO) dalam WIB, mis. "12 Nov 2026 14.05". */
export function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '—';
  return date.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  });
}
