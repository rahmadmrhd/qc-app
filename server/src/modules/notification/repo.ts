import type { DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { liveWhere } from '@server/core/soft-delete';
import {
  NOTIFICATION_PREVIEW_MAX,
  NOTIFICATION_RETENTION_DAYS,
  type NotificationDto,
  type NotificationKind,
  SERIAL_NOTIFICATION_KINDS,
} from '@shared/notifications';

/**
 * Akses database kotak notifikasi (`notifications`). Satu baris per penerima per kejadian; penerima dikunci email
 * ternormalisasi. Penulisan baris baru memakai pernyataan siap-`batch()` (digabung ke penulisan task agar atomik);
 * baca dan tandai-dibaca langsung. Daftar dan hitungan SELALU disaring lokasi yang masih berhak dibaca pemanggil
 * (spek §5.1: hak akses diperiksa saat dibaca).
 */

export interface NewNotification {
  /** Email ternormalisasi penerima. */
  recipient: string;
  kind: NotificationKind;
  /** Kosong untuk `createdBatch`. */
  handoverId: string;
  locationId: string;
  /** Kosong untuk `createdBatch`. */
  number: string;
  customerName: string;
  actorEmail: string;
  actorName: string;
  /** Jumlah butir (`checked`) atau task (`createdBatch`); selain itu 0. */
  count: number;
  preview: string;
  createdAt: string;
  /** Id Serial Number (jenis Serial); kosong bila tak diisi. */
  serialId?: string;
  /** Id foto bukti (`serialProofFailed`); kosong bila tak diisi. */
  photoId?: string;
}

type Row = Record<string, string | number | null>;

const INSERT_CHUNK = 100;
const DAY_MS = 86_400_000;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Memotong menurut titik kode (bukan unit UTF-16) agar emoji tak terbelah. */
function clip(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

/**
 * INSERT baris notifikasi baru (`push_state` bawaan 'pending', `read_at` kosong), dipotong per 100 baris per
 * pernyataan. Daftar kosong = tanpa pernyataan. `preview` dipotong ke `NOTIFICATION_PREVIEW_MAX` karakter.
 */
export function insertNotificationStmts(
  db: Preparer,
  rows: readonly NewNotification[],
): DbStatement[] {
  const statements: DbStatement[] = [];
  for (let from = 0; from < rows.length; from += INSERT_CHUNK) {
    const chunk = rows.slice(from, from + INSERT_CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    statements.push(
      db
        .prepare(
          `INSERT INTO notifications (id, recipient, kind, handover_id, location_id, number, customer_name, actor_email, actor_name, \`count\`, preview, created_at, serial_id, proof_id) VALUES ${placeholders}`,
        )
        .bind(
          ...chunk.flatMap((row) => [
            crypto.randomUUID(),
            row.recipient,
            row.kind,
            row.handoverId,
            row.locationId,
            row.number,
            row.customerName,
            row.actorEmail,
            row.actorName,
            row.count,
            clip(row.preview, NOTIFICATION_PREVIEW_MAX),
            row.createdAt,
            row.serialId ?? '',
            row.photoId ?? '',
          ]),
        ),
    );
  }
  return statements;
}

const COLUMNS =
  'id, kind, handover_id, location_id, number, customer_name, actor_name, `count`, preview, created_at, read_at, serial_id, proof_id';

function toDto(row: Row): NotificationDto {
  return {
    id: text(row.id),
    kind: text(row.kind) as NotificationKind,
    handoverId: text(row.handover_id),
    locationId: text(row.location_id),
    number: text(row.number),
    customerName: text(row.customer_name),
    actor: text(row.actor_name),
    count: Number(row.count),
    preview: text(row.preview),
    createdAt: text(row.created_at),
    readAt: text(row.read_at),
    serialId: text(row.serial_id),
    photoId: text(row.proof_id),
  };
}

/** Cakupan baca notifikasi pemanggil: lokasi (jenis Serah Terima) dan BU serial (jenis Serial; hak dihitung saat dibaca). */
export interface NotificationScope {
  locationIds: readonly string[];
  /** Kosong bila pemanggil tak punya hak baca serial (jenis Serial tersembunyi). */
  serialBuIds?: readonly string[];
}

/**
 * Klausa WHERE cakupan baca (tanpa `recipient`): jenis Serah Terima disaring lokasi yang berhak dibaca, jenis Serial
 * disaring BU serial entrinya (`serial_id` -> `serials.bu_id`); serial TERHAPUS menyembunyikan notifikasinya bagi semua
 * (soft delete; pulihkan memunculkannya lagi). Aturan keduanya tak pernah saling melonggarkan. `null`
 * bila tak ada cakupan sama sekali (hasil kosong tanpa kueri).
 */
function scopeClause(scope: NotificationScope): { sql: string; params: string[] } | null {
  const locationIds = [...new Set(scope.locationIds)];
  const buIds = [...new Set(scope.serialBuIds ?? [])];
  const kinds = SERIAL_NOTIFICATION_KINDS.map(() => '?').join(', ');
  const parts: string[] = [];
  const params: string[] = [];
  if (locationIds.length > 0) {
    parts.push(
      `(kind NOT IN (${kinds}) AND location_id IN (${locationIds.map(() => '?').join(', ')}))`,
    );
    params.push(...SERIAL_NOTIFICATION_KINDS, ...locationIds);
  }
  if (buIds.length > 0) {
    const marks = buIds.map(() => '?').join(', ');
    parts.push(
      `(kind IN (${kinds}) AND (serial_id IN (SELECT s0.id FROM serials s0 WHERE ${liveWhere('s0')} AND s0.bu_id IN (${marks})) OR serial_id IN (SELECT sbu.serial_id FROM serial_business_units sbu JOIN serials s ON s.id = sbu.serial_id WHERE ${liveWhere('s')} AND sbu.bu_id IN (${marks}) AND sbu.left_at > '')))`,
    );
    // BU saat ini ATAU riwayat BU (spek serial unik se-sistem §5.3); daftar BU diikat dua kali.
    params.push(...SERIAL_NOTIFICATION_KINDS, ...buIds, ...buIds);
  }
  return parts.length === 0 ? null : { sql: `(${parts.join(' OR ')})`, params };
}

/**
 * Notifikasi pemanggil, terbaru dulu (`created_at`, `id` menurun), hanya dalam `scope` (kosong = hasil kosong
 * tanpa kueri). Kursor = `createdAt|id` baris terakhir halaman sebelumnya; kursor rusak = halaman kosong.
 */
export async function listNotifications(
  env: Env,
  recipient: string,
  opts: NotificationScope & { limit: number; before?: string },
): Promise<{ items: NotificationDto[]; nextCursor: string | null }> {
  const empty = { items: [], nextCursor: null };
  const scope = scopeClause(opts);
  if (scope === null) return empty;
  const limit = Math.max(1, Math.floor(opts.limit));
  const where = ['recipient = ?', scope.sql];
  const params: Array<string | number> = [recipient, ...scope.params];
  if (opts.before !== undefined && opts.before !== '') {
    const cut = opts.before.indexOf('|');
    if (cut <= 0) return empty;
    const at = opts.before.slice(0, cut);
    const id = opts.before.slice(cut + 1);
    where.push('(created_at < ? OR (created_at = ? AND id < ?))');
    params.push(at, at, id);
  }
  const result = await env.DB.prepare(
    `SELECT ${COLUMNS} FROM notifications WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(...params, limit + 1)
    .all<Row>();
  const page = result.results.slice(0, limit).map(toDto);
  const last = page[page.length - 1];
  const hasMore = result.results.length > limit && last !== undefined;
  return { items: page, nextCursor: hasMore ? `${last.createdAt}|${last.id}` : null };
}

/** Jumlah belum dibaca milik pemanggil di lokasi/BU serial yang berhak dibaca (kosong = 0 tanpa kueri). */
export async function countUnread(
  env: Env,
  recipient: string,
  locationIds: readonly string[],
  serialBuIds: readonly string[] = [],
): Promise<number> {
  const clause = scopeClause({ locationIds, serialBuIds });
  if (clause === null) return 0;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM notifications WHERE recipient = ? AND read_at = '' AND ${clause.sql}`,
  )
    .bind(recipient, ...clause.params)
    .first<{ n: number | string }>();
  return Number(row?.n ?? 0);
}

/**
 * Menandai satu notifikasi dibaca. `false` bila id bukan milik `recipient` (atau tak ada); menandai ulang yang
 * sudah dibaca tetap `true` dan tidak mengubah `read_at` pertamanya.
 */
export async function markRead(
  env: Env,
  recipient: string,
  id: string,
  now: string,
): Promise<boolean> {
  await env.DB.prepare(
    "UPDATE notifications SET read_at = ? WHERE id = ? AND recipient = ? AND read_at = ''",
  )
    .bind(now, id, recipient)
    .run();
  const row = await env.DB.prepare('SELECT id FROM notifications WHERE id = ? AND recipient = ?')
    .bind(id, recipient)
    .first<Row>();
  return row !== null;
}

/** Menandai semua notifikasi pemanggil yang belum dibaca; mengembalikan jumlah baris yang berubah. */
export async function markAllRead(env: Env, recipient: string, now: string): Promise<number> {
  const result = await env.DB.prepare(
    "UPDATE notifications SET read_at = ? WHERE recipient = ? AND read_at = ''",
  )
    .bind(now, recipient)
    .run();
  return result.meta.changes;
}

/** Membuang notifikasi lebih tua dari `NOTIFICATION_RETENTION_DAYS` (jam `nowOf(env)`); mengembalikan jumlahnya. */
export async function purgeOldNotifications(env: Env): Promise<number> {
  const cutoff = new Date(nowOf(env) - NOTIFICATION_RETENTION_DAYS * DAY_MS).toISOString();
  const result = await env.DB.prepare('DELETE FROM notifications WHERE created_at < ?')
    .bind(cutoff)
    .run();
  return result.meta.changes;
}

/**
 * Notifikasi milik `recipient` dengan `created_at >= fromIso`, urut LAMA -> BARU (untuk aliran SSE desktop). Tidak
 * disaring lokasi: pemanggil menyaring dengan `hasReadAccess` (hak diperiksa saat dikirim, bukan saat ditulis).
 * Memakai indeks `notifications_recipient (recipient, created_at, id)`.
 */
export async function listNotificationsSince(
  env: Env,
  recipient: string,
  opts: { fromIso: string; limit: number },
): Promise<NotificationDto[]> {
  const result = await env.DB.prepare(
    `SELECT ${COLUMNS} FROM notifications WHERE recipient = ? AND created_at >= ? ORDER BY created_at ASC, id ASC LIMIT ?`,
  )
    .bind(recipient, opts.fromIso, Math.max(1, Math.floor(opts.limit)))
    .all<Row>();
  return result.results.map(toDto);
}
