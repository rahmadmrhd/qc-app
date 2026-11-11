import { writeAudit } from '@server/core/audit';
import { getBridge, viaBridge } from '@server/core/bridge-client';
import { base64ToBytes, bytesToBase64 } from '@server/core/bytes';
import type { ActorRef } from '@server/core/context';
import { DbError } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import { dropCachedFile } from '@server/core/file-cache';
import { ensureDriveFolder } from '@server/modules/files/service';
import type { JobHandler, StepContext, StepOutcome } from '@server/modules/jobs/consumer';
import { deleteBlobs, findActiveJob, readBlob } from '@server/modules/jobs/repo';
import { enqueueJob } from '@server/modules/jobs/service';
import { manualBookCommitStatements } from '@server/modules/sticker/manual-book';
import { listManualBookVersions } from '@server/modules/sticker/repo';
import type { ExportQrDesignInput, ExportQrJobDto } from '@shared/contract';
import { isPngBytes, readImageDimensions } from '@shared/files';
import { manualBookFileName, QR_LIMITS, qrContentHash } from '@shared/qrcode';
import { ensureQrFolder } from './folders';
import { listAttachedItems } from './items';
import type { QrDesignRecord } from './repo';
import { guardChanged, listQrDesigns, runGuardedBatch, updateQrDesignStmt } from './repo';
import { exportStamp, QR_STALE_MESSAGE, qrDesignContent, qrDocumentMap } from './service';

/**
 * Ekspor QR sebagai pekerjaan latar (Spek 9b). Rute hanya memeriksa, menyimpan muatan, dan mengantre; berkas dibuat
 * di Drive per langkah oleh consumer: PDF (0), PNG (1), gambar contoh (2, hanya bila versi Manual Book baru lahir),
 * pencatatan di database dengan CAS (3: konfigurasi + stiker/versi Manual Book), pembuangan berkas lama dan
 * pembersihan muatan (4). Berkas baru dibuat SEBELUM pencatatan; gagal sebelum pencatatan -> berkas baru dibuang dan
 * berkas lama utuh (perilaku sebelum migrasi).
 */

interface ExportInput {
  designId: string;
  expectedUpdatedAt: string;
}

interface ExportState {
  pdfDriveId?: string;
  pngDriveId?: string;
  /** Gambar contoh stiker versi baru: id berkas (baris `files`), id Drive, dan ukurannya. */
  previewFileId?: string;
  previewDriveId?: string;
  previewSize?: number;
  previewWidth?: number;
  previewHeight?: number;
  /** Berkas ekspor lama (dibuang setelah pencatatan sukses). */
  previous?: { pdf: string; png: string };
  committed?: boolean;
  /** Berkas yang gagal dibuang saat job gagal; dicoba lagi oleh `cleanup_qr`. */
  orphans?: string[];
}

const OVERFLOW_MESSAGE =
  'Isi label melebihi kanvas 3 × 3 cm; perbaiki ukuran atau teks lalu simpan ulang';

async function loadDesign(env: Env, id: string): Promise<QrDesignRecord> {
  const design = (await listQrDesigns(env)).find((row) => row.id === id);
  if (!design) throw appError('NOT_FOUND', 'Konfigurasi tidak ditemukan');
  return design;
}

function assertExportable(design: QrDesignRecord, expectedUpdatedAt: string): void {
  if (design.updatedAt !== expectedUpdatedAt) throw staleError(QR_STALE_MESSAGE);
  if (design.overflow) throw appError('VALIDATION', OVERFLOW_MESSAGE);
}

const PREVIEW_SIDE_MESSAGE = `Gambar contoh terlalu besar (sisi terpanjang maksimal ${QR_LIMITS.previewMaxSide} px)`;

/** Sisi terpanjang gambar contoh (dari header PNG) tidak boleh melebihi batas; ukuran byte kecil bisa menyamar. */
function previewDimensionsOk(size: { width: number; height: number }): boolean {
  return Math.max(size.width, size.height) <= QR_LIMITS.previewMaxSide;
}

function fieldError(field: string, message: string): Error {
  return appError('VALIDATION', message, { [field]: message });
}

/**
 * `qrcodes.export`: periksa, simpan muatan, antre; balas `{ jobId }` tanpa menunggu Drive. Konfigurasi tanpa item atau
 * tanpa nama ditolak. Ekspor yang menghasilkan versi Manual Book baru (belum pernah punya stiker, atau isi label
 * berbeda dari versi terbaru) mewajibkan gambar contoh (`preview`) dan, bila sudah punya stiker, alasan.
 */
