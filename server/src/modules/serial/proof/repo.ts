import { CAS_FAIL_SQL } from '@server/core/cas';
import type { DbStatement, Preparer } from '@server/core/db';
import type { SerialProofPhotoDto } from '@shared/contract';
import { SERIAL_PROOF_STATES, type SerialProofState } from '@shared/serials';

/**
 * Foto bukti QC (`serial_proof_photos`; rancangan 2026-11-16 §6.1). Berkas ini satu-satunya yang menulis tabel itu.
 * Siklus: `draft` (unggahan, belum disimpan) -> `queued` (diklaim Simpan, snapshot cap dibekukan) -> `processing` ->
 * `done` | `failed`. `staged_name` (nama berkas sementara buatan server) dan `snapshot_json` TIDAK pernah masuk DTO.
 */

export interface ProofRow {
  id: string;
  serialId: string;
  eventId: string;
  state: SerialProofState;
  createdBy: string;
  createdAt: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  stagedName: string;
  snapshotJson: string;
  fileId: string;
  attempts: number;
  lastError: string;
  updatedAt: string;
}

interface ProofDbRow {
  id: string;
  serial_id: string;
  event_id: string;
  state: string;
  created_by: string;
  created_at: string;
  mime: string;
  width: number | string;
  height: number | string;
  size: number | string;
  staged_name: string;
  snapshot_json: string;
  file_id: string;
  attempts: number | string;
  last_error: string;
  updated_at: string;
}

const COLUMNS =
  'id, serial_id, event_id, state, created_by, created_at, mime, width, height, size, staged_name, snapshot_json, file_id, attempts, last_error, updated_at';

function toState(value: string): SerialProofState {
  const state = value.trim();
  return (SERIAL_PROOF_STATES as readonly string[]).includes(state)
    ? (state as SerialProofState)
    : 'failed';
}

