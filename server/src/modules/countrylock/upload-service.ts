import { writeAudit } from '@server/core/audit';
import { batchGuarded, CAS_FAIL_SQL } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import { DbError } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { newId } from '@server/core/id';
import { readObject } from '@server/core/validate';
import type {
  ChunkClUploadInput,
  ClFileDto,
  ClUploadSessionDto,
  FinishClUploadInput,
  StartClUploadInput,
} from '@shared/contract';
import {
  CL_BINARY_MAX_BYTES,
  CL_CHUNK_BYTES,
  CL_PATH_MAX,
  validateClPath,
} from '@shared/countrylock-bundle';
import { clFileSnapshot } from './audit';
import { storeBlob } from './blob-store';
import { assertRoomForNewFile, loadClFileDto } from './files-service';
import { sha256Hex } from './hash';
import {
  advanceHeadStmt,
  blobGuardStmt,
  CL_CONFLICTS,
  type ClRevisionRecord,
  getFileByPath,
  getRevision,
  insertFileStmt,
  insertRevisionStmt,
} from './repo';
import { settingsRoleProblem } from './validate';

const NOT_FOUND_MESSAGE = 'Sesi unggah tidak ditemukan';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const IDX_PATTERN = /^\d{1,6}$/;
const MAX_ID_LENGTH = 100;

// --- Validasi ----------------------------------------------------------------------------------------------------

export function validateStartClUpload(raw: unknown): StartClUploadInput {
  const reader = readObject(raw);
  const path = reader.str('path', { required: true, max: CL_PATH_MAX });
  const role = reader.oneOf('role', ['router'] as const);
  const rawSize = reader.raw('size');
  let size = 1;
  if (
    typeof rawSize !== 'number' ||
    !Number.isSafeInteger(rawSize) ||
    rawSize < 1 ||
    rawSize > CL_BINARY_MAX_BYTES
  ) {
    reader.fail('size', `Ukuran berkas harus 1 sampai ${CL_BINARY_MAX_BYTES / (1024 * 1024)} MB`);
  } else {
    size = rawSize;
  }
  const rawSha = reader.raw('sha256');
  let sha256 = '';
  if (typeof rawSha !== 'string' || !SHA256_PATTERN.test(rawSha)) {
    reader.fail('sha256', 'sha256 harus 64 heksadesimal huruf kecil');
  } else {
    sha256 = rawSha;
  }
  if (path !== '') {
    const problem = validateClPath(path) ?? settingsRoleProblem(path, role);
    if (problem !== null) reader.fail('path', problem);
  }
  reader.done();
  return { path, role, size, sha256 };
}

export function validateChunkClUpload(raw: unknown): ChunkClUploadInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: MAX_ID_LENGTH });
  const idx = reader.raw('idx');
  if (typeof idx !== 'string' || !IDX_PATTERN.test(idx))
    reader.fail('idx', 'Nomor potongan tidak valid');
  const bytes = reader.raw('bytes');
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    reader.fail('bytes', 'Isi potongan tidak valid');
  } else if (bytes.length > CL_CHUNK_BYTES) {
    reader.fail('bytes', `Potongan maksimal ${CL_CHUNK_BYTES / (1024 * 1024)} MB`);
  }
  reader.done();
  return { id, idx: idx as string, bytes: bytes as Uint8Array };
}

export function validateFinishClUpload(raw: unknown): FinishClUploadInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: MAX_ID_LENGTH });
  reader.done();
  return { id };
}

// --- Sesi --------------------------------------------------------------------------------------------------------

interface UploadSession {
  id: string;
  path: string;
  size: number;
  sha256: string;
  chunkCount: number;
  state: 'open' | 'done' | 'aborted';
  owner: string;
}

async function loadSession(env: Env, id: string, actor: ActorRef): Promise<UploadSession> {
  const row = await env.DB.prepare(
    'SELECT id, file_path, size, sha256, chunk_count, state, owner FROM cl_uploads WHERE id = ?',
  )
    .bind(id)
    .first<{
      id: string;
      file_path: string;
      size: number | string;
      sha256: string;
      chunk_count: number | string;
      state: UploadSession['state'];
      owner: string;
    }>();
  // Sesi milik orang lain dijawab sama dengan sesi yang tak ada.
  if (row === null || row.owner !== actor.email) throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  return {
    id: row.id,
    path: row.file_path,
    size: Number(row.size),
    sha256: row.sha256,
    chunkCount: Number(row.chunk_count),
    state: row.state,
    owner: row.owner,
  };
}

async function openSession(env: Env, id: string, actor: ActorRef): Promise<UploadSession> {
  const session = await loadSession(env, id, actor);
  if (session.state !== 'open') throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  return session;
}

