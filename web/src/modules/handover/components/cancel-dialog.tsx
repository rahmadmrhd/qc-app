import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface CancelDialogProps {
  open: boolean;
  number: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/** Konfirmasi pembatalan task (aksi Hapus tidak ada; task hanya dapat dibatalkan). */
export function CancelDialog({ open, number, onOpenChange, onConfirm }: CancelDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Batalkan task?</DialogTitle>
          <DialogDescription>
            Task {number} akan ditandai Dibatalkan dan tidak dapat diubah lagi. Task tetap tampil di
            kolom Dibatalkan.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Kembali
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            Batalkan task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
