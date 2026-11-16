import type { DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import { SERIAL_PROOF_LIMITS } from '@shared/serials';
import { serialProofJobStmt } from './job';
import { claimDraftStmts, findProofsByIds } from './repo';
import type { ProofSnapshot } from './stamp';

/**
 * Menautkan foto bukti QC saat Simpan (Tambah dan Cek ulang; rancangan 2026-11-16 §6.2). `planProofAttach` memvalidasi
 * lalu mengembalikan pernyataan untuk digabung ke `batch()` penulisan kejadian: klaim ber-CAS tiap foto (`draft` -> `queued`,
 * `event_id`, snapshot cap yang DIBEKUKAN dengan `savedAt` = waktu server saat Simpan) dan SATU job `serial_proof` per foto.
 * Job dipasang atomik di batch yang sama: tidak ada celah "komit tanpa job" dan tidak butuh penyapu penaut ulang.
 */

export const PROOF_UNKNOWN_MESSAGE = 'Ada foto yang tidak dikenal atau sudah dipakai';
export const PROOF_EXPIRED_MESSAGE = 'Foto sudah kedaluwarsa, unggah ulang';

export interface ProofAttachContext {
  user: UserContext;
  serialId: string;
  eventId: string;
  /** Data cap tanpa waktu; `savedAt` diisi dari `now` (waktu server saat Simpan). */
  snapshot: Omit<ProofSnapshot, 'savedAt'>;
  now: string;
}

function invalid(message: string): never {
  throw appError('VALIDATION', message, { proofPhotoIds: message });
}

export async function planProofAttach(
  env: Env,
  ids: readonly string[] | undefined,
  ctx: ProofAttachContext,
): Promise<DbStatement[]> {
  if (ids === undefined || ids.length === 0) return [];
  if (ids.length > SERIAL_PROOF_LIMITS.perEntryMax) {
    invalid(`Maksimal ${SERIAL_PROOF_LIMITS.perEntryMax} foto per entri`);
  }
  if (new Set(ids).size !== ids.length) invalid(PROOF_UNKNOWN_MESSAGE);
  const found = new Map((await findProofsByIds(env.DB, ids)).map((row) => [row.id, row] as const));
  for (const id of ids) {
    const row = found.get(id);
    // Baris tak ada = sudah disapu (atau id sembarang): jawaban yang sama tidak membuka apa pun tentang foto orang lain.
    if (!row) invalid(PROOF_EXPIRED_MESSAGE);
    if (row.state !== 'draft' || row.createdBy !== ctx.user.email) invalid(PROOF_UNKNOWN_MESSAGE);
  }
  const snapshotJson = JSON.stringify({ ...ctx.snapshot, savedAt: ctx.now });
  return [
    ...claimDraftStmts(env.DB, {
      ids,
      email: ctx.user.email,
      serialId: ctx.serialId,
      eventId: ctx.eventId,
      snapshotJson,
      now: ctx.now,
    }),
    ...ids.map((id) => serialProofJobStmt(env, id)),
  ];
}

/** Merk, tipe, dan kode BU untuk cap (nilai kosong bila tak ditemukan; cap tetap dibuat). */
export async function loadStampItemInfo(
  db: Preparer,
  itemId: string,
  buId: string,
): Promise<{ brand: string; model: string; buCode: string }> {
  const item = await db
    .prepare(
      'SELECT b.name AS brand, i.model FROM items i LEFT JOIN brands b ON b.id = i.brand_id WHERE i.id = ?',
    )
    .bind(itemId)
    .first<{ brand: string | null; model: string }>();
  const bu = await db
    .prepare('SELECT code FROM business_units WHERE id = ?')
    .bind(buId)
    .first<{ code: string }>();
  return { brand: item?.brand ?? '', model: (item?.model ?? '').trim(), buCode: bu?.code ?? '' };
}
