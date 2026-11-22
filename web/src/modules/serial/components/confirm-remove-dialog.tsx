import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export interface ConfirmRemoveDialogProps {
  open: boolean;
  /** Jumlah baris yang akan dihapus. */
  count: number;
  /** Jumlah foto bukti pada baris-baris itu (ikut dibuang). */
  photoCount: number;
  onConfirm(): void;
  onCancel(): void;
}

/** Konfirmasi hapus massal baris draft; menyebut foto bukti yang ikut dibuang. */
export function ConfirmRemoveDialog({
  open,
  count,
  photoCount,
  onConfirm,
  onCancel,
}: ConfirmRemoveDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus {count} baris?</AlertDialogTitle>
          <AlertDialogDescription>
            {photoCount > 0
              ? `${count} baris dibuang dari draft dan ${photoCount} foto buktinya ikut dibuang. Ini tidak bisa dibatalkan.`
              : `${count} baris dibuang dari draft. Ini tidak bisa dibatalkan.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" color="primary" onClick={onCancel}>
            Batal
          </Button>
          <Button type="button" variant="soft" color="destructive" onClick={onConfirm}>
            Hapus {count} baris
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