export async function requestQrExport(
  env: Env,
  input: ExportQrDesignInput,
  actor: ActorRef,
): Promise<ExportQrJobDto> {
  const design = await loadDesign(env, input.id);
  assertExportable(design, input.expectedUpdatedAt);
  if (design.name === '') {
    throw fieldError('name', 'Konfigurasi belum bernama; lengkapi nama Manual Book lewat Ubah');
  }
  const items = (await listAttachedItems(env.DB)).get(design.id) ?? [];
  if (items.length === 0) {
    throw fieldError('itemIds', 'Konfigurasi belum punya item; pilih minimal satu item lewat Ubah');
  }
  const latest = (await listManualBookVersions(env, design.id))[0];
  const hash = qrContentHash(qrDesignContent(design, await qrDocumentMap(env)));
  const willCreateVersion = !latest || latest.contentHash !== hash;
  const reason = input.reason.trim();
  if (willCreateVersion) {
    if (latest && reason === '') {
      throw fieldError('reason', 'Isi alasan perubahan label (wajib untuk versi baru)');
    }
    if (input.preview.length === 0 || !isPngBytes(input.preview)) {
      throw fieldError('preview', 'Gambar contoh (PNG) wajib untuk versi Manual Book baru');
    }
    const dimensions = readImageDimensions('image/png', input.preview);
    if (!dimensions) {
      throw fieldError(
        'preview',
        'Gambar contoh (PNG) tidak dapat dibaca; buat ulang gambar contoh',
      );
    }
    if (!previewDimensionsOk(dimensions)) {
      throw fieldError('preview', PREVIEW_SIDE_MESSAGE);
    }
  }
  // Muatan job disimpan sebagai base64 (`job_blobs`); batas ukuran sudah ditegakkan di tepi (multipart).
  const blobs: Record<string, string> = {
    pdf: bytesToBase64(input.pdf),
    png: bytesToBase64(input.png),
  };
  if (willCreateVersion) {
    blobs.preview = bytesToBase64(input.preview);
    blobs.reason = reason;
  }
  // Klik ganda / ulang yang sama: pakai job yang masih berjalan (tidak menggandakan berkas).
  const active = await findActiveJob(env, 'qr_export', { path: '$.designId', value: design.id });
  if (active) {
    const running = JSON.parse(active.input) as ExportInput;
    if (running.expectedUpdatedAt === input.expectedUpdatedAt) return { jobId: active.id };
  }
  const payload: ExportInput = { designId: design.id, expectedUpdatedAt: input.expectedUpdatedAt };
  const jobId = await enqueueJob(env, 'qr_export', payload, actor.email, { blobs });
  return { jobId };
}

async function createExportFile(
  ctx: StepContext,
  kind: 'pdf' | 'png',
  design: QrDesignRecord,
  folderId: string,
): Promise<void> {
  const state = ctx.state as ExportState;
  const key = kind === 'pdf' ? 'pdfDriveId' : 'pngDriveId';
  if (state[key]) return; // langkah diulang: berkas sudah dibuat
  const data = await readBlob(ctx.env, ctx.job.id, kind);
  if (data === null) {
    throw appError('INTERNAL', 'Muatan ekspor tidak ditemukan; ulangi ekspor dari awal');
  }
  const name = `${manualBookFileName(design.name, exportStamp(ctx.job.createdAt))}.${kind}`;
  const mime = kind === 'pdf' ? 'application/pdf' : 'image/png';
  state[key] = await viaBridge(() => getBridge(ctx.env).createFile(folderId, name, mime, data));
  await ctx.save();
}

/** Gambar contoh stiker versi baru (hanya bila job membawanya): berkas Drive di folder berkas aplikasi. */
async function createPreviewFile(ctx: StepContext): Promise<void> {
  const state = ctx.state as ExportState;
  if (state.previewDriveId) return; // langkah diulang: berkas sudah dibuat
  const data = await readBlob(ctx.env, ctx.job.id, 'preview');
  if (data === null) return; // hash sama dengan versi terbaru: tanpa stiker baru
  const bytes = base64ToBytes(data);
  const dimensions = readImageDimensions('image/png', bytes);
  if (!dimensions) throw appError('INTERNAL', 'Gambar contoh tidak valid; ulangi ekspor dari awal');
  // Periksa ulang di sini: job dapat diantrekan tanpa melalui rute (muatan lama atau pengisian langsung).
  if (!previewDimensionsOk(dimensions)) throw appError('VALIDATION', PREVIEW_SIDE_MESSAGE);
  const fileId = crypto.randomUUID();
  const folderId = await ensureDriveFolder(ctx.env);
  state.previewDriveId = await viaBridge(() =>
    getBridge(ctx.env).createFile(folderId, `${fileId}.png`, 'image/png', data),
  );
  state.previewFileId = fileId;
  state.previewSize = bytes.length;
  state.previewWidth = dimensions.width;
  state.previewHeight = dimensions.height;
  await ctx.save();
}

