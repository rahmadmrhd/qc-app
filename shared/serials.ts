import { hasControlChars } from './postel';

export const SERIAL_STATUSES = [
  'good',
  'reported',
  'at_service',
  'diagnosis',
  'service_repair',
  'recheck',
  'broken',
] as const;
export type SerialStatus = (typeof SERIAL_STATUSES)[number];

export const SERIAL_CUSTODIES = ['qc', 'transit', 'service'] as const;
export type SerialCustody = (typeof SERIAL_CUSTODIES)[number];

/** Label status/posisi untuk chip perubahan di riwayat (server) dan tampilan (web memakai teks yang sama). */
export const SERIAL_STATUS_LABELS: Record<SerialStatus, string> = {
  good: 'Lolos',
  reported: 'Dilaporkan',
  at_service: 'Di servis',
  diagnosis: 'Diagnosis',
  service_repair: 'Sedang diperbaiki',
  recheck: 'Menunggu cek ulang',
  broken: 'Rusak',
};
export const SERIAL_CUSTODY_LABELS: Record<SerialCustody, string> = {
  qc: 'Di QC',
  transit: 'Dalam pengiriman',
  service: 'Di servis',
};

export const SERIAL_EVENT_TYPES = [
  'recorded',
  'data_changed',
  'recheck',
  'note',
  'report_failure',
  'identify_damage',
  'attempt_repair',
  'send',
  'receive',
  'service_diagnosis',
  'declare_broken',
  'recheck_pass',
  'recheck_fail',
] as const;
export type SerialEventType = (typeof SERIAL_EVENT_TYPES)[number];

export const SERIAL_LIMITS = {
  serialMax: 64,
  noteMax: 1000,
  messageMax: 5000,
  /** Catatan pengiriman (ekspedisi, nomor resi, atau nama pengantar) pada aksi `send`: satu baris, opsional. */
  shipmentNoteMax: 200,
  inputLines: 1000,
  tableRows: 1000,
  batchRows: 200,
  stickerQtyMax: 99,
  /** Maks. pilihan stiker per baris (server `saveBatch`/`act` dan berkas `.qcsn` memakai batas yang sama). */
  picksMax: 20,
  /**
   * Pencarian banyak serial lewat `serials.list` (GET, jadi masuk URL): maks. serial dan maks. panjang teks setelah
   * percent-encode (`listSerialsEncodedMax`, lihat `listSerialsTooLong`). Menjaga URL di bawah ~4 KB (nginx bawaan
   * `large_client_header_buffers 4 8k`); lebih banyak = paginasi/ekspor.
   */
  listSerialsMax: 50,
  listSerialsEncodedMax: 4000,
  /** Maks. gambar yang boleh disisipkan pada satu pesan kejadian (5b; default perancang OQ-11). */
  messageImagesMax: 10,
  /** Riwayat per serial (`serials.history`): bawaan dan maks. kejadian per halaman. */
  historyDefaultLimit: 50,
  historyMaxLimit: 100,
  /** Maks. penerima surel "rusak" (satu daftar global). */
  alertRecipientsMax: 20,
  /** Tautan bertanda tangan ke halaman publik laporan berlaku sampai tanggal laporan selesai + hari ini (laporan rusak). */
  publicLinkDays: 30,
  /** Maks. panjang ringkasan laporan (baris pertama catatan laporan) pada daftar Laporan. */
  reportSummaryMax: 120,
} as const;

/** Aksi pada `serials.act` (spek §5.3). */
export const SERIAL_ACTIONS = [
  'note',
  'recheck',
  'report_failure',
  'send',
  'receive',
  'service_diagnosis',
  'declare_broken',
  'recheck_pass',
  'recheck_fail',
] as const;
export type SerialAction = (typeof SERIAL_ACTIONS)[number];

/** Tahap pada aksi `service_diagnosis`: pilihan status dialog Diagnosis (Rusak memakai aksi `declare_broken`). */
export const SERVICE_DIAGNOSIS_STAGES = ['diagnosis', 'repairing', 'done'] as const;
export type ServiceDiagnosisStage = (typeof SERVICE_DIAGNOSIS_STAGES)[number];

const WIB_OFFSET_MS = 7 * 3_600_000;

/**
 * Kedaluwarsa tautan bertanda tangan: akhir hari WIB (23:59:59.999, UTC+7) pada `closedOn` (`YYYY-MM-DD`, tanggal
 * laporan selesai) + `SERIAL_LIMITS.publicLinkDays` hari, sebagai epoch milidetik. `NaN` bila `closedOn` bukan tanggal sah.
 */