function toRow(row: ProofDbRow): ProofRow {
  return {
    id: row.id.trim(),
    serialId: row.serial_id.trim(),
    eventId: row.event_id.trim(),
    state: toState(row.state),
    createdBy: row.created_by,
    createdAt: row.created_at,
    mime: row.mime,
    width: Number(row.width),
    height: Number(row.height),
    size: Number(row.size),
    stagedName: row.staged_name,
    snapshotJson: row.snapshot_json,
    fileId: row.file_id.trim(),
    attempts: Number(row.attempts),
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

const EXTENSION_OF_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Nama unduhan yang disarankan: `bukti-<8 awal id>.<ekstensi menurut MIME saat ini>`. */
export function proofFilename(id: string, mime: string): string {
  return `bukti-${id.trim().slice(0, 8)}.${EXTENSION_OF_MIME[mime] ?? 'webp'}`;
}

/** Baris -> DTO (tanpa `staged_name` dan `snapshot_json`). */
export function toProofDto(row: ProofRow): SerialProofPhotoDto {
  return {
    id: row.id,
    state: row.state,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    filename: proofFilename(row.id, row.mime),
    error: row.lastError === '' ? null : row.lastError,
  };
}

export interface NewDraftProof {
  id: string;
  createdBy: string;
  now: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  stagedName: string;
}

/** Foto `draft` baru (unggahan). `serial_id`/`event_id` kosong sampai Simpan. */
export function insertDraftStmt(db: Preparer, row: NewDraftProof): DbStatement {
  return db
    .prepare(
      "INSERT INTO serial_proof_photos (id, state, created_by, created_at, mime, width, height, size, staged_name, updated_at) VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      row.id,
      row.createdBy,
      row.now,
      row.mime,
      row.width,
      row.height,
      row.size,
      row.stagedName,
      row.now,
    );
}

export async function findProof(db: Preparer, id: string): Promise<ProofRow | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM serial_proof_photos WHERE id = ?`)
    .bind(id)
    .first<ProofDbRow>();
  return row ? toRow(row) : null;
}

/** Jumlah foto `draft` milik pengguna (kuota unggah). */
export async function countDraftsOf(db: Preparer, email: string): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM serial_proof_photos WHERE created_by = ? AND state = 'draft'",
    )
    .bind(email)
    .first<{ n: number | string }>();
  return Number(row?.n ?? 0);
}

/** Foto menurut daftar id (id yang tak ada tidak muncul di hasil). */
export async function findProofsByIds(db: Preparer, ids: readonly string[]): Promise<ProofRow[]> {
  if (ids.length === 0) return [];
  const marks = ids.map(() => '?').join(', ');
  const rows = await db
    .prepare(`SELECT ${COLUMNS} FROM serial_proof_photos WHERE id IN (${marks})`)
    .bind(...ids)
    .all<ProofDbRow>();
  return rows.results.map(toRow);
}

export interface ClaimDraftArgs {
  ids: readonly string[];
  /** Pengunggah; foto milik orang lain tidak dapat diklaim. */
  email: string;
  serialId: string;
  eventId: string;
  /** Data cap yang dibekukan saat Simpan (JSON). */
  snapshotJson: string;
  now: string;
}

/**
 * Klaim foto `draft` ke kejadian, untuk ikut `batch()` penulisan kejadian itu. Tiap foto diklaim `UPDATE ... WHERE
 * state='draft' AND created_by=?` (arus serentak menunggu kunci baris lalu tak cocok), dan SATU penjaga di akhir
 * membatalkan seluruh batch (`CAS_FAIL_SQL`) bila jumlah foto yang kini `queued` pada kejadian ini bukan jumlah id
 * yang diminta: id milik orang lain, bukan `draft` (sudah dipakai/disapu), tak ada, atau id ganda. Daftar kosong =
 * tanpa pernyataan.
 */
export function claimDraftStmts(db: Preparer, args: ClaimDraftArgs): DbStatement[] {
  if (args.ids.length === 0) return [];
  const distinct = [...new Set(args.ids)];
  const updates = distinct.map((id) =>
    db
      .prepare(
        "UPDATE serial_proof_photos SET state = 'queued', serial_id = ?, event_id = ?, snapshot_json = ?, updated_at = ? WHERE id = ? AND state = 'draft' AND created_by = ?",
      )
      .bind(args.serialId, args.eventId, args.snapshotJson, args.now, id, args.email),
  );
  const marks = distinct.map(() => '?').join(', ');
  const guard = db
    .prepare(
      `SELECT CASE WHEN COUNT(*) = ? THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM serial_proof_photos WHERE event_id = ? AND state = 'queued' AND created_by = ? AND id IN (${marks})`,
    )
    .bind(args.ids.length, args.eventId, args.email, ...distinct);
  return [...updates, guard];
}

export interface ProofStatePatch {
  state: SerialProofState;
  /** Hanya berlaku bila foto masih berstatus ini (CAS ringan); kosong = tanpa syarat. */
  expectState?: SerialProofState;
  now: string;
  attempts?: number;
  lastError?: string;
  fileId?: string;
  stagedName?: string;
  mime?: string;
  width?: number;
  height?: number;
  size?: number;
}

/** Mengubah status foto (dan kolom hasil proses yang ikut berubah). Untuk `batch()` atau `run()`. */
export function setProofState(db: Preparer, id: string, patch: ProofStatePatch): DbStatement {
  const sets = ['state = ?', 'updated_at = ?'];
  const binds: unknown[] = [patch.state, patch.now];
  const optional: [string, string | number | undefined][] = [
    ['attempts', patch.attempts],
    ['last_error', patch.lastError],
    ['file_id', patch.fileId],
    ['staged_name', patch.stagedName],
    ['mime', patch.mime],
    ['width', patch.width],
    ['height', patch.height],
    ['size', patch.size],
  ];
  for (const [column, value] of optional) {
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    binds.push(value);
  }
  let sql = `UPDATE serial_proof_photos SET ${sets.join(', ')} WHERE id = ?`;
  binds.push(id);
  if (patch.expectState) {
    sql += ' AND state = ?';
    binds.push(patch.expectState);
  }
  return db.prepare(sql).bind(...binds);
}

/** Foto per kejadian (urut unggah), sebagai DTO; kejadian tanpa foto tidak punya entri. */
export async function listProofsByEvents(
  db: Preparer,
  eventIds: readonly string[],
): Promise<Map<string, SerialProofPhotoDto[]>> {
  const byEvent = new Map<string, SerialProofPhotoDto[]>();
  if (eventIds.length === 0) return byEvent;
  const marks = eventIds.map(() => '?').join(', ');
  const rows = await db
    .prepare(
      `SELECT ${COLUMNS} FROM serial_proof_photos WHERE event_id IN (${marks}) ORDER BY created_at ASC, id ASC`,
    )
    .bind(...eventIds)
    .all<ProofDbRow>();
  for (const raw of rows.results) {
    const row = toRow(raw);
    const list = byEvent.get(row.eventId);
    if (list) list.push(toProofDto(row));
    else byEvent.set(row.eventId, [toProofDto(row)]);
  }
  return byEvent;
}

/** Foto `draft` yang terakhir berubah sebelum `beforeIso` (bahan sapuan; yang `queued`/`processing` tak pernah ikut). */
export async function listStaleDrafts(
  db: Preparer,
  beforeIso: string,
  limit = 200,
): Promise<{ id: string; stagedName: string }[]> {
  const rows = await db
    .prepare(
      "SELECT id, staged_name FROM serial_proof_photos WHERE state = 'draft' AND updated_at < ? ORDER BY updated_at ASC LIMIT ?",
    )
    .bind(beforeIso, limit)
    .all<{ id: string; staged_name: string }>();
  return rows.results.map((row) => ({ id: row.id.trim(), stagedName: row.staged_name }));
}

/** Menghapus baris foto (draft yang disapu/dibuang, atau foto `failed` yang dibuang pelaku). */
export function deleteProofStmt(db: Preparer, id: string): DbStatement {
  return db.prepare('DELETE FROM serial_proof_photos WHERE id = ?').bind(id);
}
