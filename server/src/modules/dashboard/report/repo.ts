/**
 * Akses tabel `dashboard_reports` (laporan dashboard terjadwal, spek dashboard bagian 7a). Hanya pernyataan SQL dan
 * pembacaan/penguraian baris; aturan izin dan alur ada di `service.ts`/`run.ts`. Bukan model soft delete.
 */
import { createHash } from 'node:crypto';
import { CAS_FAIL_SQL } from '@server/core/cas';
import type { DbStatement, Preparer } from '@server/core/db';
import { WIDGET_IDS, type WidgetId } from '@shared/dashboard';
import {
  REPORT_FREQUENCIES,
  REPORT_PERIODS,
  type ReportPeriod,
  type ReportSchedule,
  type ReportScope,
  type ReportStatus,
  validateSchedule,
} from '@shared/dashboard-report';
import { SHARE_OFFER_KEYS, type ShareWidgetScope } from '@shared/dashboard-share';
import { isPostelRecipient } from '@shared/postel';

export interface ReportRow {
  id: string;
  name: string;
  owner: string;
  /** TINYINT: 1 = aktif, 0 = dijeda. */
  enabled: number;
  /** JSON `ReportSchedule`. */
  schedule: string;
  period: string;
  /** JSON `ReportScope`. */
  scope: string;
  /** JSON larik surel. */
  recipients: string;
  link_days: number;
  last_run_key: string;
  last_run_at: string;
  last_status: string;
  last_note: string;
  created_at: string;
  updated_at: string;
  version: number;
}

const COLUMNS =
  'id, name, owner, enabled, schedule, period, scope, recipients, link_days, last_run_key, last_run_at, last_status, last_note, created_at, updated_at, version';