export const qrExportHandler: JobHandler = {
  async run(ctx): Promise<StepOutcome> {
    const input = JSON.parse(ctx.job.input) as ExportInput;
    const state = ctx.state as ExportState;
    switch (ctx.job.step) {
      case 0: {
        const design = await loadDesign(ctx.env, input.designId);
        assertExportable(design, input.expectedUpdatedAt);
        await createExportFile(ctx, 'pdf', design, await ensureQrFolder(ctx.env));
        return { progress: 25 };
      }
      case 1: {
        const design = await loadDesign(ctx.env, input.designId);
        await createExportFile(ctx, 'png', design, await ensureQrFolder(ctx.env));
        return { progress: 50 };
      }
      case 2: {
        await createPreviewFile(ctx);
        return { progress: 70 };
      }
      case 3: {
        const current = await loadDesign(ctx.env, input.designId);
        if (!state.previous) {
          state.previous = { pdf: current.exportPdfDriveId, png: current.exportPngDriveId };
          await ctx.save();
        }
        const alreadyCommitted =
          current.exportPdfDriveId === state.pdfDriveId &&
          current.exportPngDriveId === state.pngDriveId;
        if (!alreadyCommitted) {
          assertExportable(current, input.expectedUpdatedAt);
          const documents = await qrDocumentMap(ctx.env);
          const content = qrDesignContent(current, documents);
          const hash = qrContentHash(content);
          const now = nowIso(ctx.env);
          const updated: QrDesignRecord = {
            ...current,
            exportedHash: hash,
            exportedAt: ctx.job.createdAt,
            exportedBy: ctx.job.createdBy,
            exportPdfDriveId: state.pdfDriveId ?? '',
            exportPngDriveId: state.pngDriveId ?? '',
          };
          const reason = (await readBlob(ctx.env, ctx.job.id, 'reason')) ?? '';
          const manualBook = await manualBookCommitStatements(ctx.env, {
            design: current,
            hash,
            content,
            reason,
            actor: ctx.job.createdBy,
            now,
            preview: state.previewFileId
              ? {
                  fileId: state.previewFileId,
                  driveId: state.previewDriveId ?? '',
                  size: state.previewSize ?? 0,
                  width: state.previewWidth ?? 0,
                  height: state.previewHeight ?? 0,
                }
              : null,
          });
          try {
            await runGuardedBatch(
              ctx.env.DB,
              [
                updateQrDesignStmt(ctx.env.DB, updated, current.updatedAt),
                guardChanged(ctx.env.DB),
                ...manualBook,
                writeAudit(ctx.env.DB, {
                  ts: now,
                  actor: ctx.job.createdBy,
                  action: 'qrcode.export',
                  target: current.title,
                  before: { exported: current.exportedAt === '' ? 'belum' : current.exportedAt },
                  after: {
                    exported: now,
                    replaced: current.exportPdfDriveId !== '',
                    version: manualBook.length > 0 ? 'baru' : 'tetap',
                  },
                }),
              ],
              () => staleError(QR_STALE_MESSAGE),
            );
          } catch (error) {
            if (error instanceof DbError && error.kind === 'duplicate') {
              // Ekspor serentak lain sudah membuat versi yang sama (UNIQUE design_id + version).
              if (error.key === 'manual_book_versions_design_version') {
                throw staleError(QR_STALE_MESSAGE);
              }
              // Dua konfigurasi dengan nama Manual Book sama menghasilkan nama stiker yang sama pada jenis ini.
              if (error.key === 'stickers_type_name_unique') {
                throw appError(
                  'CONFLICT',
                  'Nama stiker Manual Book sudah dipakai konfigurasi lain; ubah nama konfigurasi ini lalu ekspor ulang',
                );
              }
            }
            throw error;
          }
        }
        state.committed = true;
        return { progress: 90 };
      }
      default: {
        // Berkas baru sudah sah: membuang berkas lama bersifat best-effort dan tidak boleh menggagalkan ekspor.
        const bridge = getBridge(ctx.env);
        const unused: string[] = [state.previous?.pdf ?? '', state.previous?.png ?? ''];
        // Gambar contoh yang tak dipakai stiker mana pun (hash sama saat komit) dibuang pula.
        if (state.previewDriveId && state.previewFileId) {
          const attached = await ctx.env.DB.prepare('SELECT 1 AS used FROM files WHERE id = ?')
            .bind(state.previewFileId)
            .first<{ used: number }>();
          if (!attached) unused.push(state.previewDriveId);
        }
        for (const driveId of unused) {
          if (!driveId || driveId === state.pdfDriveId || driveId === state.pngDriveId) continue;
          try {
            await bridge.trashFile(driveId);
            await dropCachedFile(ctx.env, driveId);
          } catch (error) {
            console.error(`qrcode: berkas ekspor ${driveId} tidak dapat dibuang: ${String(error)}`);
          }
        }
        await deleteBlobs(ctx.env, ctx.job.id);
        return { progress: 100, done: { result: JSON.stringify({ designId: input.designId }) } };
      }
    }
  },

  async onFail(ctx): Promise<void> {
    const state = ctx.state as ExportState;
    await deleteBlobs(ctx.env, ctx.job.id);
    if (state.committed) return;
    const orphans: string[] = [];
    for (const driveId of [state.pdfDriveId, state.pngDriveId, state.previewDriveId]) {
      if (!driveId) continue;
      try {
        await getBridge(ctx.env).trashFile(driveId);
        await dropCachedFile(ctx.env, driveId);
      } catch {
        orphans.push(driveId);
      }
    }
    delete state.pdfDriveId;
    delete state.pngDriveId;
    delete state.previewDriveId;
    delete state.previewFileId;
    if (orphans.length > 0) state.orphans = orphans;
  },
};
