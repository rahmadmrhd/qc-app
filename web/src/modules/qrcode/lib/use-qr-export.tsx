import type { QrDesignDto, QrFileKind } from '@shared/contract';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { describeError } from '@/lib/api/describe-error';
import { ExportDialog } from '../components/export-dialog';
import { refreshQrDesign, useExportQrDesign } from '../queries';
import { saveFileDownload } from './download';
import { shouldRefreshAfterExportError } from './export-error';
import { prepareExportFiles } from './prepare-export';

/**
 * Ekspor dan unduh hasil ekspor satu konfigurasi QR, dipakai bersama halaman daftar dan halaman View (satu tempat
 * untuk dialog konfirmasi, penyiapan berkas di peramban, dan pemuatan ulang DTO basi setelah galat ekspor).
 * `exportDialog` dirender pemanggil di luar form/tabel; `exportAction` membukanya.
 */
export function useQrExport(): {
  /** Konfigurasi yang sedang diproses (unduh berjalan); aksi barisnya dinonaktifkan. */
  busyId: string | null;
  exportAction: (design: QrDesignDto) => void;
  download: (design: QrDesignDto, kind: QrFileKind) => Promise<void>;
  exportDialog: ReactNode;
} {
  const queryClient = useQueryClient();
  const exportMutation = useExportQrDesign();
  const [exporting, setExporting] = useState<QrDesignDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function confirmExport(
    design: QrDesignDto,
    report: (step: string) => void,
    reason: string,
  ) {
    const files = await prepareExportFiles(queryClient, design, report);
    report('Mengirim PDF dan PNG ke server…');
    try {
      await exportMutation.mutateAsync({
        id: design.id,
        expectedUpdatedAt: design.updatedAt,
        pdf: files.pdf,
        png: files.png,
        // Gambar contoh stiker dikirim selalu (server mengabaikannya bila ekspor ini tidak melahirkan versi baru).
        preview: files.preview,
        reason,
        onProgress: (job) => report(`Server memproses ekspor ke Drive (${job.progress}%)…`),
      });
    } catch (error) {
      // DTO di dialog basi (versi usang, label berubah sehingga alasan kini wajib, atau job gagal di langkah komit
      // karena konfigurasi diubah selama job): muat ulang agar dialog memakai data terbaru (kotak alasan muncul
      // bila perlu), lalu teruskan galat ke dialog.
      if (shouldRefreshAfterExportError(error)) {
        const fresh = await refreshQrDesign(queryClient, design.id).catch(() => null);
        if (fresh) setExporting(fresh);
      }
      throw error;
    }
    toast.success('Hasil ekspor disimpan di Drive');
  }

  async function download(design: QrDesignDto, kind: QrFileKind) {
    setBusyId(design.id);
    try {
      saveFileDownload(await api('qrcodes.file', { id: design.id, kind }));
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusyId(null);
    }
  }

  return {
    busyId,
    exportAction: setExporting,
    download,
    exportDialog: exporting ? (
      <ExportDialog
        design={exporting}
        open
        onOpenChange={(open) => (open ? undefined : setExporting(null))}
        onConfirm={(report, reason) => confirmExport(exporting, report, reason)}
      />
    ) : null,
  };
}
