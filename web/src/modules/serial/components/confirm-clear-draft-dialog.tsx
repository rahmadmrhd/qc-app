import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export interface ConfirmClearDraftDialogProps {
  open: boolean;
  /** Jumlah baris draft yang akan dibuang. */
  count: number;
  /** Jumlah foto bukti pada baris-baris itu (ikut dibuang, termasuk yang sudah diunggah). */
  photoCount: number;
  onConfirm(): void;
  onCancel(): void;
}

/** Konfirmasi "Kosongkan draft" (semua baris): menyebut jumlah baris dan foto bukti yang ikut dibuang. */
export function ConfirmClearDraftDialog({
  open,
  count,
  photoCount,
  onConfirm,
  onCancel,
}: ConfirmClearDraftDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kosongkan draft?</AlertDialogTitle>
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
            Kosongkan {count} baris
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
