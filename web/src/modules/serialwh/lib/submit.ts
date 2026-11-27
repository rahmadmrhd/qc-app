import type {
  WarehouseSubmitHeader,
  WarehouseSubmitInput,
  WarehouseSubmitOutput,
  WarehouseSubmitRow,
} from '@shared/contract';
import { chunkCountOf, chunkRowsOf, WAREHOUSE_LIMITS } from '@shared/serial-warehouse';
import { ApiError } from '@/lib/api/api-error';
import { newUuid } from '@/lib/uuid';
import { toSubmitRows } from './draft';
import type { WarehouseDraftRow, WarehouseDraftSubmission } from './draft-store';

export type SubmitHeaderFields = Omit<WarehouseSubmitHeader, 'total' | 'chunkSize'>;

/**
 * Membekukan kiriman: `clientId` pengeluaran, header, dan ukuran potongan dibuat SEKALI di sini dan dipakai ulang pada
 * setiap potongan serta setiap percobaan lanjutan (header harus sama persis; `header_hash` server menolak yang berubah).
 */
export function freezeSubmission(
  rows: readonly WarehouseDraftRow[],
  fields: SubmitHeaderFields,
): WarehouseDraftSubmission {
  const chunkSize = WAREHOUSE_LIMITS.chunkMax;
  return {
    clientId: newUuid(),
    header: { ...fields, total: rows.length, chunkSize },
    chunkSize,
    sentChunks: 0,
  };
}

/** Baris potongan ke-`index` menurut pembagian beku (`rows.length` = `header.total`). */
export function chunkOf(
  rows: readonly WarehouseSubmitRow[],
  chunkSize: number,
  index: number,
): WarehouseSubmitRow[] {
  return rows.slice(
    index * chunkSize,
    index * chunkSize + chunkRowsOf(rows.length, chunkSize, index),
  );
}

/**
 * Kode yang PASTI berarti server menolak isi potongan (tidak ada yang tersimpan). Galat lain (INTERNAL dari 502/504
 * nginx, UNAVAILABLE, jaringan) tidak pasti: server mungkin sudah commit, jadi diperlakukan seperti putus (`paused`):
 * `clientId` dan potongan dipertahankan dan kiriman ulang idempoten.
 */
const DEFINITE_REJECTIONS = new Set(['VALIDATION', 'CONFLICT', 'NOT_FOUND', 'FORBIDDEN']);

export type SubmitResult =
  | { status: 'done'; output: WarehouseSubmitOutput; sentChunks: number }
  /** Server tak terjangkau: berhenti, kemajuan tersimpan, dapat dilanjutkan. */
  | { status: 'paused'; sentChunks: number; error: unknown }
  /** Ditolak server (validasi/konflik): potongan `chunkIndex` gagal, `serial` = SN yang disebut pesan (bila ada). */
  | {
      status: 'failed';
      sentChunks: number;
      chunkIndex: number;
      error: unknown;
      message: string;
      serial: string | null;
    };

export interface RunSubmissionOptions {
  submission: WarehouseDraftSubmission;
  rows: readonly WarehouseDraftRow[];
  /** Mengirim satu potongan ke server (mis. mutasi `serialWarehouse.submit`). */
  send: (input: WarehouseSubmitInput) => Promise<WarehouseSubmitOutput>;
  /** Dipanggil setelah tiap potongan sukses (simpan `sentChunks`/`dispatchId` ke draf). */
  onChunk?: (info: {
    chunkIndex: number;
    sentChunks: number;
    chunkCount: number;
    output: WarehouseSubmitOutput;
  }) => void;
}

/** Pesan galat yang menyebut SN: cari baris potongan yang serialnya tertulis di pesan (yang terpanjang menang). */
export function serialFromMessage(
  message: string,
  rows: readonly WarehouseSubmitRow[],
): string | null {
  let best: string | null = null;
  for (const row of rows) {
    if (message.includes(row.serial) && (best === null || row.serial.length > best.length)) {
      best = row.serial;
    }
  }
  return best;
}

/**
 * Mengirim potongan `sentChunks..chunkCount-1` berurutan, satu per waktu. Kiriman ulang potongan yang sama aman
 * (idempoten per `clientId` + nomor potongan), jadi percobaan ulang dimulai dari `sentChunks`.
 */
export async function runSubmission(options: RunSubmissionOptions): Promise<SubmitResult> {
  const { submission, send, onChunk } = options;
  const rows = toSubmitRows(options.rows);
  const chunkCount = chunkCountOf(rows.length, submission.chunkSize);
  let sent = submission.sentChunks;
  let last: WarehouseSubmitOutput | null = null;
  for (let index = sent; index < chunkCount; index++) {
    // Header beku dikirim apa adanya pada SETIAP potongan (server memakai SO milik pengeluaran untuk potongan > 0).
    const input: WarehouseSubmitInput = {
      clientId: submission.clientId,
      chunkIndex: index,
      header: submission.header,
      rows: chunkOf(rows, submission.chunkSize, index),
    };
    try {
      last = await send(input);
    } catch (error) {
      // Galat tak pasti (UNAVAILABLE, INTERNAL, jaringan non-ApiError) = putus, bisa dilanjutkan.
      if (!(error instanceof ApiError) || !DEFINITE_REJECTIONS.has(error.code)) {
        return { status: 'paused', sentChunks: sent, error };
      }
      return {
        status: 'failed',
        sentChunks: sent,
        chunkIndex: index,
        error,
        message: error.message,
        serial: serialFromMessage(error.message, input.rows),
      };
    }
    sent = index + 1;
    onChunk?.({ chunkIndex: index, sentChunks: sent, chunkCount, output: last });
  }
  if (last === null) {
    // Tidak ada potongan tersisa (semua sudah terkirim sebelumnya): kirim ulang potongan terakhir untuk menerima SN lengkap.
    const index = chunkCount - 1;
    try {
      last = await send({
        clientId: submission.clientId,
        chunkIndex: index,
        header: submission.header,
        rows: chunkOf(rows, submission.chunkSize, index),
      });
    } catch (error) {
      if (error instanceof ApiError && DEFINITE_REJECTIONS.has(error.code)) {
        return {
          status: 'failed',
          sentChunks: sent,
          chunkIndex: index,
          error,
          message: error.message,
          serial: null,
        };
      }
      return { status: 'paused', sentChunks: sent, error };
    }
  }
  return { status: 'done', output: last, sentChunks: sent };
}
