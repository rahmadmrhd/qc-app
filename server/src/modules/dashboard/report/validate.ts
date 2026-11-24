import { appError } from '@server/core/errors';
import type { DashboardFilterInput } from '@shared/dashboard';
import { GROUP_FILTERS, widgetMeta } from '@shared/dashboard';
import type {
  GetDashboardReportInput,
  ReportPeriod,
  ReportSchedule,
  SaveDashboardReportInput,
  SetDashboardReportEnabledInput,
} from '@shared/dashboard-report';
import { REPORT_LIMITS, REPORT_PERIODS, validateSchedule } from '@shared/dashboard-report';
import type { ShareWidgetScope } from '@shared/dashboard-share';
import { SHARE_OFFER_KEYS } from '@shared/dashboard-share';
import { isPostelRecipient, stripControlChars } from '@shared/postel';
import { type Fields, readWidget } from '../validate';

const MAX_ID_LENGTH = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Nama laporan setelah dibersihkan dari karakter kontrol/bidi dan dipangkas. */
export function cleanReportName(name: string): string {
  return stripControlChars(name).trim();
}

/** Penerima ternormalisasi: dipangkas, huruf kecil, duplikat dibuang (urutan pertama dipertahankan). */
export function normalizeRecipients(recipients: readonly string[]): string[] {
  return [...new Set(recipients.map((item) => item.trim().toLowerCase()))];
}

/** True bila `key` (filter relasi) terisi pada minimal satu widget yang grupnya memilikinya. */
function offerSelected(widgets: readonly ShareWidgetScope[], key: string): boolean {
  return widgets.some((widget) => {
    const field = GROUP_FILTERS[widgetMeta(widget.id).group].find((item) => item.key === key);
    return field?.kind === 'relation' && (widget.filters[key]?.length ?? 0) > 0;
  });
}

/** Aturan isi masukan simpan laporan (bentuk sudah dibaca): galat per field; kosong = sah. */
export function checkReportInput(input: SaveDashboardReportInput): Fields {
  const fields: Fields = {};
  const name = cleanReportName(typeof input.name === 'string' ? input.name : '');
  if (name === '') fields.name = 'Nama wajib diisi';
  else if (name.length > REPORT_LIMITS.nameMax) {
    fields.name = `Nama maksimal ${REPORT_LIMITS.nameMax} karakter`;
  }

  const scheduleProblem = validateSchedule(input.schedule);
  if (scheduleProblem !== null) fields.schedule = scheduleProblem;
  if (!(REPORT_PERIODS as readonly string[]).includes(input.period)) {
    fields.period = 'Periode tidak sah';
  }

  if (!Array.isArray(input.widgets) || input.widgets.length === 0) {
    fields.widgets = 'Pilih minimal satu widget';
  } else if (input.widgets.length > REPORT_LIMITS.widgetsMax) {
    fields.widgets = `Maksimal ${REPORT_LIMITS.widgetsMax} widget`;
  } else {
    const seen = new Set<string>();
    for (const [index, widget] of input.widgets.entries()) {
      if (seen.has(widget.id)) fields[`widgets[${index}].id`] = 'Widget ganda';
      seen.add(widget.id);
    }
  }

  for (const key of ['buIds', 'locationIds'] as const) {
    const list = input.filter?.[key];
    if (Array.isArray(list) && list.length > REPORT_LIMITS.scopeIdsMax) {
      fields[`filter.${key}`] = `Maksimal ${REPORT_LIMITS.scopeIdsMax} nilai`;
    }
  }

  const recipients = Array.isArray(input.recipients) ? normalizeRecipients(input.recipients) : [];
  if (recipients.length === 0) {
    fields.recipients = 'Isi minimal satu alamat surel penerima';
  } else if (recipients.length > REPORT_LIMITS.recipientsMax) {
    fields.recipients = `Maksimal ${REPORT_LIMITS.recipientsMax} penerima`;
  } else if (!recipients.every(isPostelRecipient)) {
    fields.recipients = 'Setiap penerima harus satu alamat surel polos';
  }

  const days = input.linkDays;
  if (
    typeof days !== 'number' ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > REPORT_LIMITS.linkDaysMax
  ) {
    fields.linkDays = `Masa berlaku tautan harus 1-${REPORT_LIMITS.linkDaysMax} hari`;
  }

  if (!Array.isArray(input.offers)) {
    fields.offers = 'Harus berupa daftar';
  } else if (
    Array.isArray(input.widgets) &&
    Object.keys(fields).every((key) => !key.startsWith('widgets'))
  ) {
    for (const key of input.offers) {
      if (
        !(SHARE_OFFER_KEYS as readonly string[]).includes(key) ||
        !offerSelected(input.widgets, key)
      ) {
        fields.offers = 'Filter yang ditawarkan harus terisi pada widget terkait';
        break;
      }
    }
  }
  return fields;
}

