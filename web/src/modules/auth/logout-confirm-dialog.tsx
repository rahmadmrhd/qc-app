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

/**
 * Peringatan sebelum keluar bila masih ada perubahan (centang) yang belum terkirim: keluar membuang antrean di
 * perangkat. Selalu terbuka saat dirender; induk yang menentukan kapan dirender. Menutup lewat Batal, Esc, atau
 * klik di luar = `onCancel`; hanya "Tetap keluar" = `onConfirm`.
 */
export function LogoutConfirmDialog({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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
            {`${count} perubahan belum terkirim akan hilang kalau Anda keluar. Tunggu sampai terkirim dulu, atau tetap keluar.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
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
