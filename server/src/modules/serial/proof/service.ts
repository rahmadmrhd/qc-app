import { DEFAULT_PROOF_STAGING_MAX_BYTES } from '@server/config';
import { writeAudit } from '@server/core/audit';
import { isGuardFailure } from '@server/core/cas';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import { findActiveFile } from '@server/modules/files/repo';
import { readFile } from '@server/modules/files/service';
import type {
  GetSerialProofInput,
  RemoveSerialProofInput,
  ReplaceSerialProofInput,
  RetrySerialProofInput,
  SerialProofContentDto,
  SerialProofPhotoDto,
  UploadSerialProofInput,
} from '@shared/contract';
import { type ImageMime, readImageDimensions } from '@shared/files';
import { SERIAL_PROOF_LIMITS } from '@shared/serials';
import { readableBuIds } from '../access';
import { canManageProof } from './access';
import { serialProofJobStmt } from './job';
import {
  claimReplacementStmt,
  countDraftsOf,
  deleteDraftStmt,
  deleteFailedStmt,
  deleteProofStmt,
  findProof,
  insertDraftStmt,
  type ProofRow,
  previousChangedRowGuard,
  proofFilename,
  setProofState,
  sumDraftBytesOf,
  toProofDto,
} from './repo';
import {
  type ProofSnapshot,
  proofSizeError,
  STAMP_LINE_COUNT_REUPLOAD,
  stampLineCountOf,
} from './stamp';
import { newStagedName, type ProofStore } from './store';

/**
 * Rute foto bukti QC (rancangan 2026-11-16 §6.2): unggah (`draft` + berkas sementara di disk), ambil (berkas sementara
 * bila belum selesai, Drive lewat `readFile` bila `done`), buang (draft milik sendiri, atau `failed`), dan coba lagi.
 * Foto draft hanya terbaca pengunggahnya; selain itu aturan akses = BU serial pemiliknya (`readableBuIds`). Foto yang
 * tak terlihat dijawab `NOT_FOUND` yang sama dengan foto tak ada.
 */

const NOT_FOUND_MESSAGE = 'Foto tidak ditemukan';

function storeOf(env: Env): ProofStore {
  if (!env.PROOF_STORE) {
    throw appError('UNAVAILABLE', 'Penyimpanan sementara foto bukti belum dikonfigurasi');
  }
  return env.PROOF_STORE;
}

/** BU serial pemilik foto (kosong bila tak ada barisnya). */
async function serialBuOf(env: Env, serialId: string): Promise<string> {
  if (serialId === '') return '';
  const row = await env.DB.prepare('SELECT bu_id FROM serials WHERE id = ?')
    .bind(serialId)
    .first<{ bu_id: string }>();
  return row ? row.bu_id.trim() : '';
}

/** Foto yang boleh dilihat `user`: draft = pembuatnya saja; selain itu BU serial harus terbaca. Selain itu `NOT_FOUND`. */
async function visibleProof(env: Env, id: string, user: UserContext): Promise<ProofRow> {
  const proof = await findProof(env.DB, id);
  if (!proof) throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  if (proof.state === 'draft') {
    if (proof.createdBy !== user.email) throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
    return proof;
  }
  const buId = await serialBuOf(env, proof.serialId);
  if (buId === '' || !readableBuIds(user).includes(buId)) {
    throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  }
  return proof;
}

/**
 * Unggah foto bukti: validator sudah memeriksa MIME, tanda tangan byte, ukuran, dan lebar/tinggi klaim. Di sini: dimensi
 * dibaca ulang dari header (yang dipakai = hasil baca server) dan dibatasi piksel, kuota draft per pengguna, batas total
 * berkas sementara, lalu berkas ditulis SEBELUM baris `draft` (gagal tulis baris = berkas dibuang).
 */
