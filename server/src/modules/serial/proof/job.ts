import { getBridge, viaBridge } from '@server/core/bridge-client';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, isAppError } from '@server/core/errors';
import { dropCachedFile } from '@server/core/file-cache';
import { folderIdOf, SETTING_DRIVE_FOLDER_ID } from '@server/core/settings';
import { insertFileStmt } from '@server/modules/files/repo';
import { ensureDriveFolder } from '@server/modules/files/service';
import { insertJobStmt } from '@server/modules/jobs/repo';
import { JOB_SYSTEM_ACTOR } from '@server/modules/jobs/service';
import type { JobHandler, StepContext } from '../../jobs/consumer';
import { findProof, type ProofRow, setProofState } from './repo';
import { type ProofSnapshot, proofSizeError, stampPhoto } from './stamp';
import { newStagedName, type ProofStore } from './store';

/** Pernyataan `INSERT` job `serial_proof` (satu per foto; `input` = `{ photoId }`; dibuat sistem). */
export function serialProofJobStmt(env: Env, photoId: string): DbStatement {
  const now = nowIso(env);
  return insertJobStmt(env.DB, {
    id: crypto.randomUUID(),
    kind: 'serial_proof',
    status: 'queued',
    progress: 0,
    result: '',
    error: '',
    createdBy: JOB_SYSTEM_ACTOR,
    createdAt: now,
    updatedAt: now,
    input: JSON.stringify({ photoId }),
    state: '',
    step: 0,
    leaseUntil: 0,
  });
}

/**
 * Job `serial_proof` (satu per foto bukti QC; rancangan 2026-11-16 §6.3), tiga langkah yang masing-masing idempoten:
 * 0 = gambar cap dari berkas sementara (snapshot DIBEKUKAN di baris foto saat Simpan) ke berkas sementara hasil;
 * 1 = unggah hasil ke folder gambar Drive (`proof-<id>.webp`, tanpa berkas ganda bila langkah diulang);
 * 2 = SATU `batch()`: sisipkan baris `files` (pemilik `serialproof`), tandai foto `done`; lalu buang berkas sementara.
 * Galat sementara (Drive) diulang oleh runner; galat permanen (gambar rusak, berkas hilang) membuat foto `failed`
 * dengan alasan ringkas, berkas asli dipertahankan agar `serialProofs.retry` dapat memprosesnya ulang.
 */

const DRIVE_MIME = 'image/webp';
const GENERIC_ERROR = 'Foto gagal diproses. Coba lagi nanti.';
const MAX_ERROR_LENGTH = 300;
/**
 * Batas percobaan MEMUAT gambar untuk cap, dihitung permanen di `serial_proof_photos.attempts` (naik saat langkah 0
 * mulai memuat gambar). Hitungan di memori runner hilang bila proses mati (mis. OOM), sehingga tanpa ini foto yang
 * membunuh proses akan diulang tanpa batas; di sini percobaan ke-4 langsung `failed` tanpa memuat gambar.
 */
export const PROOF_MAX_STAMP_ATTEMPTS = 3;

interface ProofJobState extends Record<string, unknown> {
  /** Nama berkas sementara hasil bercap (belum di Drive). */
  stamped?: string;
  width?: number;
  height?: number;
  size?: number;
  /** Ditulis SEBELUM mengunggah: bila ada saat langkah unggah dimulai, langkah ini pengulangan (cek Drive dulu). */
  uploading?: boolean;
  driveId?: string;
  /** Alasan ringkas galat terakhir (dibaca `onFail`). */
  lastError?: string;
}

function stateOf(ctx: StepContext): ProofJobState {
  return ctx.state as ProofJobState;
}

function photoIdOf(ctx: StepContext): string {
  try {
    const input: unknown = JSON.parse(ctx.job.input);
    const id = (input as { photoId?: unknown } | null)?.photoId;
    if (typeof id === 'string' && id !== '') return id;
  } catch {
    // jatuh ke galat di bawah
  }
  throw appError('INTERNAL', 'Masukan job foto bukti tidak valid');
}

