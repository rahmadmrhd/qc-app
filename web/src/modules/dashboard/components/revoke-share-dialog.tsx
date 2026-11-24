import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { describeError } from '@/lib/api';
import type { useRevokeShare } from '../share-queries';

/**
 * Konfirmasi mencabut tautan publik, dipakai daftar "Tautan dibagikan" dan halaman View tautan. `target` kosong =
 * tertutup. Pencabutan tidak dapat dibatalkan; `onRevoked` dipanggil setelah server menjawab sukses.
 */
export function RevokeShareDialog({
  target,
  onClose,
  onRevoked,
  revoke,
}: {
  target: { id: string; title: string } | null;
  onClose: () => void;
  onRevoked?: () => void;
  revoke: ReturnType<typeof useRevokeShare>;
}) {
  return (
    <AlertDialog open={target !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cabut tautan "{target?.title}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Siapa pun yang memegang tautan ini tidak dapat membukanya lagi. Pencabutan tidak dapat
            dibatalkan; buat tautan baru bila perlu.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={revoke.isPending}>Batal</AlertDialogCancel>
          <AlertDialogAction
            color="destructive"
            disabled={revoke.isPending}
            onClick={(event) => {
              event.preventDefault();
              if (!target) return;
              revoke.mutate(target.id, {
                onSuccess: () => {
                  toast.success('Tautan dicabut');
                  onClose();
                  onRevoked?.();
                },
                onError: (error) => toast.error(describeError(error)),
              });
            }}
          >
            Cabut tautan
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