export async function uploadProof(
  env: Env,
  input: UploadSerialProofInput,
  actor: UserContext,
): Promise<SerialProofPhotoDto> {
  const store = storeOf(env);
  const dims = readImageDimensions(input.mime as ImageMime, input.bytes);
  if (dims === null) {
    const message = 'Dimensi gambar tidak terbaca';
    throw appError('VALIDATION', message, { bytes: message });
  }
  const sizeError = proofSizeError(dims.width, dims.height);
  if (sizeError !== null) throw appError('VALIDATION', sizeError, { bytes: sizeError });
  const limit = SERIAL_PROOF_LIMITS.draftPerUserMax;
  const quotaMessage = `Terlalu banyak foto yang belum disimpan (maks. ${limit}). Simpan entri yang sedang diisi atau buang fotonya terlebih dulu.`;
  if ((await countDraftsOf(env.DB, actor.email)) >= limit) {
    throw appError('CONFLICT', quotaMessage);
  }
  const bytesLimit = SERIAL_PROOF_LIMITS.draftBytesPerUser;
  const bytesMessage = `Kuota foto sementara kamu penuh (maks ${Math.round(bytesLimit / (1024 * 1024))} MB). Simpan atau buang foto yang belum terpakai.`;
  if ((await sumDraftBytesOf(env.DB, actor.email)) + input.bytes.length > bytesLimit) {
    throw appError('CONFLICT', bytesMessage);
  }
  const maxTotal = env.PROOF_STAGING_MAX_BYTES ?? DEFAULT_PROOF_STAGING_MAX_BYTES;
  if ((await store.totalBytes()) + input.bytes.length > maxTotal) {
    throw appError(
      'UNAVAILABLE',
      'Penyimpanan sementara foto bukti penuh. Coba lagi nanti atau hubungi admin.',
    );
  }
  const id = crypto.randomUUID();
  const stagedName = newStagedName();
  await store.write(stagedName, input.bytes);
  try {
    await insertDraftStmt(env.DB, {
      id,
      createdBy: actor.email,
      now: nowIso(env),
      mime: input.mime,
      width: dims.width,
      height: dims.height,
      size: input.bytes.length,
      stagedName,
    }).run();
    // Unggahan serentak dapat sama-sama lolos hitung awal: hitung ulang sesudah sisip dan batalkan yang melampaui kuota.
    if ((await countDraftsOf(env.DB, actor.email)) > limit) {
      await deleteProofStmt(env.DB, id).run();
      throw appError('CONFLICT', quotaMessage);
    }
    if ((await sumDraftBytesOf(env.DB, actor.email)) > bytesLimit) {
      await deleteProofStmt(env.DB, id).run();
      throw appError('CONFLICT', bytesMessage);
    }
  } catch (error) {
    await store.remove(stagedName).catch(() => undefined);
    throw error;
  }
  const row = await findProof(env.DB, id);
  if (!row) throw appError('INTERNAL', 'Foto gagal disimpan. Coba unggah lagi.');
  return toProofDto(row, true);
}

/** Isi foto: berkas sementara bila belum `done`, berkas Drive (lewat `readFile`, aturan BU serial) bila `done`. */
export async function getProof(
  env: Env,
  input: GetSerialProofInput,
  user: UserContext,
): Promise<SerialProofContentDto> {
  const proof = await visibleProof(env, input.id, user);
  if (proof.state === 'done') {
    const file = proof.fileId === '' ? null : await findActiveFile(env, proof.fileId);
    if (!file) throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
    const content = await readFile(
      env,
      { id: file.id },
      {
        email: user.email,
        itemBuIds: null,
        canReadStickerFiles: false,
        serialBuIds: readableBuIds(user),
      },
      file,
    );
    return {
      id: proof.id,
      mime: content.mime,
      bytes: content.bytes,
      filename: proofFilename(proof.id, content.mime),
    };
  }
  const bytes = proof.stagedName === '' ? null : await storeOf(env).read(proof.stagedName);
  if (!bytes) throw appError('NOT_FOUND', 'Berkas sementara foto sudah tidak ada');
  return { id: proof.id, mime: proof.mime, bytes, filename: proofFilename(proof.id, proof.mime) };
}

/** Pelaku foto (yang menyimpannya) atau pemegang `serial: manage` pada BU serialnya. */
async function canManageFailed(env: Env, proof: ProofRow, user: UserContext): Promise<boolean> {
  return canManageProof(user, proof.createdBy, await serialBuOf(env, proof.serialId));
}

const REMOVE_CONFLICT_MESSAGE = 'Foto yang sudah disimpan tidak dapat dibuang';

