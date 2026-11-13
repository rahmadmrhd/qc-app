import { normalizeEmail } from '@server/core/email';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import type { UserContext } from '@server/modules/access/context';
import type { MarkGuideInput, ResetGuideInput } from '@shared/contract';
import { GUIDE_COVERS, GUIDE_VERSIONS, type GuideId, type GuideProgressDto } from '@shared/guides';
import { listProgress, markProgressStmt, resetProgressStmt } from './repo';

/**
 * Panduan interaktif: progres milik pemanggil sendiri (kunci email ternormalisasi), tanpa izin modul. Masukan sudah
 * divalidasi (`validate.ts`: id dikenal, versi 1..versi katalog).
 */

export function listGuides(
  env: Env,
  user: Pick<UserContext, 'email'>,
): Promise<GuideProgressDto[]> {
  return listProgress(env, normalizeEmail(user.email));
}

/**
 * Menandai satu panduan selesai pada `input.version` BERSAMA panduan yang dicakupnya (`covers[id]`, pada versi
 * katalog masing-masing), dalam SATU `batch()`. Idempoten dan tidak pernah menurunkan versi tersimpan.
 */
export async function markGuide(
  env: Env,
  user: Pick<UserContext, 'email'>,
  input: MarkGuideInput,
  covers: Partial<Record<GuideId, readonly GuideId[]>> = GUIDE_COVERS,
): Promise<GuideProgressDto[]> {
  const recipient = normalizeEmail(user.email);
  const now = nowIso(env);
  const statements = [markProgressStmt(env.DB, recipient, input.id, input.version, now)];
  for (const covered of new Set(covers[input.id as GuideId] ?? [])) {
    if (covered === input.id) continue;
    statements.push(
      markProgressStmt(env.DB, recipient, covered, GUIDE_VERSIONS[covered] ?? 1, now),
    );
  }
  await env.DB.batch(statements);
  return listProgress(env, recipient);
}

/** Menghapus progres satu panduan milik pemanggil (agar tampil lagi); tidak ada baris = tak berbuat apa-apa. */
export async function resetGuide(
  env: Env,
  user: Pick<UserContext, 'email'>,
  input: ResetGuideInput,
): Promise<GuideProgressDto[]> {
  const recipient = normalizeEmail(user.email);
  await env.DB.batch([resetProgressStmt(env.DB, recipient, input.id)]);
  return listProgress(env, recipient);
}
