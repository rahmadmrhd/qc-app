import type { QrDesignDto } from '@shared/contract';

/** Alasan sebuah konfigurasi dilewati pada ekspor massal (spek revisi lanjutan 2, R7). */
export type BulkSkipCause = 'current' | 'incomplete';

export interface BulkExportPlan {
  /**
   * - `export-new`: ekspor pertama, atau diekspor sebelum 4a (lahir v1, tanpa alasan);
   * - `export-new-version`: label berubah sejak versi terakhir, melahirkan versi Manual Book baru (butuh alasan);
   * - `skip`: dilewati ("Sudah terbaru" bila hash sama, atau tak lengkap).
   */
  kind: 'export-new' | 'export-new-version' | 'skip';
  /** Hanya pada `skip`: teks untuk ringkasan. */
  skipReason?: string;
  skipCause?: BulkSkipCause;
  /** Ekspor ini menimpa berkas Drive lama (konfigurasi pernah diekspor). Selalu false pada `skip`. */
  overwrites: boolean;
  /**
   * Hanya bila true: konfigurasi diekspor sebelum 4a (terbaru menurut hash tetapi belum punya stiker Manual Book),
   * diekspor ulang demi stiker pertamanya; berkas Drive lama ditimpa dengan isi identik (keputusan pemilik 2026-11-22).
   */
  backfill?: true;
}

/** Jumlah item hidup (termasuk yang tak terlihat bagi pembaca): item terhapus tidak dihitung. */
function liveItemCount(design: QrDesignDto): number {
  return design.items.filter((item) => !item.deleted).length + design.hiddenItemCount;
}

/**
 * Menentukan nasib satu konfigurasi pada ekspor massal. Mencerminkan pagar `requestQrExport` (server): terhapus,
 * isi tak muat, nama kosong, dan tanpa item tidak dapat diekspor (dilewati dan dilaporkan, bukan menggagalkan seluruh
 * putaran). Konfigurasi yang hash-nya sama dengan ekspor terakhir dan sudah punya stiker Manual Book ("Sudah
 * terbaru") dilewati agar berkas Drive tak ditimpa tanpa perubahan; yang hash-nya sama tetapi diekspor sebelum 4a
 * (belum punya stiker, `stickerVersion` 0) diekspor ulang sebagai versi pertama (`backfill`). Hak (`qrcode: edit`) ditegakkan server.
 */
export function classifyForExport(design: QrDesignDto): BulkExportPlan {
  const skip = (skipCause: BulkSkipCause, skipReason: string): BulkExportPlan => ({
    kind: 'skip',
    skipCause,
    skipReason,
    overwrites: false,
  });
  if (design.deleted) return skip('incomplete', 'Konfigurasi sudah dihapus');
  if (design.overflow) return skip('incomplete', 'Isi label tidak muat di kanvas 3 × 3 cm');
  if (design.name.trim() === '') return skip('incomplete', 'Belum bernama');
  if (liveItemCount(design) === 0) return skip('incomplete', 'Belum punya item');
  if (design.exportStatus === 'current') {
    if (design.stickerVersion > 0) return skip('current', 'Sudah terbaru');
    // Diekspor sebelum 4a: belum punya stiker Manual Book. Diekspor ulang sebagai versi pertama (tanpa alasan).
    return { kind: 'export-new', overwrites: true, backfill: true };
  }
  const overwrites = design.exportedAt !== '';
  // Sama dengan `ExportDialog`: versi baru bila sudah punya stiker Manual Book dan labelnya berubah.
  const newVersion = design.stickerVersion > 0;
  return { kind: newVersion ? 'export-new-version' : 'export-new', overwrites };
}

export interface BulkExportSummary {
  /** Jumlah yang akan diekspor (bukan dilewati). */
  exportable: number;
  /** Di antaranya yang melahirkan versi Manual Book baru. */
  newVersions: number;
  /** Di antaranya ekspor pertama (tanpa stiker versi lama), tidak termasuk `backfill`. */
  firstTime: number;
  /** Di antaranya diekspor ulang demi stiker Manual Book pertamanya (berkas Drive ditimpa dengan isi sama). */
  backfill: number;
  /** Di antaranya menimpa berkas Drive lama (termasuk `backfill`). */
  overwrites: number;
  /** Dilewati karena sudah terbaru. */
  current: number;
  /** Dilewati karena tak lengkap, dengan alasannya. */
  skipped: { id: string; name: string; reason: string }[];
}

const nameOf = (design: QrDesignDto) => (design.name !== '' ? design.name : design.title);

/** Ringkasan konfirmasi untuk kumpulan konfigurasi terpilih. */
export function summarizeBulkExport(designs: readonly QrDesignDto[]): BulkExportSummary {
  const summary: BulkExportSummary = {
    exportable: 0,
    newVersions: 0,
    firstTime: 0,
    backfill: 0,
    overwrites: 0,
    current: 0,
    skipped: [],
  };
  for (const design of designs) {
    const plan = classifyForExport(design);
    if (plan.kind === 'skip') {
      if (plan.skipCause === 'current') summary.current += 1;
      else
        summary.skipped.push({
          id: design.id,
          name: nameOf(design),
          reason: plan.skipReason ?? '',
        });
      continue;
    }
    summary.exportable += 1;
    if (plan.kind === 'export-new-version') summary.newVersions += 1;
    else if (plan.backfill) summary.backfill += 1;
    else summary.firstTime += 1;
    if (plan.overwrites) summary.overwrites += 1;
  }
  return summary;
}