/**
 * Membuang foto: hanya `draft` milik sendiri, atau `failed` oleh pelaku/`serial: manage` (satu-satunya penghapusan
 * sesudah Simpan; dicatat di audit). Penghapusan BERSYARAT status pada SQL (bukan hanya pada baris yang dibaca lebih
 * dulu): foto yang di sela itu diklaim Simpan atau dicoba ulang tidak terhapus (`CONFLICT`), dan berkas sementara
 * dibuang hanya bila barisnya benar-benar terhapus.
 */
export async function removeProof(
  env: Env,
  input: RemoveSerialProofInput,
  user: UserContext,
): Promise<{ id: string }> {
  const proof = await visibleProof(env, input.id, user);
  if (proof.state === 'draft') {
    const result = await deleteDraftStmt(env.DB, proof.id, user.email).run();
    if ((result.meta?.changes ?? 0) === 0) throw appError('CONFLICT', REMOVE_CONFLICT_MESSAGE);
  } else if (proof.state === 'failed') {
    if (!(await canManageFailed(env, proof, user))) throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
    try {
      await env.DB.batch([
        deleteFailedStmt(env.DB, proof.id),
        previousChangedRowGuard(env.DB),
        writeAudit(env.DB, {
          ts: nowIso(env),
          actor: user.email,
          action: 'serial.proof_remove',
          target: `serial:${proof.serialId}`,
          before: {
            id: proof.id,
            eventId: proof.eventId,
            state: proof.state,
            error: proof.lastError,
          },
        }),
      ]);
    } catch (error) {
      if (isGuardFailure(error)) throw appError('CONFLICT', REMOVE_CONFLICT_MESSAGE);
      throw error;
    }
  } else {
    throw appError('CONFLICT', REMOVE_CONFLICT_MESSAGE);
  }
  if (proof.stagedName !== '') await storeOf(env).remove(proof.stagedName);
  return { id: proof.id };
}

/**
 * Coba lagi: hanya `failed` yang berkas sementaranya masih ada (diperiksa dengan `stat`, tanpa membaca isi); kembali
 * `queued` bersama job baru dalam satu batch yang dijaga (`ROW_COUNT`): dua "Coba lagi" serentak hanya memasang SATU
 * job, yang kalah dijawab `CONFLICT`.
 */
export async function retryProof(
  env: Env,
  input: RetrySerialProofInput,
  user: UserContext,
): Promise<SerialProofPhotoDto> {
  const proof = await visibleProof(env, input.id, user);
  if (proof.state !== 'failed') {
    throw appError('CONFLICT', 'Hanya foto yang gagal diproses yang dapat dicoba lagi');
  }
  if (!(await canManageFailed(env, proof, user))) throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  if (proofSizeError(proof.width, proof.height, stampLineCountOf(proof.snapshotJson)) !== null) {
    throw appError(
      'CONFLICT',
      'Ukuran foto melebihi batas, jadi tidak bisa diproses ulang. Buang foto ini lalu unggah yang lebih kecil.',
    );
  }
  const staged = proof.stagedName === '' ? null : await storeOf(env).stat(proof.stagedName);
  if (!staged) {
    throw appError(
      'CONFLICT',
      'Berkas sementara foto sudah tidak ada, jadi tidak bisa diproses ulang. Buang foto ini.',
    );
  }
  try {
    await env.DB.batch([
      setProofState(env.DB, proof.id, {
        state: 'queued',
        expectState: 'failed',
        now: nowIso(env),
        attempts: 0,
        lastError: '',
      }),
      previousChangedRowGuard(env.DB),
      serialProofJobStmt(env, proof.id),
    ]);
  } catch (error) {
    if (isGuardFailure(error)) {
      throw appError('CONFLICT', 'Foto ini sudah dicoba lagi atau berubah status. Muat ulang.');
    }
    throw error;
  }
  const row = await findProof(env.DB, proof.id);
  if (!row) throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  return toProofDto(row, true);
}

const REPLACE_UNKNOWN_MESSAGE = 'Foto tidak dikenal atau sudah dipakai';
const REPLACE_STALE_MESSAGE =
  'Foto ini sudah dicoba lagi, dibuang, atau berubah status. Muat ulang lalu coba lagi.';

function appErrorOn(field: string, message: string): never {
  throw appError('VALIDATION', message, { [field]: message });
}

