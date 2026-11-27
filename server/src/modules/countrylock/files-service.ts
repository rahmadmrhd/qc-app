import { writeAudit } from '@server/core/audit';
import { batchGuarded } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import { newId } from '@server/core/id';
import type {
  ClFileDetailDto,
  ClFileDto,
  ClRevisionDetailDto,
  ClRevisionDto,
  GetClFileInput,
  GetClRevisionInput,
  RevertClFileInput,
  SaveClFileInput,
} from '@shared/contract';
import { parseSettingsFile } from '@shared/countrylock-bundle';
import { clFileSnapshot } from './audit';
import { sha256Hex } from './hash';
import {
  advanceHeadStmt,
  CL_CONFLICTS,
  type ClFileHead,
  type ClRevisionRecord,
  getFileById,
  getFileByPath,
  getFileHead,
  getRevision,
  insertFileStmt,
  insertRevisionStmt,
  listFileHeads,
  listRevisions,
  removeFileStmt,
} from './repo';
import { settingsRoleProblem } from './validate';

const STALE_MESSAGE = 'Berkas sudah diubah orang lain. Muat ulang lalu coba lagi.';
const NOT_FOUND_MESSAGE = 'Berkas tidak ditemukan';
const HISTORY_LIMIT = 200;

export function toFileDto(head: ClFileHead): ClFileDto {
  const { file, revision } = head;
  return {
    id: file.id,
    path: file.path,
    role: file.role,
    kind: file.kind,
    headRev: file.headRev,
    size: revision.size,
    sha256: revision.sha256,
    updatedAt: file.updatedAt,
    updatedBy: revision.author,
    removed: file.removedAt !== '',
  };
}

function toRevisionDto(revision: ClRevisionRecord): ClRevisionDto {
  return {
    seq: revision.seq,
    sha256: revision.sha256,
    size: revision.size,
    message: revision.message,
    author: revision.author,
    createdAt: revision.createdAt,
  };
}

/** Ringkasan berkas (tanpa isi teks) menurut id, juga yang terhapus; tak ada = `NOT_FOUND`. */
export async function loadClFileDto(env: Env, id: string): Promise<ClFileDto> {
  const head = await getFileHead(env.DB, id);
  if (head === null) throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  return toFileDto(head);
}

/** Isi teks sebuah revisi terbaru berkas dibaca ulang dari basis data agar DTO selalu sama dengan yang tersimpan. */
async function loadDetail(env: Env, id: string): Promise<ClFileDetailDto> {
  const head = await getFileHead(env.DB, id);
  if (head === null) throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  const revision = await getRevision(env.DB, id, head.file.headRev);
  return { ...toFileDto(head), text: revision?.textBody ?? null };
}

/** Berkas hidup menurut id, atau `NOT_FOUND` (terhapus atau tak ada). */
async function requireLive(env: Env, id: string): Promise<ClFileHead> {
  const head = await getFileHead(env.DB, id);
  if (head === null || head.file.removedAt !== '') throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  return head;
}

function checkTextRules(path: string, role: string, text: string): void {
  const roleProblem = settingsRoleProblem(path, role);
  if (roleProblem !== null) throw appError('VALIDATION', roleProblem, { role: roleProblem });
  if (role === 'settings') {
    const parsed = parseSettingsFile(text);
    if (!parsed.ok) throw appError('VALIDATION', parsed.error, { text: parsed.error });
  }
}

export async function listClFiles(env: Env): Promise<ClFileDto[]> {
  return (await listFileHeads(env.DB)).map(toFileDto);
}

/** Berkas (juga yang sudah dihapus: hanya dapat dibaca) beserta isi teks terbarunya. */
export async function getClFile(env: Env, input: GetClFileInput): Promise<ClFileDetailDto> {
  return loadDetail(env, input.id);
}

export async function clFileHistory(env: Env, input: GetClFileInput): Promise<ClRevisionDto[]> {
  const file = await getFileById(env.DB, input.id);
  if (file === null) throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  return (await listRevisions(env.DB, file.id, HISTORY_LIMIT)).map(toRevisionDto);
}

export async function getClRevision(
  env: Env,
  input: GetClRevisionInput,
): Promise<ClRevisionDetailDto> {
  const file = await getFileById(env.DB, input.id);
  if (file === null) throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  const revision = await getRevision(env.DB, file.id, Number(input.seq));
  if (revision === null) throw appError('NOT_FOUND', 'Revisi tidak ditemukan');
  return { ...toRevisionDto(revision), text: revision.textBody };
}

/**
 * Menyimpan teks berkas sebagai revisi baru. Berkas baru (tanpa berkas hidup bernama sama) = revisi 1; berkas yang ada
 * wajib membawa `baseSeq` (revisi yang dilihat editor) dan `expectedUpdatedAt` bila ada harus sama: selain itu `staleError`.
 * Teks yang sama dengan revisi terbaru = no-op. Nomor revisi = `head_rev + 1`, dijaga CAS `head_rev` yang digabung ke
 * pernyataan UPDATE PERTAMA di `batch()` (menguncinya) sehingga penulis serentak dari dasar yang sama gagal, bukan menimpa.
 */
