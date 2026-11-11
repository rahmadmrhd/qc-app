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
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Label berubah sejak diekspor</DialogTitle>
          <DialogDescription>
            Konfigurasi ini sudah pernah diekspor. Bila perubahan label ini diekspor ulang, aplikasi
            membuat stiker Manual Book baru (versi berikutnya) di katalog, dan stiker versi lama
            menjadi usang (nonaktif otomatis bila stoknya sudah 0). Alasan perubahan diminta saat
            ekspor ulang. Menyimpan saja tidak mengubah stiker.
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