/** Snapshot cap foto lama sebagai objek; `null` bila tak terbaca (foto tak dapat diganti tanpa data cap aslinya). */
function parseOldSnapshot(text: string): ProofSnapshot | null {
  try {
    const value = JSON.parse(text) as Partial<ProofSnapshot> | null;
    if (
      value &&
      typeof value === 'object' &&
      typeof value.serial === 'string' &&
      typeof value.actorName === 'string' &&
      typeof value.savedAt === 'string'
    ) {
      return value as ProofSnapshot;
    }
  } catch {
    // jatuh ke null di bawah
  }
  return null;
}

/**
 * Unggah ulang (ganti foto bermasalah; spek 2026-11-16-serial-bukti-foto-qc-masalah-design.md §4.2): `photoId` = foto
 * `failed` (penyebab apa pun, termasuk ukuran), `newPhotoId` = unggahan `draft` pengganti milik pemanggil. SATU `batch()`
 * berpenjaga: hapus baris foto lama (bersyarat `failed`), klaim draft baru menjadi `queued` dengan serial, kejadian, dan
 * snapshot cap foto lama ditambah penanda `reupload` (waktu + nama pengunggah ulang, untuk baris cap tambahan), pasang
 * job, dan catat audit `serial.proof_reupload`. Gagal salah satu = tak ada yang berubah. Berkas sementara foto lama dibuang
 * HANYA bila barisnya benar-benar terhapus (sesudah komit). Hak sama dengan Buang/Coba lagi (`canManage`).
 */
export async function replaceProof(
  env: Env,
  input: ReplaceSerialProofInput,
  user: UserContext,
): Promise<SerialProofPhotoDto> {
  const old = await visibleProof(env, input.photoId, user);
  if (old.state !== 'failed') {
    throw appError('CONFLICT', 'Hanya foto yang gagal diproses yang dapat diunggah ulang');
  }
  if (!(await canManageFailed(env, old, user))) throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  const invalid = (message = REPLACE_UNKNOWN_MESSAGE): never => appErrorOn('newPhotoId', message);
  const draft = input.newPhotoId === old.id ? null : await findProof(env.DB, input.newPhotoId);
  // Jawaban generik yang sama untuk draft yang tak ada, milik orang lain, atau bukan `draft` (tak membuka apa pun).
  if (!draft || draft.state !== 'draft' || draft.createdBy !== user.email) return invalid();
  // Footer foto unggah ulang satu baris lebih tinggi: ukuran pengganti dinilai dengan kanvas sebenarnya.
  const sizeError = proofSizeError(draft.width, draft.height, STAMP_LINE_COUNT_REUPLOAD);
  if (sizeError !== null) return invalid(sizeError);
  const snapshot = parseOldSnapshot(old.snapshotJson);
  if (!snapshot) {
    throw appError(
      'CONFLICT',
      'Data cap foto lama tidak terbaca, jadi tidak bisa diunggah ulang. Buang foto ini.',
    );
  }
  const now = nowIso(env);
  const snapshotJson = JSON.stringify({
    ...snapshot,
    reupload: { at: now, byName: user.name },
  } satisfies ProofSnapshot);
  try {
    await env.DB.batch([
      deleteFailedStmt(env.DB, old.id),
      previousChangedRowGuard(env.DB),
      claimReplacementStmt(env.DB, {
        id: draft.id,
        email: user.email,
        serialId: old.serialId,
        eventId: old.eventId,
        snapshotJson,
        now,
      }),
      previousChangedRowGuard(env.DB),
      serialProofJobStmt(env, draft.id),
      writeAudit(env.DB, {
        ts: now,
        actor: user.email,
        action: 'serial.proof_reupload',
        target: `serial:${old.serialId}`,
        before: { id: old.id, eventId: old.eventId, state: old.state, error: old.lastError },
        after: { id: draft.id },
      }),
    ]);
  } catch (error) {
    if (!isGuardFailure(error)) throw error;
    // Batch dibatalkan seluruhnya: bedakan foto lama yang keburu berubah dari draft pengganti yang tak lagi bisa dipakai.
    const again = await findProof(env.DB, old.id);
    if (again?.state !== 'failed') throw appError('CONFLICT', REPLACE_STALE_MESSAGE);
    return invalid();
  }
  if (old.stagedName !== '')
    await storeOf(env)
      .remove(old.stagedName)
      .catch(() => undefined);
  const row = await findProof(env.DB, draft.id);
  if (!row) throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  return toProofDto(row, true);
}
