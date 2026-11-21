import { BusyLabel } from '@/components/spinner';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export interface LeaveProofDialogProps {
  open: boolean;
  /** Simpan sedang berjalan: tombol terkunci dan dialog tak bisa ditutup. */
  saving: boolean;
  onSave(): void;
  onLeave(): void;
  onStay(): void;
}

/**
 * Penjaga keluar halaman untuk draft yang memuat foto bukti QC: pilihan Simpan dulu / Keluar tanpa menyimpan / Tetap di
 * sini. Tombol memakai `Button` biasa (bukan `AlertDialogAction`) agar dialog tidak menutup sendiri sebelum simpan selesai.
 */
export function LeaveProofDialog({ open, saving, onSave, onLeave, onStay }: LeaveProofDialogProps) {
  return (
    <AlertDialog
      open={open}
      // Dibuka oleh penjaga keluar halaman: tak boleh menyisipkan entri riwayat (riwayat sudah di tengah navigasi).
      backToClose={false}
      onOpenChange={(next) => !next && !saving && onStay()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Simpan dulu sebelum pindah halaman?</AlertDialogTitle>
          <AlertDialogDescription>
            Draft ini punya foto bukti yang belum disimpan. Foto sementara hanya bertahan 7 hari di
            server dan draft-nya cuma ada di perangkat ini. Simpan dulu sebelum pindah halaman?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            color="primary"
            disabled={saving}
            onClick={onStay}
          >
            Tetap di sini
          </Button>
          <Button type="button" variant="ghost" color="primary" disabled={saving} onClick={onLeave}>
            Keluar tanpa menyimpan
          </Button>
          <Button type="button" disabled={saving} onClick={onSave}>
            {saving ? <BusyLabel>Menyimpan…</BusyLabel> : 'Simpan dulu'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
