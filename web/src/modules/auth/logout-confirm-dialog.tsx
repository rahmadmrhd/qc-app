import { useRef } from 'react';
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
import { useAllOutboxCount } from '@/modules/handover/lib/use-outbox-summary';
import { useWarehouseSubmitting } from '@/modules/serialwh/lib/active-submission';

/**
 * Peringatan sebelum keluar bila masih ada perubahan (centang) yang belum terkirim: keluar membuang antrean di
 * perangkat. Selalu terbuka saat dirender; induk yang menentukan kapan dirender. Angka dibaca hidup dari antrean
 * (penguras dapat mengirim, atau centang baru masuk, selagi dialog terbuka). Menutup lewat Batal, Esc, atau klik di
 * luar = `onCancel`; hanya "Tetap keluar" = `onConfirm`.
 */
export function LogoutConfirmDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const count = useAllOutboxCount();
  const submitting = useWarehouseSubmitting();
  // Aksi Radix menutup dialog lewat `onOpenChange(false)` juga: tanpa penanda ini konfirmasi ikut dihitung batal.
  const confirmed = useRef(false);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !confirmed.current) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Keluar sekarang?</AlertDialogTitle>
          <AlertDialogDescription>
            {submitting
              ? 'Pengeluaran Keluar Gudang masih dikirim. Kalau Anda keluar sekarang, pengiriman berhenti dan draf pilihan serial dibuang; bagian yang sudah terkirim baru dibatalkan otomatis setelah 7 hari. Tunggu sampai selesai dulu, atau tetap keluar.'
              : count > 0
                ? `${count} perubahan belum terkirim akan hilang kalau Anda keluar. Tunggu sampai terkirim dulu, atau tetap keluar.`
                : 'Semua perubahan sudah terkirim. Aman untuk keluar.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction
            variant="soft"
            color="destructive"
            onClick={() => {
              confirmed.current = true;
              onConfirm();
            }}
          >
            Tetap keluar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
