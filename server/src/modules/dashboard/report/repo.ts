/**
 * Akses tabel `dashboard_reports` (laporan dashboard terjadwal, spek dashboard bagian 7a). Hanya pernyataan SQL dan
 * pembacaan/penguraian baris; aturan izin dan alur ada di `service.ts`/`run.ts`. Bukan model soft delete.
 */
import { createHash } from 'node:crypto';
import { CAS_FAIL_SQL } from '@server/core/cas';
import type { DbStatement, Preparer } from '@server/core/db';
import { sendableMailLists } from '@server/core/mail-lists';
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
import type { MailLists } from '@shared/mail-lists';
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
  /** JSON larik surel (Kepada/To). */
  recipients: string;
  /** JSON larik surel Tembusan (CC) dan Tembusan tersembunyi (BCC). */
  cc: string;
  bcc: string;
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
  'id, name, owner, enabled, schedule, period, scope, recipients, cc, bcc, link_days, last_run_key, last_run_at, last_status, last_note, created_at, updated_at, version';

export function insertReportStmt(db: Preparer, row: ReportRow): DbStatement {
  return db
    .prepare(
      `INSERT INTO dashboard_reports (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      row.cc,
      row.bcc,
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

/** Semua laporan, terbaru dahulu; `owner` diisi = hanya laporan milik pemilik itu (pemegang `dashboard: edit`). */
export async function listReportRows(db: Preparer, owner?: string): Promise<ReportRow[]> {
  const result =
    owner === undefined
      ? await db
          .prepare(`SELECT ${COLUMNS} FROM dashboard_reports ORDER BY created_at DESC, id DESC`)
          .all<ReportRow>()
      : await db
          .prepare(
            `SELECT ${COLUMNS} FROM dashboard_reports WHERE owner = ? ORDER BY created_at DESC, id DESC`,
          )
          .bind(owner)
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

/** Klaim periode yang dipegang pengirim: kunci periode dan `version` baris saat klaim (pengirim tak menaikkan `version`). */
export interface RunClaim {
  key: string;
  version: number;
}

/**
 * Mengklaim periode: `last_run_key` menjadi `claimed` hanya bila laporan masih aktif, kuncinya masih `expected`, DAN
 * barisnya belum diubah sejak dimuat (`version` sama): penerima, cakupan, atau jadwal yang diubah pemilik setelah
 * putaran memuat baris membuat klaim gagal (putaran berikutnya memuat yang baru), bukan mengirim data lama. Satu
 * pemanggil serentak yang mendapat `changes === 1`.
 */
export async function claimRunKey(
  db: Preparer,
  id: string,
  expected: string,
  claimed: string,
  version: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      'UPDATE dashboard_reports SET last_run_key = ? WHERE id = ? AND enabled = 1 AND last_run_key = ? AND version = ?',
    )
    .bind(claimed, id, expected, version)
    .run();
  return result.meta.changes === 1;
}

/**
 * Mengembalikan klaim ke `previous`, hanya bila kunci masih nilai klaim kita DAN `version` masih milik klaim itu:
 * perubahan pemilik sesudah klaim (mis. jadwal diubah sehingga kunci reset kebetulan sama dengan klaim) tak pernah
 * ditimpa.
 */
export async function releaseRunKey(
  db: Preparer,
  id: string,
  claim: RunClaim,
  previous: string,
): Promise<void> {
  await db
    .prepare(
      'UPDATE dashboard_reports SET last_run_key = ? WHERE id = ? AND last_run_key = ? AND version = ?',
    )
    .bind(previous, id, claim.key, claim.version)
    .run();
}

/** Versi baris terkini; `null` bila laporan sudah dihapus. */
export async function loadReportVersion(db: Preparer, id: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT version FROM dashboard_reports WHERE id = ?')
    .bind(id)
    .first<{ version: number }>();
  return row === null ? null : Number(row.version);
}

/**
 * Penjaga penerbitan tautan, digabung ke `batch()` penyisipan tautan: mengunci baris laporan (`FOR UPDATE`, searah
 * dengan `removeDashboardReport` yang mengunci baris yang sama lebih dulu), lalu membatalkan batch (`CAS_FAIL_SQL`,
 * dikenali `isGuardFailure`) bila laporan sudah dihapus atau (dengan `version`) sudah diubah. Penghapusan serentak
 * jadi berurutan: tautan terbit sebelum penghapusan ikut dicabut olehnya, atau tak terbit sama sekali.
 */
export function reportExistsGuardStmts(
  db: Preparer,
  id: string,
  version: number | null,
): DbStatement[] {
  return [
    db.prepare('SELECT id FROM dashboard_reports WHERE id = ? FOR UPDATE').bind(id),
    db
      .prepare(
        `SELECT CASE WHEN EXISTS (SELECT 1 FROM dashboard_reports WHERE id = ?${version === null ? '' : ' AND version = ?'}) THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok`,
      )
      .bind(...(version === null ? [id] : [id, version])),
  ];
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
    if (typeof id !== 'string') return null;
    if (!isRecord(filters)) return null;
    const parsed: Record<string, string[]> = {};
    for (const [key, list] of Object.entries(filters)) {
      if (!isStringArray(list)) return null;
      parsed[key] = list;
    }
    // Widget yang sudah dihapus dari dashboard (mis. Postel, keputusan pemilik 2026-11-25) dibuang diam-diam: tautan
    // dan laporan lama tetap hidup dengan widget yang tersisa, bukan 404 atau dilewati seluruhnya.
    if (!WIDGET_ID_SET.has(id)) continue;
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

/**
 * Ketiga daftar penerima tersimpan, hanya yang sah dan tak ganda lintas daftar (data lama/rusak tak boleh sampai ke
 * header surel). Kolom `cc`/`bcc` kosong atau rusak = daftar kosong.
 */
export function parseMailLists(row: Pick<ReportRow, 'recipients' | 'cc' | 'bcc'>): MailLists {
  return sendableMailLists(
    {
      recipients: parseRecipients(row.recipients),
      cc: parseRecipients(row.cc),
      bcc: parseRecipients(row.bcc),
    },
    isPostelRecipient,
  );
}