/** `chunkBytes` hanya untuk tes (memperkecil potongan); produksi memakai `CL_CHUNK_BYTES`. */
export async function startClUpload(
  env: Env,
  input: StartClUploadInput,
  actor: ActorRef,
  options: { chunkBytes?: number } = {},
): Promise<ClUploadSessionDto> {
  const existing = await getFileByPath(env.DB, input.path);
  if (existing !== null && existing.kind !== 'binary') {
    throw appError('VALIDATION', 'Berkas teks tidak dapat diganti dengan biner', {
      path: 'Berkas teks tidak dapat diganti dengan biner',
    });
  }
  if (existing === null) await assertRoomForNewFile(env, 'path');
  const chunkBytes = options.chunkBytes ?? CL_CHUNK_BYTES;
  const now = nowIso(env);
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO cl_uploads (id, file_path, size, sha256, chunk_count, state, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)",
  )
    .bind(
      id,
      input.path,
      input.size,
      input.sha256,
      Math.ceil(input.size / chunkBytes),
      actor.email,
      now,
      now,
    )
    .run();
  return { uploadId: id, chunkBytes };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

async function storedChunk(env: Env, id: string, idx: number): Promise<Uint8Array | null> {
  const row = await env.DB.prepare(
    'SELECT data FROM cl_upload_chunks WHERE upload_id = ? AND idx = ?',
  )
    .bind(id, idx)
    .first<{ data: Uint8Array }>();
  return row === null ? null : new Uint8Array(row.data);
}

/**
 * Menyimpan satu potongan. Harus tepat berurutan mulai 0; idx yang sudah ada dengan isi sama = idempoten, isi beda =
 * `CONFLICT`. Hanya pemilik sesi (lain = `NOT_FOUND`).
 */
export async function putClUploadChunk(
  env: Env,
  input: ChunkClUploadInput,
  actor: ActorRef,
): Promise<{ received: number }> {
  const session = await openSession(env, input.id, actor);
  const idx = Number(input.idx);
  if (idx >= session.chunkCount) {
    throw appError('VALIDATION', 'Nomor potongan melebihi jumlah potongan sesi', {
      idx: 'Nomor potongan melebihi jumlah potongan sesi',
    });
  }
  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM cl_upload_chunks WHERE upload_id = ?',
  )
    .bind(session.id)
    .first<{ n: number | string }>();
  const received = Number(count?.n ?? 0);
  const mismatch = () => appError('CONFLICT', 'Potongan ini sudah ada dengan isi berbeda');
  if (idx < received) {
    const stored = await storedChunk(env, session.id, idx);
    if (stored === null || !sameBytes(stored, input.bytes)) throw mismatch();
    return { received };
  }
  if (idx > received) throw appError('CONFLICT', 'Potongan harus dikirim berurutan');
  try {
    await env.DB.prepare('INSERT INTO cl_upload_chunks (upload_id, idx, data) VALUES (?, ?, ?)')
      .bind(session.id, idx, input.bytes)
      .run();
  } catch (error) {
    // Dua kiriman serentak untuk idx yang sama: yang kedua dianggap pengulangan dan isinya dibandingkan.
    if (!(error instanceof DbError) || error.kind !== 'duplicate') throw error;
    const stored = await storedChunk(env, session.id, idx);
    if (stored === null || !sameBytes(stored, input.bytes)) throw mismatch();
    return { received: idx + 1 };
  }
  await env.DB.prepare('UPDATE cl_uploads SET updated_at = ? WHERE id = ?')
    .bind(nowIso(env), session.id)
    .run();
  return { received: idx + 1 };
}

const SIZE_MISMATCH_MESSAGE =
  'Ukuran hasil unggahan tidak sama dengan yang dinyatakan; sesi dibatalkan, mulai unggahan baru';
const SHA_MISMATCH_MESSAGE =
  'sha256 hasil unggahan tidak sama dengan yang dinyatakan; sesi dibatalkan, mulai unggahan baru';

/**
 * Menandai sesi `aborted` dan membuang potongannya (potongan tak dapat diganti isinya, jadi sesi yang hasilnya tak cocok
 * tak dapat dipulihkan; klien memulai sesi baru). Best-effort: kegagalan di sini tidak menutupi galat validasi aslinya
 * (penyapu 24 jam tetap membersihkannya).
 */
async function abortSession(env: Env, id: string): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE cl_uploads SET state = 'aborted', updated_at = ? WHERE id = ? AND state = 'open'",
      ).bind(nowIso(env), id),
      env.DB.prepare('DELETE FROM cl_upload_chunks WHERE upload_id = ?').bind(id),
    ]);
  } catch (error) {
    console.error(`countrylock: sesi unggah ${id} gagal ditandai aborted: ${String(error)}`);
  }
}

async function assembleChunks(env: Env, session: UploadSession): Promise<Uint8Array> {
  const rows = await env.DB.prepare(
    'SELECT idx, data FROM cl_upload_chunks WHERE upload_id = ? ORDER BY idx',
  )
    .bind(session.id)
    .all<{ idx: number | string; data: Uint8Array }>();
  const parts = rows.results;
  if (parts.length !== session.chunkCount || parts.some((row, i) => Number(row.idx) !== i)) {
    throw appError('VALIDATION', 'Potongan unggahan belum lengkap', {
      id: 'Potongan unggahan belum lengkap',
    });
  }
  const total = parts.reduce((sum, row) => sum + row.data.length, 0);
  if (total !== session.size) {
    await abortSession(env, session.id);
    throw appError('VALIDATION', SIZE_MISMATCH_MESSAGE, { size: SIZE_MISMATCH_MESSAGE });
  }
  return new Uint8Array(Buffer.concat(parts.map((row) => Buffer.from(row.data))));
}