export function insertReportStmt(db: Preparer, row: ReportRow): DbStatement {
  return db
    .prepare(
      `INSERT INTO dashboard_reports (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.name,
      row.owner,
      row.enabled,
      row.schedule,
      row.period,
      row.scope,
      row.recipients,
      row.link_days,
      row.last_run_key,
      row.last_run_at,
      row.last_status,
      row.last_note,
      row.created_at,
      row.updated_at,
      row.version,
    );
}

export async function loadReport(db: Preparer, id: string): Promise<ReportRow | null> {
  return db
    .prepare(`SELECT ${COLUMNS} FROM dashboard_reports WHERE id = ?`)
    .bind(id)
    .first<ReportRow>();
}

/** Semua laporan, terbaru dahulu. */
export async function listReportRows(db: Preparer): Promise<ReportRow[]> {
  const result = await db
    .prepare(`SELECT ${COLUMNS} FROM dashboard_reports ORDER BY created_at DESC, id DESC`)
    .all<ReportRow>();
  return result.results;
}

/** Laporan aktif (untuk pemeriksa jadwal), urut dibuat agar pemrosesan stabil. */
export async function listEnabledReportRows(db: Preparer): Promise<ReportRow[]> {
  const result = await db
    .prepare(
      `SELECT ${COLUMNS} FROM dashboard_reports WHERE enabled = 1 ORDER BY created_at ASC, id ASC`,
    )
    .all<ReportRow>();
  return result.results;
}

/** Kunci baris penghitung per pemilik (hash surel agar muat di `counters.key` 128 karakter). */
function reportLockKey(owner: string): string {
  return `dashboard_report:${createHash('sha256').update(owner).digest('hex')}`;
}

/** Memastikan baris kunci pemilik ada; dipanggil SEBELUM `batch()` pembuatan, di luar transaksi. */
export function ensureReportLockStmt(db: Preparer, owner: string): DbStatement {
  return db
    .prepare('INSERT IGNORE INTO counters (`key`, value) VALUES (?, 0)')
    .bind(reportLockKey(owner));
}

/**
 * Penjaga batas laporan per pemilik untuk digabung ke `batch()` pembuatan (sebelum penyisipan): menaikkan baris kunci
 * pemilik (kunci eksklusif sampai COMMIT, jadi pembuatan serentak diserialkan) lalu membatalkan batch
 * (`CAS_FAIL_SQL`, dikenali `isGuardFailure`) bila jumlah laporan pemilik sudah mencapai `max`.
 */
export function ownerLimitGuardStmts(db: Preparer, owner: string, max: number): DbStatement[] {
  return [
    db
      .prepare(
        'INSERT INTO counters (`key`, value) VALUES (?, 1) ON DUPLICATE KEY UPDATE value = value + 1',
      )
      .bind(reportLockKey(owner)),
    db
      .prepare(
        `SELECT CASE WHEN (SELECT COUNT(*) FROM dashboard_reports WHERE owner = ?) < ? THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok`,
      )
      .bind(owner, max),
  ];
}

/**
 * Mengklaim periode: `last_run_key` menjadi `claimed` hanya bila laporan masih aktif dan kuncinya masih `expected`.
 * Satu pemanggil serentak yang mendapat `changes === 1`.
 */
export async function claimRunKey(
  db: Preparer,
  id: string,
  expected: string,
  claimed: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      'UPDATE dashboard_reports SET last_run_key = ? WHERE id = ? AND enabled = 1 AND last_run_key = ?',
    )
    .bind(claimed, id, expected)
    .run();
  return result.meta.changes === 1;
}

/** Mengembalikan klaim ke `previous`, hanya bila kunci masih nilai klaim kita (tak menimpa penulis lain). */
export async function releaseRunKey(
  db: Preparer,
  id: string,
  claimed: string,
  previous: string,
): Promise<void> {
  await db
    .prepare('UPDATE dashboard_reports SET last_run_key = ? WHERE id = ? AND last_run_key = ?')
    .bind(previous, id, claimed)
    .run();
}

/** Mencatat hasil percobaan terakhir (tanpa mengubah `updated_at`/`version`: bukan perubahan oleh pengguna). */
export async function recordRunResult(
  db: Preparer,
  id: string,
  status: Exclude<ReportStatus, ''>,
  note: string,
  runAt: string,
): Promise<void> {
  await db
    .prepare(
      'UPDATE dashboard_reports SET last_status = ?, last_note = ?, last_run_at = ? WHERE id = ?',
    )
    .bind(status, note, runAt, id)
    .run();
}

const WIDGET_ID_SET: ReadonlySet<string> = new Set(WIDGET_IDS);
const OFFER_KEY_SET: ReadonlySet<string> = new Set(SHARE_OFFER_KEYS);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSchedule(raw: string): ReportSchedule | null {
  const value = parseJson(raw);
  if (!isRecord(value)) return null;
  const { frequency, hour, weekday, monthDay } = value;
  if (
    !(REPORT_FREQUENCIES as readonly unknown[]).includes(frequency) ||
    typeof hour !== 'number' ||
    typeof weekday !== 'number' ||
    typeof monthDay !== 'number'
  ) {
    return null;
  }
  const schedule: ReportSchedule = {
    frequency: frequency as ReportSchedule['frequency'],
    hour,
    weekday,
    monthDay,
  };
  return validateSchedule(schedule) === null ? schedule : null;
}

export function parsePeriod(raw: string): ReportPeriod | null {
  return (REPORT_PERIODS as readonly string[]).includes(raw) ? (raw as ReportPeriod) : null;
}

function parseWidgets(value: unknown): ShareWidgetScope[] | null {
  if (!Array.isArray(value)) return null;
  const widgets: ShareWidgetScope[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const { id, filters } = item;
    if (typeof id !== 'string' || !WIDGET_ID_SET.has(id)) return null;
    if (!isRecord(filters)) return null;
    const parsed: Record<string, string[]> = {};
    for (const [key, list] of Object.entries(filters)) {
      if (!isStringArray(list)) return null;
      parsed[key] = list;
    }
    widgets.push({ id: id as WidgetId, filters: parsed });
  }
  return widgets;
}

/** Mengurai kolom `scope`; `null` bila JSON rusak atau bentuknya tak sah (laporan dilewati, bukan galat). */
export function parseReportScope(raw: string): ReportScope | null {
  const value = parseJson(raw);
  if (!isRecord(value)) return null;
  if (!isStringArray(value.buIds) || !isStringArray(value.locationIds)) return null;
  if (typeof value.locationFiltered !== 'boolean') return null;
  if (!isStringArray(value.offers) || !value.offers.every((key) => OFFER_KEY_SET.has(key))) {
    return null;
  }
  const widgets = parseWidgets(value.widgets);
  if (widgets === null) return null;
  return {
    buIds: value.buIds,
    locationIds: value.locationIds,
    locationFiltered: value.locationFiltered,
    widgets,
    offers: value.offers,
  };
}

/**
 * Penerima tersimpan; entri yang bukan satu alamat polos dibuang (data lama/rusak tak boleh sampai ke `bcc`). JSON
 * rusak = daftar kosong.
 */
export function parseRecipients(raw: string): string[] {
  const value = parseJson(raw);
  if (!isStringArray(value)) return [];
  return value.filter(isPostelRecipient);
}
