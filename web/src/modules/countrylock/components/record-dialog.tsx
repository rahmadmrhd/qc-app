import { useCallback, useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RecordPage } from '@/modules/serial/components/record-page';
import type { DraftControl } from '@/modules/serial/lib/draft';

/**
 * Form Catat Serial Number dalam dialog (keputusan pemilik 2026-11-19): komponen yang sama dengan halaman web, tetapi tabel
 * miliknya adalah draft desktop (`draft`), jadi menutup dialog tidak membuang apa pun. Halaman Country Lock hanya
 * menampilkan ringkasan draft yang belum diunggah.
 *
 * Menutup dialog melepas `RecordPage` dan MEMBATALKAN unggahan foto bukti yang sedang berjalan (keputusan pemilik
 * 2026-11-20): selagi ada unggahan berjalan atau gagal, tutup lewat X, Esc, atau klik di luar meminta konfirmasi dulu.
 */
export function RecordDialog({
  open,
  onOpenChange,
  draft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: DraftControl;
}) {
  const [uploadsPending, setUploadsPending] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  // Dialog tertutup = halaman dilepas: tak ada lagi unggahan yang tersisa.
  useEffect(() => {
    if (open) return;
    setUploadsPending(false);
    setConfirmClose(false);
  }, [open]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && uploadsPending) {
        setConfirmClose(true);
        return;
      }
      onOpenChange(next);
    },
    [uploadsPending, onOpenChange],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="h-[calc(100dvh-2rem)] sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Catat Serial Number</DialogTitle>
            <DialogDescription>
              Serial hasil inject sudah masuk ke tabel di bawah dan tidak dapat diubah. Tambahkan
              serial lain bila perlu, lalu Simpan untuk mengunggahnya ke Daftar Serial Number.
            </DialogDescription>
          </DialogHeader>
          {/* Semua baris tersimpan = dialog menutup sendiri (tak ada unggahan tersisa, jadi tanpa konfirmasi); bila ada yang gagal, dialog tetap terbuka untuk diperbaiki. */}
          <RecordPage
            hideTitle
            draft={draft}
            onAllSaved={() => onOpenChange(false)}
            onUploadsPendingChange={setUploadsPending}
          />
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Tutup dan buang foto?</AlertDialogTitle>
            <AlertDialogDescription>
              Masih ada foto bukti yang diunggah atau gagal diunggah. Kalau ditutup sekarang,
              unggahan itu dibatalkan dan fotonya dibuang. Baris di tabel tetap ada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Tetap di sini</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmClose(false);
                onOpenChange(false);
              }}
            >
              Tutup dan buang foto
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