export function assertReportInput(input: SaveDashboardReportInput): void {
  const fields = checkReportInput(input);
  if (Object.keys(fields).length > 0) throw appError('VALIDATION', 'Input tidak valid', fields);
}

function readIdList(value: unknown, key: string, fields: Fields): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    fields[key] = 'Harus berupa daftar teks';
    return undefined;
  }
  if (value.length > REPORT_LIMITS.scopeIdsMax) {
    fields[key] = `Maksimal ${REPORT_LIMITS.scopeIdsMax} nilai`;
    return undefined;
  }
  const items = (value as string[]).map((item) => item.trim());
  if (items.some((item) => item === '' || item.length > MAX_ID_LENGTH)) {
    fields[key] = 'Nilai tidak valid';
    return undefined;
  }
  return [...new Set(items)];
}

/**
 * Filter laporan: hanya BU dan lokasi yang bermakna (rentang tanggal laporan = `period`, bukan tanggal), jadi `from`
 * dan `to` tidak diperiksa dan diabaikan server.
 */
function readReportFilter(raw: unknown, fields: Fields): DashboardFilterInput {
  const source = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) fields.filter = 'Filter wajib berupa objek';
  const result: DashboardFilterInput = {
    from: typeof source.from === 'string' ? source.from : '',
    to: typeof source.to === 'string' ? source.to : '',
  };
  for (const key of ['buIds', 'locationIds'] as const) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    const list = readIdList(value, `filter.${key}`, fields);
    if (list !== undefined) result[key] = list;
  }
  return result;
}

function readSchedule(raw: unknown, fields: Fields): ReportSchedule {
  if (
    isRecord(raw) &&
    typeof raw.frequency === 'string' &&
    typeof raw.hour === 'number' &&
    typeof raw.weekday === 'number' &&
    typeof raw.monthDay === 'number'
  ) {
    return {
      frequency: raw.frequency as ReportSchedule['frequency'],
      hour: raw.hour,
      weekday: raw.weekday,
      monthDay: raw.monthDay,
    };
  }
  fields.schedule = 'Jadwal tidak sah';
  return { frequency: 'daily', hour: 0, weekday: 1, monthDay: 1 };
}

