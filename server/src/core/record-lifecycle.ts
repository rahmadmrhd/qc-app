// Perencana ubah-status, hapus lunak, dan pulihkan yang dipakai bersama model berbasis tabel kecil (pengguna, role,
// lokasi, BU, customer): pola `planItemStatus|Remove|Restore` / `planBrand*` (fase 3) dalam satu bentuk generik agar
// kelima model tidak menulis ulang urutan penjaga + penulisan + audit yang sama (rancangan soft delete §4.3).
//
// Tiap model menyediakan `LifecycleSpec` (tabel, awalan audit, cara memberi nama/snapshot/DTO) dan memanggil perencana
// di sini DARI perencana per-record-nya sendiri setelah memuat record (hidup atau terhapus) dan memeriksa syarat
// bisnis khusus model (mis. role dipakai pengguna hidup, akun sendiri). Urutan pernyataan selalu: penjaga versi
// (`versionGuardStmt`, mengunci baris dan membatalkan `batch()` bila `updated_at`/keadaan hapus berubah), penulisan,
// `stampStmt` (versi baru), lalu audit.

import { type AuditInput, writeAudit } from '@server/core/audit';
import type { ActorRef } from '@server/core/context';
import type { DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { PlanOutcome } from '@server/core/record-batch';
import {
  restoreStmt,
  type SoftDeleteTable,
  softDeleteStmt,
  stampStmt,
  versionGuardStmt,
} from '@server/core/soft-delete';
import type { RemoveResult } from '@shared/batch';

/** Bentuk minimum record yang dapat dihapus lunak. `status` hanya ada pada model berstatus (role tidak punya). */
export interface LifecycleRecord {
  id: string;
  updatedAt: string;
  updatedBy: string;
  /** ISO UTC; `''` = hidup. */
  deletedAt: string;
  deletedBy: string;
  status?: 'active' | 'inactive';
}

export interface LifecycleSpec<R extends LifecycleRecord, D> {
  table: SoftDeleteTable;
  /** Awalan aksi audit (`user` -> `user.activate|deactivate|delete|restore`). */
  audit: string;
  /** Kata benda untuk pesan "Nonaktifkan <noun> dulu sebelum dihapus". Model tanpa status (role) tak memakainya. */
  noun: string;
  /** Teks `audit_log.target` (nama/email/kode yang dikenali manusia). */
  auditTarget: (record: R) => string;
  /** Field bisnis untuk `before`/`after` audit. */
  snapshot: (record: R) => Record<string, unknown>;
  toDto: (record: R) => D;
  /** Aksi audit untuk aktif/nonaktif; bawaan `<audit>.activate|deactivate`. */
  statusActions?: { active: string; inactive: string };
}

function auditOf(
  env: Env,
  actor: ActorRef,
  now: string,
  action: string,
  id: string,
  target: string,
  before: unknown,
  after: unknown,
): DbStatement {
  const entry: AuditInput = {
    ts: now,
    actor: actor.email,
    action,
    target,
    targetId: id,
    before,
    after,
  };
  return writeAudit(env.DB, entry);
}

/** `UPDATE <tabel> SET status = ?` untuk model berstatus; versi dinaikkan bersamanya. */
export function setStatusStmt(
  db: Preparer,
  table: SoftDeleteTable,
  id: string,
  status: 'active' | 'inactive',
  now: string,
  actor: string,
): DbStatement {
  return db
    .prepare(`UPDATE ${table} SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
    .bind(status, now, actor, id);
}

/** Perencana ubah status (record HIDUP). Status sama = `unchanged` (tanpa tulis dan tanpa audit). */
export function planStatusChange<R extends LifecycleRecord, D>(
  env: Env,
  spec: LifecycleSpec<R, D>,
  record: R,
  status: 'active' | 'inactive',
  actor: ActorRef,
): PlanOutcome<D> {
  if (record.status === status) return { unchanged: spec.toDto(record) };
  const now = nowIso(env);
  const updated: R = { ...record, status, updatedAt: now, updatedBy: actor.email };
  const actions = spec.statusActions ?? {
    active: `${spec.audit}.activate`,
    inactive: `${spec.audit}.deactivate`,
  };
  return {
    dto: spec.toDto(updated),
    stmts: [
      versionGuardStmt(env.DB, spec.table, record.id, record.updatedAt, 'live'),
      setStatusStmt(env.DB, spec.table, record.id, status, now, actor.email),
      auditOf(
        env,
        actor,
        now,
        status === 'active' ? actions.active : actions.inactive,
        record.id,
        spec.auditTarget(record),
        spec.snapshot(record),
        spec.snapshot(updated),
      ),
    ],
  };
}

/**
 * Perencana hapus lunak. Sudah terhapus = `unchanged` (tanpa audit; `deleted_at` asli utuh). Model berstatus wajib
 * Nonaktif lebih dulu (`CONFLICT`); `requireInactive: false` untuk model tanpa status (role). Syarat tambahan model
 * dilempar pemanggil SEBELUM memanggil fungsi ini.
 */
export function planSoftDelete<R extends LifecycleRecord, D>(
  env: Env,
  spec: LifecycleSpec<R, D>,
  record: R,
  actor: ActorRef,
  requireInactive = true,
): PlanOutcome<RemoveResult> {
  if (record.deletedAt !== '') return { unchanged: { id: record.id } };
  if (requireInactive && record.status !== 'inactive') {
    throw appError('CONFLICT', `Nonaktifkan ${spec.noun} dulu sebelum dihapus`);
  }
  const now = nowIso(env);
  return {
    dto: { id: record.id },
    stmts: [
      versionGuardStmt(env.DB, spec.table, record.id, record.updatedAt, 'live'),
      softDeleteStmt(env.DB, spec.table, record.id, actor.email, now),
      stampStmt(env.DB, spec.table, record.id, now, actor.email),
      auditOf(
        env,
        actor,
        now,
        `${spec.audit}.delete`,
        record.id,
        spec.auditTarget(record),
        spec.snapshot(record),
        { ...spec.snapshot(record), deleted: true },
      ),
    ],
  };
}

/**
 * Perencana pulihkan: model berstatus kembali Nonaktif; belum terhapus = `unchanged`. Konflik kunci dengan record
 * hidup lain diperiksa pemanggil sebelum memanggil ini; indeks unik `_live` tetap menjadi pagar bila ada balapan.
 */
export function planRestore<R extends LifecycleRecord, D>(
  env: Env,
  spec: LifecycleSpec<R, D>,
  record: R,
  actor: ActorRef,
  statusful = true,
): PlanOutcome<D> {
  if (record.deletedAt === '') return { unchanged: spec.toDto(record) };
  const now = nowIso(env);
  const restored: R = {
    ...record,
    ...(statusful ? { status: 'inactive' as const } : {}),
    updatedAt: now,
    updatedBy: actor.email,
    deletedAt: '',
    deletedBy: '',
  };
  const stmts: DbStatement[] = [
    versionGuardStmt(env.DB, spec.table, record.id, record.updatedAt, 'deleted'),
    restoreStmt(env.DB, spec.table, record.id),
  ];
  if (statusful) {
    stmts.push(
      env.DB.prepare(`UPDATE ${spec.table} SET status = 'inactive' WHERE id = ?`).bind(record.id),
    );
  }
  stmts.push(
    stampStmt(env.DB, spec.table, record.id, now, actor.email),
    auditOf(
      env,
      actor,
      now,
      `${spec.audit}.restore`,
      record.id,
      spec.auditTarget(record),
      { ...spec.snapshot(record), deleted: true },
      spec.snapshot(restored),
    ),
  );
  return { dto: spec.toDto(restored), stmts };
}
