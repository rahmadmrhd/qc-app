import type { QrDesignDto } from '@shared/rpc';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ExportDialogProps {
  design: QrDesignDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Membuat berkas lalu menyimpannya; melempar bila gagal (pesan ditampilkan di dialog). */
  onConfirm: () => Promise<void>;
}

export function ExportDialog({ design, open, onOpenChange, onConfirm }: ExportDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const again = design.exportedAt !== '';

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ekspor gagal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{again ? 'Ekspor ulang ke Drive?' : 'Simpan hasil ke Drive?'}</DialogTitle>
          <DialogDescription>
            Dua berkas dibuat untuk "{design.title}": PDF lembar 10 × 14 (300 × 420 mm, garis
            potong) dan PNG label 3 × 3 cm. Keduanya disimpan di folder Drive "QC App QR".
          </DialogDescription>
        </DialogHeader>
        {again ? (
          <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            Ekspor ulang menimpa berkas lama (diekspor {design.exportedAt} oleh {design.exportedBy}
            ). Berkas lama dipindah ke tempat sampah Drive dan tidak dapat dipakai lagi dari
            aplikasi.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button disabled={busy} onClick={() => void confirm()}>
            {busy ? 'Memproses…' : again ? 'Timpa dan simpan' : 'Simpan ke Drive'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
