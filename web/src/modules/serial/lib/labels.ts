import type { SerialCustody, SerialEventType, SerialStatus } from '@shared/serials';

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
  serial: 'Serial',
  item: 'Item',
  testDate: 'Tanggal uji',
  sample: 'Sample',
  note: 'Catatan',
  location: 'Lokasi',
  stickers: 'Stiker',
};

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
