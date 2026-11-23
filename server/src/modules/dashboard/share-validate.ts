import { appError } from '@server/core/errors';
import {
  DASHBOARD_RANGE_MAX_DAYS,
  GROUP_FILTERS,
  validateDashboardRange,
  widgetMeta,
} from '@shared/dashboard';
import type { CreateShareInput, ShareRange, ShareWidgetScope } from '@shared/dashboard-share';
import { SHARE_LIMITS, SHARE_OFFER_KEYS } from '@shared/dashboard-share';
import { isIsoDate } from '@shared/serials';
import { type Fields, readGlobalFilter, readWidget } from './validate';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Aturan isi masukan pembuatan tautan (batas dan keanggotaan; bukan hak pembuat): dipakai `validateCreateShare` dan
 * `freezeScope` (yang juga dipanggil langsung oleh tes dan jalur lain). Mengembalikan galat per field; kosong = sah.
 */
export function checkShareInput(input: CreateShareInput): Fields {
  const fields: Fields = {};
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title === '') fields.title = 'Judul wajib diisi';
  else if (title.length > SHARE_LIMITS.titleMax) {
    fields.title = `Judul maksimal ${SHARE_LIMITS.titleMax} karakter`;
  }

  // Bentuk saja (tanpa jam): jendela tanggal terhadap "hari ini" dihitung `shareExpiry` dengan jam server di `createShare`.
  const hasDays = input.expiresInDays !== undefined;
  const hasDate = input.expiresOn !== undefined;
  if (hasDays === hasDate) {
    fields[hasDays ? 'expiresOn' : 'expiresInDays'] =
      'Isi tepat satu: masa berlaku (hari) atau tanggal berlaku';
  } else if (hasDate) {
    if (typeof input.expiresOn !== 'string' || !isIsoDate(input.expiresOn)) {
      fields.expiresOn = 'Tanggal berlaku tidak sah';
    }
  } else {
    const days = input.expiresInDays;
    if (
      typeof days !== 'number' ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > SHARE_LIMITS.expiryDaysMax
    ) {
      fields.expiresInDays = `Masa berlaku harus 1-${SHARE_LIMITS.expiryDaysMax} hari`;
    }
  }

  const range = input.range;
  if (range?.mode === 'fixed') {
    const problem = validateDashboardRange({ from: String(range.from), to: String(range.to) });
    if (problem !== null) fields.range = problem;
  } else if (range?.mode === 'rolling') {
    if (
      typeof range.days !== 'number' ||
      !Number.isInteger(range.days) ||
      range.days < 1 ||
      range.days > DASHBOARD_RANGE_MAX_DAYS
    ) {
      fields.range = `Rentang bergulir harus 1-${DASHBOARD_RANGE_MAX_DAYS} hari`;
    }
  } else {
    fields.range = 'Rentang tidak sah';
  }

  if (!Array.isArray(input.widgets) || input.widgets.length === 0) {
    fields.widgets = 'Pilih minimal satu widget';
  } else if (input.widgets.length > SHARE_LIMITS.widgetsMax) {
    fields.widgets = `Maksimal ${SHARE_LIMITS.widgetsMax} widget`;
  } else {
    const seen = new Set<string>();
    for (const [index, widget] of input.widgets.entries()) {
      const request = readWidget(widget, index, fields);
      if (request === null) continue;
      if (seen.has(request.id)) fields[`widgets[${index}].id`] = 'Widget ganda';
      seen.add(request.id);
    }
  }

  if (!Array.isArray(input.offers)) {
    fields.offers = 'Harus berupa daftar';
  } else if (Object.keys(fields).every((key) => !key.startsWith('widgets'))) {
    for (const key of input.offers) {
      if (!(SHARE_OFFER_KEYS as readonly string[]).includes(key) || !offerSelected(input, key)) {
        fields.offers = 'Filter yang ditawarkan harus terisi pada widget terkait';
        break;
      }
    }
  }
  return fields;
}

/** True bila `key` (filter relasi) terisi pada minimal satu widget yang grupnya memilikinya. */
function offerSelected(input: CreateShareInput, key: string): boolean {
  return input.widgets.some((widget) => {
    const field = GROUP_FILTERS[widgetMeta(widget.id).group].find((item) => item.key === key);
    return field?.kind === 'relation' && (widget.filters?.[key]?.length ?? 0) > 0;
  });
}

export function assertShareInput(input: CreateShareInput): void {
  const fields = checkShareInput(input);
  if (Object.keys(fields).length > 0) throw appError('VALIDATION', 'Input tidak valid', fields);
}

function readRange(raw: unknown, fields: Fields): ShareRange {
  if (
    isRecord(raw) &&
    raw.mode === 'fixed' &&
    typeof raw.from === 'string' &&
    typeof raw.to === 'string'
  ) {
    return { mode: 'fixed', from: raw.from, to: raw.to };
  }
  if (isRecord(raw) && raw.mode === 'rolling' && typeof raw.days === 'number') {
    return { mode: 'rolling', days: raw.days };
  }
  fields.range = 'Rentang tidak sah';
  return { mode: 'rolling', days: 0 };
}

/** Validasi `dashboardShares.create`: bentuk dan tipe, lalu aturan isi (`checkShareInput`). */
export function validateCreateShare(raw: unknown): CreateShareInput {
  if (!isRecord(raw)) {
    throw appError('VALIDATION', 'Input harus berupa objek', { _: 'Input harus berupa objek' });
  }
  const fields: Fields = {};
  if (typeof raw.title !== 'string') fields.title = 'Judul wajib berupa teks';
  const filter = readGlobalFilter(raw.filter, fields);
  const range = readRange(raw.range, fields);
  if (raw.locationFiltered !== undefined && typeof raw.locationFiltered !== 'boolean') {
    fields.locationFiltered = 'Harus berupa ya/tidak';
  }
  const widgets: ShareWidgetScope[] = [];
  if (!Array.isArray(raw.widgets)) {
    fields.widgets = 'Wajib berupa daftar';
  } else if (raw.widgets.length > SHARE_LIMITS.widgetsMax) {
    fields.widgets = `Maksimal ${SHARE_LIMITS.widgetsMax} widget`;
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
  if (raw.expiresInDays !== undefined && typeof raw.expiresInDays !== 'number') {
    fields.expiresInDays = 'Masa berlaku wajib berupa angka';
  }
  if (raw.expiresOn !== undefined && typeof raw.expiresOn !== 'string') {
    fields.expiresOn = 'Tanggal berlaku wajib berupa teks';
  }

  if (Object.keys(fields).length > 0) throw appError('VALIDATION', 'Input tidak valid', fields);
  const input: CreateShareInput = {
    title: String(raw.title).trim(),
    filter,
    range,
    widgets,
    offers,
    ...(raw.expiresInDays === undefined ? {} : { expiresInDays: raw.expiresInDays as number }),
    ...(raw.expiresOn === undefined ? {} : { expiresOn: raw.expiresOn as string }),
    ...(raw.locationFiltered === undefined
      ? {}
      : { locationFiltered: raw.locationFiltered as boolean }),
  };
  const problems = checkShareInput(input);
  if (Object.keys(problems).length > 0) throw appError('VALIDATION', 'Input tidak valid', problems);
  return input;
}

/** Validasi masukan berparameter `id` (cabut tautan). */
export function validateShareId(raw: unknown): { id: string } {
  const id = isRecord(raw) && typeof raw.id === 'string' ? raw.id.trim() : '';
  if (id === '' || id.length > 100) {
    throw appError('VALIDATION', 'Id tautan tidak valid', { id: 'Id tautan tidak valid' });
  }
  return { id };
}
