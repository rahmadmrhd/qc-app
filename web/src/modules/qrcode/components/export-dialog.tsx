import type { QrDesignDto } from '@shared/contract';
import { QR_LIMITS } from '@shared/qrcode';
import { useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatAuditTime } from '@/modules/access/lib/audit-actions';
import { designLabel } from '../lib/design-label';

export interface ExportDialogProps {
  design: QrDesignDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Membuat berkas lalu menyimpannya; melempar bila gagal (pesan ditampilkan di dialog). `reason` = alasan perubahan
   * label (kosong bila ekspor ini tidak melahirkan versi baru).
   */
  onConfirm: (report: (step: string) => void, reason: string) => Promise<void>;
}

export function ExportDialog({ design, open, onOpenChange, onConfirm }: ExportDialogProps) {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const again = design.exportedAt !== '';
  const [reason, setReason] = useState('');
  // Hanya alasan yang sedang diketik pada dialog yang terbuka yang dianggap belum disimpan.
  useUnsavedChanges(open && reason.trim() !== '');
  // Ekspor ulang dengan label berubah melahirkan versi Manual Book baru: alasan wajib (spek 4a butir 10).
  const newVersion = design.exportStatus === 'stale' && design.stickerVersion > 0;
  const reasonOk = !newVersion || reason.trim() !== '';

  async function confirm() {
    setBusy(true);
    setError(null);
    setStep('Menyiapkan ekspor…');
    try {
      await onConfirm(setStep, newVersion ? reason.trim() : '');
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
            Dua berkas dibuat untuk "{designLabel(design)}": PDF lembar 10 × 14 (300 × 420 mm, garis
            potong) dan PNG label 3 × 3 cm. Keduanya disimpan di folder Drive "QC App QR".
          </DialogDescription>
        </DialogHeader>
        {again ? (
          <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            Ekspor ulang menimpa berkas lama (diekspor {formatAuditTime(design.exportedAt)} oleh{' '}
            {design.exportedBy}
            ). Berkas lama dipindah ke tempat sampah Drive dan tidak dapat dipakai lagi dari
            aplikasi.
          </p>
        ) : null}
        {newVersion ? (
          <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <p>
              Label berubah sejak versi v{design.stickerVersion}. Ekspor ulang ini membuat stiker
              Manual Book baru (v{design.stickerVersion + 1}) di katalog; stiker v
              {design.stickerVersion} menjadi usang (langsung nonaktif bila stoknya sudah 0).
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="qr-export-reason">Alasan perubahan label</Label>
              <Textarea
                id="qr-export-reason"
                value={reason}
                maxLength={QR_LIMITS.reason}
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Wajib; tercatat pada riwayat versi (maks. {QR_LIMITS.reason} karakter).
              </p>
            </div>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {busy ? (
          <p role="status" className="text-sm">
            <BusyLabel>{step}</BusyLabel>
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button disabled={busy || !reasonOk} onClick={() => void confirm()}>
            {busy ? (
              <BusyLabel>Memproses…</BusyLabel>
            ) : again ? (
              'Timpa dan simpan'
            ) : (
              'Simpan ke Drive'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