export function reportLinkExpiresAt(closedOn: string): number {
  if (!isIsoDate(closedOn)) return Number.NaN;
  const [year, month, day] = closedOn.split('-').map(Number) as [number, number, number];
  const endOfDayUtc = Date.UTC(
    year,
    month - 1,
    day + SERIAL_LIMITS.publicLinkDays,
    23,
    59,
    59,
    999,
  );
  return endOfDayUtc - WIB_OFFSET_MS;
}

/** Tim pelaku kejadian (`actor_team`): QC atau tim servis. */
export type SerialTeam = 'qc' | 'service';

/** Nomor kasus tidak lolos: `LP-YYYYMMDD-NNN` (urutan minimal 3 digit; lebih dari 999 menjadi lebih panjang). */
export function serialCaseNumber(dateKey: string, sequence: number): string {
  return `LP-${dateKey}-${String(sequence).padStart(3, '0')}`;
}

/** Kelompok jenis kejadian untuk tab linimasa (`serials.history` `group`). */
export const SERIAL_HISTORY_GROUPS: {
  checks: readonly SerialEventType[];
  changes: readonly SerialEventType[];
} = {
  checks: ['recorded', 'recheck', 'recheck_pass', 'recheck_fail'],
  changes: ['data_changed'],
};

/**
 * Panjang `serials` setelah di-encode untuk URL melebihi batas: karakter non-ASCII/tanda baca membengkak 3-9x.
 * Dihitung KONSERVATIF mengikuti pengirim web (`URLSearchParams`), yang juga meng-encode `! ' ( ) ~` (3 karakter,
 * tidak seperti `encodeURIComponent`) dan spasi/baris baru (3 karakter di sini). Satu sumber untuk server dan web.
 */
export function listSerialsTooLong(text: string): boolean {
  const normalized = text.replace(/\r\n|\r/g, '\n');
  const extra = (normalized.match(/[!'()~]/g) ?? []).length * 2;
  return encodeURIComponent(normalized).length + extra > SERIAL_LIMITS.listSerialsEncodedMax;
}

const MAC_COLON_DASH = /^[0-9A-F]{2}([:-])(?:[0-9A-F]{2}\1){4}[0-9A-F]{2}$/;
const MAC_DOTTED = /^[0-9A-F]{4}\.[0-9A-F]{4}\.[0-9A-F]{4}$/;

/**
 * Bentuk kanonis serial: dipangkas dan huruf besar; alamat MAC lengkap (pemisah seragam `:` atau `-`, atau
 * format titik 4-4-4) kehilangan pemisahnya. Selain itu tidak diubah.
 */
export function normalizeSerial(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (MAC_COLON_DASH.test(upper)) return upper.replace(/[:-]/g, '');
  if (MAC_DOTTED.test(upper)) return upper.replace(/\./g, '');
  return upper;
}

export function serialProblem(normalized: string): 'empty' | 'too_long' | 'control_chars' | null {
  if (normalized === '') return 'empty';
  if (hasControlChars(normalized)) return 'control_chars';
  if ([...normalized].length > SERIAL_LIMITS.serialMax) return 'too_long';
  return null;
}

export interface SplitResult {
  serials: string[];
  duplicates: number;
  rejected: string[];
  truncated: boolean;
}

/** Memecah teks per baris menjadi serial ternormalisasi (urutan pertama dipertahankan), dipotong di `max`. */
export function splitSerialInput(
  text: string,
  max: number = SERIAL_LIMITS.inputLines,
): SplitResult {
  const serials: string[] = [];
  const seen = new Set<string>();
  const rejected: string[] = [];
  let duplicates = 0;
  let truncated = false;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const normalized = normalizeSerial(line);
    if (normalized === '') continue;
    if (serialProblem(normalized) !== null) {
      rejected.push(line.trim());
      continue;
    }
    if (seen.has(normalized)) {
      duplicates++;
      continue;
    }
    if (serials.length >= max) {
      truncated = true;
      continue;
    }
    seen.add(normalized);
    serials.push(normalized);
  }
  return { serials, duplicates, rejected, truncated };
}

/** `YYYY-MM-DD` yang merupakan tanggal kalender sah. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Nama pelaku yang aman ditampilkan di surel dan halaman publik (tanpa alamat surel pengguna, rancangan §4.7/§4.8):
 * akun tanpa nama tersimpan tercatat dengan alamat surelnya sebagai nama, jadi nilai yang memuat "@" diganti bagian
 * lokal sebelum "@". Nama kosong (atau bagian lokal kosong) menjadi "Admin".
 */
export function publicActorName(name: string): string {
  const trimmed = name.trim();
  const shown = trimmed.includes('@') ? (trimmed.split('@')[0] ?? '').trim() : trimmed;
  return shown === '' ? 'Admin' : shown;
}