function closeSessionStmts(env: Env, sessionId: string, now: string) {
  return [
    // Penjaga CAS: dua `finish` serentak untuk sesi yang sama, yang kedua membatalkan batch-nya.
    env.DB.prepare(
      `UPDATE cl_uploads SET state = CASE WHEN state = 'open' THEN 'done' ELSE ${CAS_FAIL_SQL} END, updated_at = ? WHERE id = ?`,
    ).bind(now, sessionId),
    env.DB.prepare('DELETE FROM cl_upload_chunks WHERE upload_id = ?').bind(sessionId),
  ];
}

/**
 * Merakit potongan, memeriksa jumlah/ukuran/sha256, menyimpan biner ke Drive (tak diunggah ulang bila sha256 sudah ada)
 * lalu membuat berkas biner (revisi 1) atau revisi baru pada berkas biner yang ada. Isi sama dengan revisi terbaru =
 * no-op. Ukuran/sha256 tak cocok = `VALIDATION` dan sesi ditandai `aborted` (potongan dibuang; mulai sesi baru). `finish` ulang pada sesi selesai mengembalikan
 * berkas yang sama.
 */
export async function finishClUpload(
  env: Env,
  input: FinishClUploadInput,
  actor: ActorRef,
): Promise<ClFileDto> {
  const session = await loadSession(env, input.id, actor);
  if (session.state === 'aborted') throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  if (session.state === 'done') {
    const file = await getFileByPath(env.DB, session.path);
    const head = file === null ? null : await getRevision(env.DB, file.id, file.headRev);
    if (file === null || head === null || head.sha256 !== session.sha256) {
      throw appError('CONFLICT', 'Sesi unggah sudah selesai dan berkas sudah berubah');
    }
    return loadClFileDto(env, file.id);
  }

  const bytes = await assembleChunks(env, session);
  const sha256 = await sha256Hex(bytes);
  if (sha256 !== session.sha256) {
    await abortSession(env, session.id);
    throw appError('VALIDATION', SHA_MISMATCH_MESSAGE, { sha256: SHA_MISMATCH_MESSAGE });
  }

  const existing = await getFileByPath(env.DB, session.path);
  if (existing !== null && (existing.kind !== 'binary' || existing.path !== session.path)) {
    throw appError('CONFLICT', 'Nama berkas sudah dipakai', { path: 'Nama berkas sudah dipakai' });
  }
  const head = existing === null ? null : await getRevision(env.DB, existing.id, existing.headRev);
  const now = nowIso(env);
  if (existing !== null && head !== null && head.sha256 === sha256) {
    await batchGuarded(
      env.DB,
      closeSessionStmts(env, session.id, now),
      CL_CONFLICTS,
      'Sesi unggah sudah diselesaikan',
    );
    return loadClFileDto(env, existing.id);
  }

  if (existing === null) await assertRoomForNewFile(env, 'path');
  // Biner disimpan LEBIH DULU: baris yang merujuknya tak pernah ada tanpa blob di Drive.
  await storeBlob(env, { sha256, bytes });

  const fileId = existing?.id ?? newId();
  const revision: ClRevisionRecord = {
    id: newId(),
    fileId,
    seq: existing === null ? 1 : existing.headRev + 1,
    sha256,
    size: bytes.length,
    textBody: null,
    message: '',
    author: actor.email,
    createdAt: now,
  };
  const statements = [blobGuardStmt(env.DB, sha256), ...closeSessionStmts(env, session.id, now)];
  let audit: ReturnType<typeof writeAudit>;
  if (existing === null) {
    const file = {
      id: fileId,
      path: session.path,
      role: 'router' as const,
      kind: 'binary' as const,
      headRev: 1,
      removedAt: '',
      createdAt: now,
      updatedAt: now,
    };
    statements.push(insertFileStmt(env.DB, file), insertRevisionStmt(env.DB, revision));
    audit = writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: 'countrylock.file_save',
      target: session.path,
      targetId: fileId,
      before: null,
      after: clFileSnapshot(file, revision),
    });
  } else {
    statements.push(
      advanceHeadStmt(env.DB, existing.id, existing.headRev, revision.seq, now),
      insertRevisionStmt(env.DB, revision),
    );
    audit = writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: 'countrylock.file_save',
      target: existing.path,
      targetId: existing.id,
      before: head === null ? null : clFileSnapshot(existing, head),
      after: clFileSnapshot(existing, revision),
    });
  }
  statements.push(audit);
  await batchGuarded(
    env.DB,
    statements,
    CL_CONFLICTS,
    'Berkas sudah diubah orang lain. Muat ulang lalu coba lagi.',
  );
  return loadClFileDto(env, fileId);
}