function storeOf(env: Env): ProofStore {
  if (!env.PROOF_STORE) {
    throw appError('UNAVAILABLE', 'Penyimpanan sementara foto bukti belum dikonfigurasi');
  }
  return env.PROOF_STORE;
}

function parseSnapshot(text: string): ProofSnapshot {
  try {
    const value = JSON.parse(text) as Partial<ProofSnapshot> | null;
    if (
      value &&
      typeof value.serial === 'string' &&
      typeof value.actorName === 'string' &&
      typeof value.savedAt === 'string'
    ) {
      return value as ProofSnapshot;
    }
  } catch {
    // jatuh ke galat di bawah
  }
  throw appError('INTERNAL', 'Data cap foto tidak valid');
}

/** Foto masih milik job ini (`queued`/`processing`)? Selain itu job tak perlu mengerjakan apa pun. */
function inFlight(proof: ProofRow | null): proof is ProofRow {
  return proof !== null && (proof.state === 'queued' || proof.state === 'processing');
}

/** Mencatat alasan ringkas untuk `onFail` lalu melempar ulang galatnya (galat bukan AppError dijadikan pesan umum). */
function remember(ctx: StepContext, error: unknown): never {
  stateOf(ctx).lastError = (isAppError(error) ? error.message : GENERIC_ERROR).slice(
    0,
    MAX_ERROR_LENGTH,
  );
  throw error;
}

async function stampStep(ctx: StepContext): Promise<{ progress: number }> {
  const { env } = ctx;
  const state = stateOf(ctx);
  const proof = await findProof(env.DB, photoIdOf(ctx));
  if (!inFlight(proof)) return { progress: 99 };
  const store = storeOf(env);
  if (state.stamped && (await store.read(state.stamped))) return { progress: 33 };
  await env.DB.batch([
    setProofState(env.DB, proof.id, {
      state: 'processing',
      expectState: 'queued',
      now: nowIso(env),
    }),
  ]);
  // Ukuran tercatat dari header saat unggah: foto di atas batas (mis. diunggah sebelum batas diturunkan) gagal di sini,
  // sebelum berkas dibaca dan tanpa menghabiskan percobaan.
  const sizeError = proofSizeError(proof.width, proof.height);
  if (sizeError !== null) throw appError('VALIDATION', sizeError);
  // Hitung percobaan SEBELUM memuat apa pun (permanen di basis data: bertahan walau proses mati di tengah cap).
  await env.DB.prepare('UPDATE serial_proof_photos SET attempts = attempts + 1 WHERE id = ?')
    .bind(proof.id)
    .run();
  const attempted = await findProof(env.DB, proof.id);
  if ((attempted?.attempts ?? 0) > PROOF_MAX_STAMP_ATTEMPTS) {
    throw appError(
      'VALIDATION',
      'Foto berulang kali gagal diproses. Coba lagi nanti, atau buang lalu unggah ulang.',
    );
  }
  const original = proof.stagedName === '' ? null : await store.read(proof.stagedName);
  if (!original) throw appError('VALIDATION', 'Berkas sementara foto sudah tidak ada');
  const snapshot = parseSnapshot(proof.snapshotJson);
  let result: Awaited<ReturnType<typeof stampPhoto>>;
  try {
    result = await stampPhoto({ bytes: original, snapshot });
  } catch (error) {
    // Galat selain AppError (mis. zlib) berarti isi gambar tak dapat diproses: permanen, bukan gangguan sementara.
    if (isAppError(error)) throw error;
    throw appError('VALIDATION', 'Berkas bukan gambar yang dapat diproses');
  }
  const stampedName = newStagedName();
  await store.write(stampedName, result.bytes);
  state.stamped = stampedName;
  state.width = result.width;
  state.height = result.height;
  state.size = result.bytes.length;
  return { progress: 33 };
}

