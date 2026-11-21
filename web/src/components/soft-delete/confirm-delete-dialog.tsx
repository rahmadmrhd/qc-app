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

/**
 * Konfirmasi hapus (soft delete): "Hapus {count} {subject}?", kalimat bahwa data dapat dipulihkan, dan `usage`
 * opsional (mis. "Dipakai 12 item"). `usage` HANYA diteruskan apa adanya dari pemanggil: ia dihitung dari record hidup
 * (rancangan soft delete §5 butir 16), bukan oleh dialog ini. `permanent` = hapus permanen (mis. gambar Pustaka):
 * kalimat dapat-dipulihkan diganti peringatan tak dapat dikembalikan. Selama `busy` dialog tak dapat ditutup.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  count,
  subject,
  usage,
  permanent = false,
  onConfirm,
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  subject: string;
  usage?: string;
  permanent?: boolean;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy && !next) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Hapus {count} {subject}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {permanent
              ? 'Dihapus permanen dan tidak dapat dikembalikan.'
              : 'Data dapat dipulihkan dari tampilan Terhapus.'}
            {usage ? <span className="mt-1 block">{usage}</span> : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
          <AlertDialogAction
            color="destructive"
            variant="solid"
            disabled={busy}
            onClick={(event) => {
              // Dialog ditutup induk setelah proses selesai (bukan otomatis oleh Radix).
              event.preventDefault();
              onConfirm();
            }}
          >
            {busy ? 'Menghapus…' : 'Hapus'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
