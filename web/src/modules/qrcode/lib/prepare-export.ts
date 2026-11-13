import type { QrDesignDto } from '@shared/contract';
import type { QueryClient } from '@tanstack/react-query';
import { runBusy } from '@/app/pwa/busy';
import { fileQueryOptions } from '@/modules/files/queries';
import { renderExportFiles } from './export-files';

/**
 * Memuat logo dari Drive lalu merender PDF lembar, PNG label, dan gambar contoh. Seluruh persiapan dihitung sebagai
 * penulisan berjalan (registri sibuk PWA): muat ulang otomatis saat versi baru siap tidak boleh memotong render ini
 * (keputusan pemilik 2026-11-13, FR-P13). Pengiriman ke server dicakup `useExportQrDesign` (`isMutating`).
 */
export function prepareExportFiles(
  queryClient: QueryClient,
  design: QrDesignDto,
  report: (step: string) => void,
): Promise<Awaited<ReturnType<typeof renderExportFiles>>> {
  return runBusy(async () => {
    if (design.logoFileId !== '') report('Memuat logo dari Drive…');
    const logo =
      design.logoFileId === ''
        ? null
        : await queryClient.fetchQuery(fileQueryOptions(design.logoFileId));
    report('Membuat PDF lembar 10 × 14 dan PNG label…');
    return renderExportFiles(design, logo);
  });
}