async function uploadStep(ctx: StepContext): Promise<{ progress: number }> {
  const { env } = ctx;
  const state = stateOf(ctx);
  const proof = await findProof(env.DB, photoIdOf(ctx));
  if (!inFlight(proof)) return { progress: 99 };
  if (state.driveId) return { progress: 66 };
  const store = storeOf(env);
  const bytes = state.stamped ? await store.read(state.stamped) : null;
  if (!bytes) throw appError('INTERNAL', 'Hasil cap foto hilang');
  const folderId =
    (await folderIdOf(env, SETTING_DRIVE_FOLDER_ID)) || (await ensureDriveFolder(env));
  const name = `proof-${proof.id}.webp`;
  const bridge = getBridge(env);
  if (state.uploading) {
    // Pengulangan sesudah unggah yang mungkin sudah sampai ke Drive: pakai berkas bernama sama, jangan ganda.
    const page = await viaBridge(() => bridge.listFolder(folderId, { name, pageSize: 10 }));
    const existing = page.files.find((entry) => entry.name === name);
    if (existing) {
      state.driveId = existing.id;
      await ctx.save();
      return { progress: 66 };
    }
  } else {
    state.uploading = true;
    await ctx.save();
  }
  const uploaded = await viaBridge(() => bridge.uploadFile(folderId, name, DRIVE_MIME, bytes));
  state.driveId = uploaded.id;
  await ctx.save();
  return { progress: 66 };
}

async function finishStep(
  ctx: StepContext,
): Promise<{ progress: number; done: { result: string } }> {
  const { env } = ctx;
  const state = stateOf(ctx);
  const proof = await findProof(env.DB, photoIdOf(ctx));
  if (!inFlight(proof)) return { progress: 100, done: { result: 'dilewati' } };
  if (!state.driveId || !state.size || !state.width || !state.height) {
    throw appError('INTERNAL', 'Hasil unggah foto tidak lengkap');
  }
  const now = nowIso(env);
  const fileId = crypto.randomUUID();
  await env.DB.batch([
    insertFileStmt(env.DB, {
      id: fileId,
      driveId: state.driveId,
      mime: DRIVE_MIME,
      size: state.size,
      width: state.width,
      height: state.height,
      ownerType: 'serialproof',
      ownerId: proof.serialId,
      createdAt: now,
      createdBy: proof.createdBy,
      status: 'active',
    }),
    setProofState(env.DB, proof.id, {
      state: 'done',
      fileId,
      mime: DRIVE_MIME,
      width: state.width,
      height: state.height,
      size: state.size,
      lastError: '',
      now,
    }),
  ]);
  // Sesudah komit: berkas sementara tak lagi dibutuhkan (gagal membuang = yatim di disk, tak mengganggu hasil).
  const store = storeOf(env);
  for (const name of [state.stamped, proof.stagedName]) {
    if (name) await store.remove(name).catch(() => undefined);
  }
  await dropCachedFile(env, state.driveId);
  return { progress: 100, done: { result: fileId } };
}

export const serialProofHandler: JobHandler = {
  async run(ctx) {
    try {
      switch (ctx.job.step) {
        case 0:
          return await stampStep(ctx);
        case 1:
          return await uploadStep(ctx);
        default:
          return await finishStep(ctx);
      }
    } catch (error) {
      return remember(ctx, error);
    }
  },
  async onFail(ctx) {
    const { env } = ctx;
    const state = stateOf(ctx);
    const message = state.lastError ?? GENERIC_ERROR;
    const proofId = (() => {
      try {
        return photoIdOf(ctx);
      } catch {
        return null;
      }
    })();
    // Berkas Drive yang sudah terunggah tapi tak jadi dipakai dibuang agar percobaan ulang tak menggandakannya.
    if (state.driveId) {
      await viaBridge(() => getBridge(env).deleteFile(state.driveId as string)).catch(
        () => undefined,
      );
    }
    if (state.stamped && env.PROOF_STORE) {
      await env.PROOF_STORE.remove(state.stamped).catch(() => undefined);
    }
    if (proofId === null) return;
    const now = nowIso(env);
    // Berkas asli (`staged_name`) dipertahankan untuk `serialProofs.retry`.
    await env.DB.batch([
      setProofState(env.DB, proofId, {
        state: 'failed',
        expectState: 'processing',
        lastError: message,
        now,
      }),
      setProofState(env.DB, proofId, {
        state: 'failed',
        expectState: 'queued',
        lastError: message,
        now,
      }),
    ]);
  },
};