export async function saveClFile(
  env: Env,
  input: SaveClFileInput,
  actor: ActorRef,
): Promise<ClFileDetailDto> {
  checkTextRules(input.path, input.role, input.text);
  const sha256 = await sha256Hex(input.text);
  const size = new TextEncoder().encode(input.text).length;
  const message = input.message ?? '';
  const existing = await getFileByPath(env.DB, input.path);

  if (existing === null) {
    if (input.baseSeq !== undefined)
      throw staleError('Berkas sudah dihapus. Muat ulang daftar berkas.');
    const now = nowIso(env);
    const id = newId();
    const revision: ClRevisionRecord = {
      id: newId(),
      fileId: id,
      seq: 1,
      sha256,
      size,
      textBody: input.text,
      message,
      author: actor.email,
      createdAt: now,
    };
    const file = {
      id,
      path: input.path,
      role: input.role,
      kind: 'text' as const,
      headRev: 1,
      removedAt: '',
      createdAt: now,
      updatedAt: now,
    };
    await batchGuarded(
      env.DB,
      [
        insertFileStmt(env.DB, file),
        insertRevisionStmt(env.DB, revision),
        writeAudit(env.DB, {
          ts: now,
          actor: actor.email,
          action: 'countrylock.file_save',
          target: input.path,
          targetId: id,
          before: null,
          after: clFileSnapshot(file, revision),
        }),
      ],
      CL_CONFLICTS,
      STALE_MESSAGE,
    );
    return loadDetail(env, id);
  }

  if (existing.path !== input.path || input.baseSeq === undefined) {
    // Nama sudah dipakai berkas hidup (beda huruf besar/kecil atau penyimpanan "baru" atas berkas yang ada).
    throw appError('CONFLICT', 'Nama berkas sudah dipakai', { path: 'Nama berkas sudah dipakai' });
  }
  if (existing.kind !== 'text') {
    throw appError('VALIDATION', 'Berkas biner tidak dapat disunting sebagai teks', {
      path: 'Berkas biner tidak dapat disunting sebagai teks',
    });
  }
  if (existing.role !== input.role) {
    throw appError('VALIDATION', 'Peran berkas tidak dapat diubah', {
      role: 'Peran berkas tidak dapat diubah',
    });
  }
  if (
    input.baseSeq !== existing.headRev ||
    (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== existing.updatedAt)
  ) {
    throw staleError(STALE_MESSAGE);
  }
  const head = await getRevision(env.DB, existing.id, existing.headRev);
  if (head === null) throw staleError(STALE_MESSAGE);
  if (head.sha256 === sha256) return loadDetail(env, existing.id);

  const now = nowIso(env);
  const revision: ClRevisionRecord = {
    id: newId(),
    fileId: existing.id,
    seq: existing.headRev + 1,
    sha256,
    size,
    textBody: input.text,
    message,
    author: actor.email,
    createdAt: now,
  };
  await batchGuarded(
    env.DB,
    [
      advanceHeadStmt(env.DB, existing.id, existing.headRev, revision.seq, now),
      insertRevisionStmt(env.DB, revision),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'countrylock.file_save',
        target: existing.path,
        targetId: existing.id,
        before: clFileSnapshot(existing, head),
        after: clFileSnapshot(existing, revision),
      }),
    ],
    CL_CONFLICTS,
    STALE_MESSAGE,
  );
  return loadDetail(env, existing.id);
}

/** Menandai berkas dihapus (revisinya tetap); path-nya dapat dipakai berkas baru. */
export async function removeClFile(
  env: Env,
  input: GetClFileInput,
  actor: ActorRef,
): Promise<null> {
  const head = await requireLive(env, input.id);
  const now = nowIso(env);
  await batchGuarded(
    env.DB,
    [
      removeFileStmt(env.DB, head.file.id, now),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'countrylock.file_remove',
        target: head.file.path,
        targetId: head.file.id,
        before: clFileSnapshot(head.file, head.revision),
        after: null,
      }),
    ],
    CL_CONFLICTS,
    'Berkas sudah dihapus',
  );
  return null;
}

/** Pengembalian: isi revisi `seq` ditulis sebagai revisi BARU (riwayat tidak ditulis ulang); sama dengan terbaru = no-op. */
export async function revertClFile(
  env: Env,
  input: RevertClFileInput,
  actor: ActorRef,
): Promise<ClFileDetailDto> {
  const current = await requireLive(env, input.id);
  const { file } = current;
  if (file.kind !== 'text') {
    throw appError('VALIDATION', 'Berkas biner tidak dapat dikembalikan dari revisi teks');
  }
  const source = await getRevision(env.DB, file.id, input.seq);
  if (source === null) throw appError('NOT_FOUND', 'Revisi tidak ditemukan');
  if (source.textBody === null) {
    throw appError('VALIDATION', 'Revisi ini tidak memuat isi teks');
  }
  checkTextRules(file.path, file.role, source.textBody);
  if (source.sha256 === current.revision.sha256) return loadDetail(env, file.id);

  const now = nowIso(env);
  const revision: ClRevisionRecord = {
    id: newId(),
    fileId: file.id,
    seq: file.headRev + 1,
    sha256: source.sha256,
    size: source.size,
    textBody: source.textBody,
    message: input.message ?? `Kembalikan ke revisi ${input.seq}`,
    author: actor.email,
    createdAt: now,
  };
  await batchGuarded(
    env.DB,
    [
      advanceHeadStmt(env.DB, file.id, file.headRev, revision.seq, now),
      insertRevisionStmt(env.DB, revision),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'countrylock.file_revert',
        target: file.path,
        targetId: file.id,
        before: clFileSnapshot(file, current.revision),
        after: { ...clFileSnapshot(file, revision), revertedTo: input.seq },
      }),
    ],
    CL_CONFLICTS,
    STALE_MESSAGE,
  );
  return loadDetail(env, file.id);
}
