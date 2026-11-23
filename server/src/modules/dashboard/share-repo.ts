/**
 * Akses tabel `dashboard_shares` (tautan dashboard publik, spek dashboard bagian 7). Hanya pernyataan SQL dan
 * pembacaan baris; aturan izin dan pembuatan ada di `share-service.ts`. Tabel ini bukan model soft delete:
 * pencabutan = mengisi `revoked_at`.
 */
import { createHash } from 'node:crypto';
import { CAS_FAIL_SQL } from '@server/core/cas';
import type { DbStatement, Preparer } from '@server/core/db';
import {
  DASHBOARD_RANGE_MAX_DAYS,
  validateDashboardRange,
  WIDGET_IDS,
  type WidgetId,
} from '@shared/dashboard';
import {
  SHARE_OFFER_KEYS,
  type ShareRange,
  type ShareScope,
  type ShareWidgetScope,
} from '@shared/dashboard-share';

export interface ShareRow {
  id: string;
  title: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string;
  revoked_by: string;
  /** JSON `ShareScope`. */
  scope: string;
  /** Terisi bila diterbitkan laporan terjadwal; kosong = dibagikan manual. */
  report_id: string;
}

const COLUMNS =
  'id, title, created_by, created_at, expires_at, revoked_at, revoked_by, scope, report_id';

export function insertShareStmt(db: Preparer, row: ShareRow): DbStatement {
  return db
    .prepare(`INSERT INTO dashboard_shares (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      row.id,
      row.title,
      row.created_by,
      row.created_at,
      row.expires_at,
      row.revoked_at,
      row.revoked_by,
      row.scope,
      row.report_id,
    );
}

export async function loadShare(db: Preparer, id: string): Promise<ShareRow | null> {
  return db
    .prepare(`SELECT ${COLUMNS} FROM dashboard_shares WHERE id = ?`)
    .bind(id)
    .first<ShareRow>();
}

/**
 * Semua tautan, terbaru dahulu. Tautan terbitan laporan terjadwal (`report_id` terisi) hanya ikut bila
 * `includeReport` true.
 */
export async function listShares(db: Preparer, includeReport: boolean): Promise<ShareRow[]> {
  const where = includeReport ? '' : "WHERE report_id = ''";
  const result = await db
    .prepare(`SELECT ${COLUMNS} FROM dashboard_shares ${where} ORDER BY created_at DESC, id DESC`)
    .all<ShareRow>();
  return result.results;
}

/** Jumlah tautan aktif (belum dicabut, belum kedaluwarsa) milik `creator`; terbitan laporan tidak dihitung. */
export async function countActiveShares(
  db: Preparer,
  creator: string,
  nowIso: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM dashboard_shares
       WHERE created_by = ? AND revoked_at = '' AND expires_at > ? AND report_id = ''`,
    )
    .bind(creator, nowIso)
    .first<{ n: number | string }>();
  return Number(row?.n ?? 0);
}

/** Kunci baris penghitung per pembagi (hash surel agar muat di `counters.key` 128 karakter). */
function shareLockKey(creator: string): string {
  return `dashboard_share:${createHash('sha256').update(creator).digest('hex')}`;
}

/**
 * Memastikan baris kunci pembagi ada; dipanggil SEBELUM `batch()` pembuatan, di luar transaksi (menyisipkannya di dalam
 * batch oleh penulis serentak yang pertama menyebabkan deadlock pada kunci duplikat).
 */
export function ensureShareLockStmt(db: Preparer, creator: string): DbStatement {
  return db
    .prepare('INSERT IGNORE INTO counters (`key`, value) VALUES (?, 0)')
    .bind(shareLockKey(creator));
}

