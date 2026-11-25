/**
 * Laporan dashboard terjadwal lewat surel (spek dashboard bagian 7a): batas, jadwal, periode relatif, kunci periode,
 * dan DTO kontrak. Semua waktu WIB (UTC+7). Murni, tanpa API runtime/DOM.
 */
import type { DashboardFilterInput, DashboardRange } from './dashboard';
import type { DashboardShareDto, ShareWidgetScope } from './dashboard-share';

const DAY_MS = 86_400_000;
const WIB_OFFSET_MS = 7 * 3_600_000;

export const REPORT_LIMITS = {
  widgetsMax: 12,
  perOwner: 20,
  recipientsMax: 20,
  nameMax: 120,
  /**
   * Maksimal BU atau lokasi pada satu laporan yang disimpan. Lebih longgar dari `FILTER_LIST_MAX` (20, batas filter
   * yang diketik pengguna) karena isinya himpunan beku hak pemilik; hasil akhir tetap diiris hak pemilik saat kirim.
   */
  scopeIdsMax: 200,
  linkDaysMax: 365,
  linkDaysDefault: 14,
  /** Kirim uji per jam per pemilik. */
  testPerHour: 5,
} as const;

export const REPORT_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];

export const REPORT_FREQUENCY_LABELS: Record<ReportFrequency, string> = {
  daily: 'Harian',
  weekly: 'Mingguan',
  monthly: 'Bulanan',
};

/**
 * Jadwal pengiriman. `weekday` 1-7 (Senin = 1); `monthDay` 1-28, `0` = akhir bulan. Semua field selalu terisi
 * (yang tak dipakai frekuensinya tetap sah), jadi form dapat mengirim nilai bawaan.
 */
export interface ReportSchedule {
  frequency: ReportFrequency;
  hour: number;
  weekday: number;
  monthDay: number;
}

export const REPORT_PERIODS = ['yesterday', 'last7', 'last30', 'lastWeek', 'lastMonth'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  yesterday: 'Kemarin',
  last7: '7 hari terakhir',
  last30: '30 hari terakhir',
  lastWeek: 'Minggu lalu',
  lastMonth: 'Bulan lalu',
};

export const WEEKDAY_LABELS: readonly string[] = [
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
  'Minggu',
];

/** Waktu dinding WIB: tanggal `YYYY-MM-DD`, jam 0-23, dan hari ISO 1-7 (Senin = 1). */
export interface WibNow {
  date: string;
  hour: number;
  weekday: number;
}

export function wibNow(ms: number): WibNow {
  const shifted = new Date(ms + WIB_OFFSET_MS);
  const day = shifted.getUTCDay();
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    weekday: day === 0 ? 7 : day,
  };
}

