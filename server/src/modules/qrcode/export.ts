import { writeAudit } from '@server/core/audit';
import { getBridge, viaBridge } from '@server/core/bridge-client';
import { bytesToBase64 } from '@server/core/bytes';
import type { ActorRef } from '@server/core/context';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import { dropCachedFile } from '@server/core/file-cache';
import type { JobHandler, StepContext, StepOutcome } from '@server/modules/jobs/consumer';
import { deleteBlobs, findActiveJob, readBlob } from '@server/modules/jobs/repo';
import { enqueueJob } from '@server/modules/jobs/service';
import { listManualBookVersions } from '@server/modules/sticker/repo';
import type { ExportQrDesignInput, ExportQrJobDto } from '@shared/contract';
import { isPngBytes } from '@shared/files';
import { manualBookFileName, qrContentHash } from '@shared/qrcode';
import { ensureQrFolder } from './folders';
import { listAttachedItems } from './items';
import type { QrDesignRecord } from './repo';
import { guardChanged, listQrDesigns, runGuardedBatch, updateQrDesignStmt } from './repo';
import { exportStamp, QR_STALE_MESSAGE, qrDesignContent, qrDocumentMap } from './service';

/**
 * Ekspor QR sebagai pekerjaan latar (Spek 9b). Rute hanya memeriksa, menyimpan muatan, dan mengantre; berkas dibuat
 * di Drive per langkah oleh consumer: PDF (0), PNG (1), pencatatan di database dengan CAS (2), pembuangan berkas lama
 * dan pembersihan muatan (3). Berkas baru dibuat SEBELUM pencatatan; gagal sebelum pencatatan -> berkas baru
 * dibuang dan berkas lama utuh (perilaku sebelum migrasi).
 */

interface ExportInput {
  designId: string;
  expectedUpdatedAt: string;
}

interface ExportState {
  pdfDriveId?: string;
  pngDriveId?: string;
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
  if (((await listAttachedItems(env.DB)).get(design.id) ?? []).length === 0) {
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

export const qrExportHandler: JobHandler = {
  async run(ctx): Promise<StepOutcome> {
    const input = JSON.parse(ctx.job.input) as ExportInput;
    const state = ctx.state as ExportState;
    switch (ctx.job.step) {
      case 0: {
        const design = await loadDesign(ctx.env, input.designId);
        assertExportable(design, input.expectedUpdatedAt);
        await createExportFile(ctx, 'pdf', design, await ensureQrFolder(ctx.env));
        return { progress: 30 };
      }
      case 1: {
        const design = await loadDesign(ctx.env, input.designId);
        await createExportFile(ctx, 'png', design, await ensureQrFolder(ctx.env));
        return { progress: 60 };
      }
      case 2: {
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
          const now = nowIso(ctx.env);
          const updated: QrDesignRecord = {
            ...current,
            exportedHash: qrContentHash(qrDesignContent(current, documents)),
            exportedAt: ctx.job.createdAt,
            exportedBy: ctx.job.createdBy,
            exportPdfDriveId: state.pdfDriveId ?? '',
            exportPngDriveId: state.pngDriveId ?? '',
          };
          await runGuardedBatch(
            ctx.env.DB,
            [
              updateQrDesignStmt(ctx.env.DB, updated, current.updatedAt),
              guardChanged(ctx.env.DB),
              writeAudit(ctx.env.DB, {
                ts: now,
                actor: ctx.job.createdBy,
                action: 'qrcode.export',
                target: current.title,
                before: { exported: current.exportedAt === '' ? 'belum' : current.exportedAt },
                after: { exported: now, replaced: current.exportPdfDriveId !== '' },
              }),
            ],
            () => staleError(QR_STALE_MESSAGE),
          );
        }
        state.committed = true;
        return { progress: 90 };
      }
      default: {
        // Berkas baru sudah sah: membuang berkas lama bersifat best-effort dan tidak boleh menggagalkan ekspor.
        const bridge = getBridge(ctx.env);
        for (const driveId of [state.previous?.pdf, state.previous?.png]) {
          if (!driveId || driveId === state.pdfDriveId || driveId === state.pngDriveId) continue;
          try {
            await bridge.trashFile(driveId);
            await dropCachedFile(ctx.env, driveId);
          } catch (error) {
            console.error(
              `qrcode: berkas ekspor lama ${driveId} tidak dapat dibuang: ${String(error)}`,
            );
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
    for (const driveId of [state.pdfDriveId, state.pngDriveId]) {
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
    if (orphans.length > 0) state.orphans = orphans;
  },
};
