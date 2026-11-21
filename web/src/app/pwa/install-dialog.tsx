import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Petunjuk pasang manual untuk iOS (tidak ada ajakan pasang bawaan di Safari iOS). */
export function InstallIosDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pasang aplikasi</DialogTitle>
          <DialogDescription>
            Tambahkan QC App ke layar utama agar terbuka seperti aplikasi biasa.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Ketuk tombol <strong>Bagikan</strong> di peramban (ikon kotak dengan panah ke atas).
          </li>
          <li>
            Pilih <strong>Tambahkan ke Layar Utama</strong>.
          </li>
          <li>
            Ketuk <strong>Tambah</strong>.
          </li>
        </ol>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" color="primary">
              Tutup
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