function isInt(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Teks masalah jadwal, atau `null` bila sah. */
export function validateSchedule(schedule: ReportSchedule): string | null {
  if (!(REPORT_FREQUENCIES as readonly string[]).includes(schedule.frequency)) {
    return 'Frekuensi tidak sah';
  }
  if (!isInt(schedule.hour, 0, 23)) return 'Jam harus 0-23';
  if (!isInt(schedule.weekday, 1, 7)) return 'Hari harus Senin sampai Minggu';
  if (schedule.monthDay !== 0 && !isInt(schedule.monthDay, 1, 28)) {
    return 'Tanggal harus 1-28 atau akhir bulan';
  }
  return null;
}

function dateParts(date: string): [number, number, number] {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return [year, month, day];
}

function dateMs(date: string): number {
  const [year, month, day] = dateParts(date);
  return Date.UTC(year, month - 1, day);
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Tanggal terakhir bulan dari `date` (`YYYY-MM-DD`). */
function lastDayOfMonth(date: string): number {
  const [year, month] = dateParts(date);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Periode relatif berupa hari penuh yang berakhir kemarin (relatif terhadap `todayWib`). "Minggu lalu" = Senin sampai
 * Minggu minggu kalender sebelumnya; "bulan lalu" = tanggal 1 sampai akhir bulan sebelumnya.
 */
export function periodRange(period: ReportPeriod, todayWib: string): DashboardRange {
  const today = dateMs(todayWib);
  switch (period) {
    case 'yesterday':
      return { from: formatDate(today - DAY_MS), to: formatDate(today - DAY_MS) };
    case 'last7':
      return { from: formatDate(today - 7 * DAY_MS), to: formatDate(today - DAY_MS) };
    case 'last30':
      return { from: formatDate(today - 30 * DAY_MS), to: formatDate(today - DAY_MS) };
    case 'lastWeek': {
      const day = new Date(today).getUTCDay();
      const sinceMonday = day === 0 ? 6 : day - 1;
      const thisMonday = today - sinceMonday * DAY_MS;
      return { from: formatDate(thisMonday - 7 * DAY_MS), to: formatDate(thisMonday - DAY_MS) };
    }
    case 'lastMonth': {
      const now = new Date(today);
      return {
        from: formatDate(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
        to: formatDate(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)),
      };
    }
  }
}

/** Kunci minggu ISO `YYYY-Www` untuk tanggal `date` (Kamis menentukan tahun ISO). */
function isoWeekKey(date: string): string {
  const ms = dateMs(date);
  const day = new Date(ms).getUTCDay() || 7;
  const thursday = new Date(ms + (4 - day) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Kunci periode berjalan: harian `YYYY-MM-DD`, mingguan `YYYY-Www` (ISO), bulanan `YYYY-MM`. */
export function periodKey(schedule: ReportSchedule, now: WibNow): string {
  switch (schedule.frequency) {
    case 'daily':
      return now.date;
    case 'weekly':
      return isoWeekKey(now.date);
    case 'monthly':
      return now.date.slice(0, 7);
  }
}

/** True bila `now.date` adalah hari terjadwal (jam tidak diperiksa). */
export function isScheduledDay(schedule: ReportSchedule, now: WibNow): boolean {
  switch (schedule.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return schedule.weekday === now.weekday;
    case 'monthly': {
      const day = dateParts(now.date)[2];
      return schedule.monthDay === 0 ? day === lastDayOfMonth(now.date) : day === schedule.monthDay;
    }
  }
}

/**
 * Jatuh tempo: hari terjadwal hari ini, jam sekarang >= jam jadwal, dan periode berjalan belum dikirim. Hari terjadwal
 * yang terlewat tidak dikirim susulan (di luar hari terjadwal selalu `false`).
 */
export function isDue(schedule: ReportSchedule, now: WibNow, lastRunKey: string): boolean {
  return (
    isScheduledDay(schedule, now) &&
    now.hour >= schedule.hour &&
    lastRunKey !== periodKey(schedule, now)
  );
}

/** Apakah slot jadwal periode berjalan sudah lewat (atau tepat sekarang) pada `now`. */
function slotPassed(schedule: ReportSchedule, now: WibNow): boolean {
  switch (schedule.frequency) {
    case 'daily':
      return now.hour >= schedule.hour;
    case 'weekly':
      return (
        now.weekday > schedule.weekday ||
        (now.weekday === schedule.weekday && now.hour >= schedule.hour)
      );
    case 'monthly': {
      const day = dateParts(now.date)[2];
      const target = schedule.monthDay === 0 ? lastDayOfMonth(now.date) : schedule.monthDay;
      return day > target || (day === target && now.hour >= schedule.hour);
    }
  }
}

/**
 * Nilai awal `last_run_key` untuk laporan baru, dilanjutkan, atau dijadwal ulang: kunci periode berjalan bila slot
 * jadwal periode itu sudah lewat (supaya tidak langsung terkirim ke penerima), selain itu kosong.
 */
export function initialRunKey(schedule: ReportSchedule, now: WibNow): string {
  return slotPassed(schedule, now) ? periodKey(schedule, now) : '';
}

/**
 * Kejadian pengiriman berikutnya (ISO UTC) untuk label "berikutnya". Hari ini dihitung bila jamnya belum lewat atau
 * (jamnya sudah lewat tetapi periodenya belum dikirim: jatuh tempo sekarang). Kosong bila tak ditemukan.
 */
export function nextRunAt(schedule: ReportSchedule, nowMs: number, lastRunKey: string): string {
  const now = wibNow(nowMs);
  const todayMs = dateMs(now.date);
  for (let offset = 0; offset <= 400; offset += 1) {
    const dayMs = todayMs + offset * DAY_MS;
    const date = formatDate(dayMs);
    const day = new Date(dayMs).getUTCDay();
    const dayNow: WibNow = { date, hour: schedule.hour, weekday: day === 0 ? 7 : day };
    if (!isScheduledDay(schedule, dayNow)) continue;
    const candidate = dayMs + schedule.hour * 3_600_000 - WIB_OFFSET_MS;
    if (candidate > nowMs) return new Date(candidate).toISOString();
    if (offset === 0 && lastRunKey !== periodKey(schedule, dayNow)) {
      return new Date(candidate).toISOString();
    }
  }
  return '';
}

function hourText(hour: number): string {
  return `${String(hour).padStart(2, '0')}.00`;
}

/** Ringkasan jadwal untuk tampilan. */
export function scheduleLabel(schedule: ReportSchedule): string {
  const time = `${hourText(schedule.hour)} WIB`;
  switch (schedule.frequency) {
    case 'daily':
      return `Setiap hari ${time}`;
    case 'weekly':
      return `${WEEKDAY_LABELS[schedule.weekday - 1] ?? 'Senin'} ${time}`;
    case 'monthly':
      return schedule.monthDay === 0
        ? `Akhir bulan ${time}`
        : `Tanggal ${schedule.monthDay} pukul ${time}`;
  }
}

/** Cakupan beku laporan (JSON di kolom `scope`); bentuknya sama dengan tautan, tanpa rentang (rentang = `period`). */
export interface ReportScope {
  buIds: string[];
  locationIds: string[];
  locationFiltered: boolean;
  widgets: ShareWidgetScope[];
  /** Kunci filter relasi yang ditawarkan ke penonton tautan terbitan. */
  offers: string[];
}

export type ReportStatus = '' | 'ok' | 'skipped' | 'error';

export interface DashboardReportDto {
  id: string;
  name: string;
  /** Surel pemilik. */
  owner: string;
  enabled: boolean;
  schedule: ReportSchedule;
  period: ReportPeriod;
  scope: ReportScope;
  /** Alamat penerima; selalu terisi bagi pemanggil yang boleh mengelola baris ini (pemilik, `manage`, super admin). */
  recipients: string[];
  /** Tembusan (CC) dan tembusan tersembunyi (BCC); sama-sama hanya terlihat bagi pengelola baris ini. */
  cc: string[];
  bcc: string[];
  /** Jumlah seluruh alamat (To + CC + BCC). */
  recipientCount: number;
  linkDays: number;
  lastStatus: ReportStatus;
  lastNote: string;
  lastRunAt: string;
  /** ISO UTC pengiriman berikutnya; kosong bila dijeda. */
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Dihitung server: pemanggil boleh mengelola penuh baris ini (ubah, jeda, kirim uji, pratinjau, tautan, hapus):
   * pemilik (`dashboard: edit`), atau siapa pun bagi `manage`/super admin. Baris yang tak boleh dikelola tak pernah
   * dikembalikan (`NOT_FOUND`), jadi pada praktiknya selalu `true`.
   */
  canEdit: boolean;
  /** Pada `dashboardReports.get`: tautan terbitan terbaru (maks. 10), dengan `url`. */
  links?: DashboardShareDto[];
}

export interface DashboardReportListDto {
  reports: DashboardReportDto[];
  /** `false` bila SMTP belum diatur: penjadwal tidak berbuat apa pun. */
  smtpConfigured: boolean;
  /** Batas laporan per pemilik. */
  limit: number;
}

export interface SaveDashboardReportInput {
  /** Kosong = laporan baru. */
  id?: string;
  name: string;
  schedule: ReportSchedule;
  period: ReportPeriod;
  filter: DashboardFilterInput;
  locationFiltered?: boolean;
  widgets: ShareWidgetScope[];
  offers: string[];
  recipients: string[];
  /** Opsional: tak dikirim = kosong. */
  cc?: string[];
  bcc?: string[];
  linkDays: number;
  enabled?: boolean;
  /** `updatedAt` yang dibaca saat membuka form (CAS); wajib saat mengubah. */
  expectedUpdatedAt?: string;
}

export interface GetDashboardReportInput {
  id: string;
}

export interface SetDashboardReportEnabledInput {
  id: string;
  enabled: boolean;
}

export interface DashboardReportPreviewDto {
  subject: string;
  html: string;
  /**
   * Isi dipangkas karena hak akses pemanggil lebih sempit dari hak pemilik laporan (hanya pada laporan milik orang lain);
   * tidak merinci apa yang disembunyikan. Aditif.
   */
  trimmed: boolean;
}