/**
 * Penjaga batas tautan aktif untuk digabung ke `batch()` pembuatan (sebelum penyisipan). (1) Menaikkan baris kunci
 * pembagi di `counters` (kunci eksklusif sampai COMMIT, jadi pembuatan serentak oleh pembagi yang sama diserialkan);
 * (2) `SELECT` yang membatalkan batch (`CAS_FAIL_SQL`, dikenali `isGuardFailure`) bila jumlah tautan aktifnya sudah
 * mencapai `max`. Hitungan dibaca SETELAH kunci didapat (pembacaan konsisten pertama transaksi), jadi melihat commit
 * penulis sebelumnya; hitung-lalu-tulis tanpa kunci meloloskan penulis serentak melewati batas.
 */
export function activeLimitGuardStmts(
  db: Preparer,
  creator: string,
  nowIso: string,
  max: number,
): DbStatement[] {
  return [
    db
      .prepare(
        'INSERT INTO counters (`key`, value) VALUES (?, 1) ON DUPLICATE KEY UPDATE value = value + 1',
      )
      .bind(shareLockKey(creator)),
    db
      .prepare(
        `SELECT CASE WHEN (SELECT COUNT(*) FROM dashboard_shares WHERE created_by = ? AND revoked_at = '' AND expires_at > ? AND report_id = '') < ? THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok`,
      )
      .bind(creator, nowIso, max),
  ];
}

/** Mencabut tautan. Idempoten: tautan yang sudah dicabut tak berubah (`revoked_at` pertama dipertahankan). */
export function revokeShareStmt(db: Preparer, id: string, by: string, nowIso: string): DbStatement {
  return db
    .prepare(
      "UPDATE dashboard_shares SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at = ''",
    )
    .bind(nowIso, by, id);
}

const WIDGET_ID_SET: ReadonlySet<string> = new Set(WIDGET_IDS);
const OFFER_KEY_SET: ReadonlySet<string> = new Set(SHARE_OFFER_KEYS);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseRange(value: unknown): ShareRange | null {
  if (typeof value !== 'object' || value === null) return null;
  const range = value as Record<string, unknown>;
  if (range.mode === 'rolling') {
    const days = range.days;
    if (typeof days !== 'number' || !Number.isInteger(days)) return null;
    if (days < 1 || days > DASHBOARD_RANGE_MAX_DAYS) return null;
    return { mode: 'rolling', days };
  }
  if (range.mode === 'fixed') {
    const { from, to } = range;
    if (typeof from !== 'string' || typeof to !== 'string') return null;
    if (validateDashboardRange({ from, to }) !== null) return null;
    return { mode: 'fixed', from, to };
  }
  return null;
}

function parseWidgets(value: unknown): ShareWidgetScope[] | null {
  if (!Array.isArray(value)) return null;
  const widgets: ShareWidgetScope[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const { id, filters } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !WIDGET_ID_SET.has(id)) return null;
    if (typeof filters !== 'object' || filters === null || Array.isArray(filters)) return null;
    const parsed: Record<string, string[]> = {};
    for (const [key, list] of Object.entries(filters)) {
      if (!isStringArray(list)) return null;
      parsed[key] = list;
    }
    widgets.push({ id: id as WidgetId, filters: parsed });
  }
  return widgets;
}

/** Mengurai kolom `scope`. `null` bila JSON rusak atau bentuknya tak sah (pemanggil menjawab 404 seragam). */
export function parseScope(raw: string): ShareScope | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const scope = value as Record<string, unknown>;
  if (!isStringArray(scope.buIds) || !isStringArray(scope.locationIds)) return null;
  if (typeof scope.locationFiltered !== 'boolean') return null;
  if (!isStringArray(scope.offers) || !scope.offers.every((key) => OFFER_KEY_SET.has(key))) {
    return null;
  }
  const range = parseRange(scope.range);
  const widgets = parseWidgets(scope.widgets);
  if (range === null || widgets === null) return null;
  return {
    buIds: scope.buIds,
    locationIds: scope.locationIds,
    locationFiltered: scope.locationFiltered,
    range,
    widgets,
    offers: scope.offers,
  };
}
