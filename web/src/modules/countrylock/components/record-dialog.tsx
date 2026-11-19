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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100dvh-2rem)] sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Catat Serial Number</DialogTitle>
          <DialogDescription>
            Serial hasil inject sudah masuk ke tabel di bawah dan tidak dapat diubah. Tambahkan
            serial lain bila perlu, lalu Simpan untuk mengunggahnya ke Daftar Serial Number.
          </DialogDescription>
        </DialogHeader>
        {/* Semua baris tersimpan = dialog menutup sendiri; bila ada yang gagal, dialog tetap terbuka untuk diperbaiki. */}
        <RecordPage hideTitle draft={draft} onAllSaved={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
