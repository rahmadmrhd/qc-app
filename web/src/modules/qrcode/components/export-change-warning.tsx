import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Peringatan sebelum menyimpan perubahan label pada konfigurasi yang sudah pernah diekspor (spek 4a butir 10):
 * akibatnya baru terjadi saat diekspor ulang. Alasan baru diminta di dialog ekspor, bukan di sini.
 */
export function ExportChangeWarning({
  open,
  stickerVersion,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** Versi stiker terbaru konfigurasi; 0 = diekspor sebelum tahap 4a (belum punya stiker Manual Book). */
  stickerVersion: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Label berubah sejak diekspor</DialogTitle>
          <DialogDescription>
            {stickerVersion === 0
              ? 'Konfigurasi ini sudah pernah diekspor sebelum fitur Manual Book berversi, jadi belum punya stiker di katalog. Ekspor berikutnya melahirkan stiker Manual Book versi 1; tidak ada stiker lama yang digantikan dan alasan tidak diminta. Menyimpan saja tidak mengubah stiker.'
              : `Konfigurasi ini sudah pernah diekspor. Bila perubahan label ini diekspor ulang, aplikasi membuat stiker Manual Book baru (v${stickerVersion + 1}) di katalog, dan stiker v${stickerVersion} menjadi usang (nonaktif otomatis bila stoknya sudah 0). Alasan perubahan diminta saat ekspor ulang. Menyimpan saja tidak mengubah stiker.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Batal
          </Button>
          <Button type="button" onClick={onConfirm}>
            Simpan perubahan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