/** Validasi `dashboardReports.save`: bentuk dan tipe, lalu aturan isi (`checkReportInput`). */
export function validateSaveReport(raw: unknown): SaveDashboardReportInput {
  if (!isRecord(raw)) {
    throw appError('VALIDATION', 'Input harus berupa objek', { _: 'Input harus berupa objek' });
  }
  const fields: Fields = {};
  if (typeof raw.name !== 'string') fields.name = 'Nama wajib berupa teks';
  if (raw.id !== undefined && (typeof raw.id !== 'string' || raw.id.length > MAX_ID_LENGTH)) {
    fields.id = 'Id tidak valid';
  }
  const schedule = readSchedule(raw.schedule, fields);
  if (typeof raw.period !== 'string') fields.period = 'Periode tidak sah';
  const filter = readReportFilter(raw.filter, fields);
  if (raw.locationFiltered !== undefined && typeof raw.locationFiltered !== 'boolean') {
    fields.locationFiltered = 'Harus berupa ya/tidak';
  }
  const widgets: ShareWidgetScope[] = [];
  if (!Array.isArray(raw.widgets)) {
    fields.widgets = 'Wajib berupa daftar';
  } else if (raw.widgets.length > REPORT_LIMITS.widgetsMax) {
    fields.widgets = `Maksimal ${REPORT_LIMITS.widgetsMax} widget`;
  } else {
    for (const [index, entry] of raw.widgets.entries()) {
      const request = readWidget(entry, index, fields);
      if (request !== null) widgets.push({ id: request.id, filters: request.filters ?? {} });
    }
  }
  const offers: string[] = [];
  if (!Array.isArray(raw.offers) || !raw.offers.every((key) => typeof key === 'string')) {
    fields.offers = 'Harus berupa daftar teks';
  } else {
    for (const key of raw.offers as string[]) if (!offers.includes(key)) offers.push(key);
  }
  let recipients: string[] = [];
  if (!Array.isArray(raw.recipients) || !raw.recipients.every((item) => typeof item === 'string')) {
    fields.recipients = 'Penerima harus berupa daftar teks';
  } else if (raw.recipients.length > REPORT_LIMITS.recipientsMax * 5) {
    // Pagar kasar sebelum normalisasi (duplikat dibuang kemudian); batas sebenarnya diperiksa `checkReportInput`.
    fields.recipients = `Maksimal ${REPORT_LIMITS.recipientsMax} penerima`;
  } else {
    recipients = normalizeRecipients(raw.recipients as string[]);
  }
  if (typeof raw.linkDays !== 'number') fields.linkDays = 'Masa berlaku tautan wajib berupa angka';
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    fields.enabled = 'Harus berupa ya/tidak';
  }
  if (raw.expectedUpdatedAt !== undefined && typeof raw.expectedUpdatedAt !== 'string') {
    fields.expectedUpdatedAt = 'Harus berupa teks';
  }

  if (Object.keys(fields).length > 0) throw appError('VALIDATION', 'Input tidak valid', fields);
  const input: SaveDashboardReportInput = {
    name: String(raw.name),
    schedule,
    period: raw.period as ReportPeriod,
    filter,
    widgets,
    offers,
    recipients,
    linkDays: raw.linkDays as number,
    ...(typeof raw.id === 'string' && raw.id !== '' ? { id: raw.id } : {}),
    ...(raw.locationFiltered === undefined
      ? {}
      : { locationFiltered: raw.locationFiltered as boolean }),
    ...(raw.enabled === undefined ? {} : { enabled: raw.enabled as boolean }),
    ...(typeof raw.expectedUpdatedAt === 'string'
      ? { expectedUpdatedAt: raw.expectedUpdatedAt }
      : {}),
  };
  const problems = checkReportInput(input);
  if (Object.keys(problems).length > 0) throw appError('VALIDATION', 'Input tidak valid', problems);
  return { ...input, name: cleanReportName(input.name) };
}

/** Validasi masukan berparameter `id`. */
export function validateReportId(raw: unknown): GetDashboardReportInput {
  const id = isRecord(raw) && typeof raw.id === 'string' ? raw.id.trim() : '';
  if (id === '' || id.length > MAX_ID_LENGTH) {
    throw appError('VALIDATION', 'Id laporan tidak valid', { id: 'Id laporan tidak valid' });
  }
  return { id };
}

export function validateSetReportEnabled(raw: unknown): SetDashboardReportEnabledInput {
  const { id } = validateReportId(raw);
  if (!isRecord(raw) || typeof raw.enabled !== 'boolean') {
    throw appError('VALIDATION', 'Input tidak valid', { enabled: 'Harus berupa ya/tidak' });
  }
  return { id, enabled: raw.enabled };
}
