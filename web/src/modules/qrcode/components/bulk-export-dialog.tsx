import type { QrDesignDto } from '@shared/contract';
import { QR_LIMITS } from '@shared/qrcode';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
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
import { summarizeBulkExport } from '../lib/bulk-export-plan';
import {
  BULK_EXPORT_MAX,
  type BulkExportOutcome,
  type BulkExportRow,
  type BulkQrExport,
} from '../lib/use-bulk-qr-export';

export interface BulkExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Konfigurasi terpilih (urutan tampil). Dipakai pada fase konfirmasi; fase berjalan memakai baris `exporter`. */
  designs: readonly QrDesignDto[];
  /** Pemilik putaran ekspor (dipegang halaman agar status bertahan selama dialog terbuka). */
  exporter: BulkQrExport;
  /** Dipanggil setelah putaran selesai dengan id yang berhasil (halaman membuangnya dari pilihan). */
  onExported: (doneIds: string[]) => void;
}

const WARNING_BOX = 'rounded-md border border-warning-text/35 bg-warning-text/10 p-3 text-sm';

function rowStatusText(row: BulkExportRow): { text: string; className: string } {
  switch (row.status) {
    case 'done':
      return { text: 'Selesai', className: 'text-success-text' };
    case 'failed':
      return { text: `Gagal: ${row.message}`, className: 'text-destructive-text' };
    case 'skipped':
      return { text: `Dilewati: ${row.message}`, className: 'text-muted-foreground' };
    case 'waiting':
      return { text: row.message || 'Menunggu', className: 'text-muted-foreground' };
    default:
      return { text: row.message, className: '' };
  }
}

function RowList({ rows, label }: { rows: readonly BulkExportRow[]; label: string }) {
  return (
    <ul aria-label={label} className="divide-y rounded-md border text-sm">
      {rows.map((row) => {
        const status = rowStatusText(row);
        const working =
          row.status === 'rendering' || row.status === 'sending' || row.status === 'processing';
        return (
          <li key={row.id} className="flex flex-col gap-0.5 px-3 py-2">
            <span className="font-medium break-words">{row.name}</span>
            <span className={`text-xs break-words ${status.className}`}>
              {working ? <BusyLabel>{status.text}</BusyLabel> : status.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function resultToast(outcome: BulkExportOutcome) {
  const done = outcome.doneIds.length;
  const failed = outcome.failedIds.length;
  if (failed === 0 && outcome.waitingIds.length === 0) {
    if (done > 0) toast.success(`${done} konfigurasi diekspor`);
    return;
  }
  if (done > 0) {
    toast.warning(`${done} konfigurasi diekspor, ${failed + outcome.waitingIds.length} belum`);
  } else {
    toast.error('Tidak ada konfigurasi yang berhasil diekspor');
  }
}

/**
 * Ekspor massal konfigurasi QR dalam satu dialog tiga fase (spek revisi lanjutan 2, R7): konfirmasi (ringkasan,
 * satu alasan bersama bila ada yang melahirkan versi Manual Book baru, peringatan timpa), berjalan (status per baris,
 * "Berhenti setelah yang ini"), dan selesai (ringkasan hasil). Selama berjalan dialog tak dapat ditutup.
 */
export function BulkExportDialog({
  open,
  onOpenChange,
  designs,
  exporter,
  onExported,
}: BulkExportDialogProps) {
  const [reason, setReason] = useState('');
  const { phase, rows, outcome, cancelling } = exporter;
  const summary = useMemo(() => summarizeBulkExport(designs), [designs]);
  // Hanya alasan yang sedang diketik pada fase konfirmasi yang dianggap belum disimpan.
  useUnsavedChanges(open && phase === 'idle' && reason.trim() !== '');

  const needsReason = summary.newVersions > 0;
  const overLimit = summary.exportable > BULK_EXPORT_MAX;
  const canStart = summary.exportable > 0 && !overLimit && (!needsReason || reason.trim() !== '');

  async function begin() {
    const result = await exporter.start(designs, reason);
    if (!result) return;
    onExported(result.doneIds);
    resultToast(result);
  }

  function requestClose(next: boolean) {
    if (next) return;
    if (exporter.running) return;
    if (phase === 'finished') exporter.reset();
    setReason('');
    onOpenChange(false);
  }

  const processed = rows.filter((row) => row.status === 'done' || row.status === 'failed').length;
  const total = rows.filter((row) => row.status !== 'skipped').length;
  const failedRows = rows.filter((row) => row.status === 'failed');

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent size="full-on-phone" className="sm:max-w-xl">
        {phase === 'idle' ? (
          <>
            <DialogHeader>
              <DialogTitle>Ekspor {designs.length} konfigurasi ke Drive?</DialogTitle>
              <DialogDescription>
                Tiap konfigurasi dibuatkan PDF lembar 10 × 14 dan PNG label 3 × 3 cm, lalu disimpan
                di folder Drive "QC App QR". Diproses satu per satu; biarkan tab ini tetap terbuka.
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-1 text-sm" aria-label="Ringkasan ekspor">
              <li>
                <strong>{summary.exportable}</strong> konfigurasi akan diekspor
              </li>
              {summary.newVersions > 0 ? (
                <li>
                  {summary.newVersions} melahirkan versi Manual Book baru (stiker versi lama menjadi
                  usang)
                </li>
              ) : null}
              {summary.firstTime > 0 ? <li>{summary.firstTime} diekspor pertama kali</li> : null}
              {summary.current > 0 ? (
                <li className="text-muted-foreground">
                  {summary.current} sudah terbaru (dilewati)
                </li>
              ) : null}
              {summary.skipped.length > 0 ? (
                <li className="text-muted-foreground">
                  {summary.skipped.length} dilewati karena belum lengkap
                </li>
              ) : null}
            </ul>
            {summary.skipped.length > 0 ? (
              <details className="rounded-md border text-sm">
                <summary className="cursor-pointer px-3 py-2">Lihat yang dilewati</summary>
                <ul className="divide-y border-t">
                  {summary.skipped.map((item) => (
                    <li key={item.id} className="px-3 py-2">
                      <span className="font-medium">{item.name}</span>
                      <span className="block text-xs text-muted-foreground">{item.reason}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {overLimit ? (
              <p role="alert" className="text-sm text-destructive-text">
                Terlalu banyak: paling banyak {BULK_EXPORT_MAX} konfigurasi per ekspor (kini{' '}
                {summary.exportable}). Kurangi pilihan, lalu ulangi.
              </p>
            ) : null}
            {summary.overwrites > 0 ? (
              <p className={WARNING_BOX}>
                {summary.overwrites} konfigurasi sudah pernah diekspor: berkas lama ditimpa,
                dipindah ke tempat sampah Drive, dan tidak dapat dipakai lagi dari aplikasi.
              </p>
            ) : null}
            {needsReason ? (
              <div className={`space-y-1.5 ${WARNING_BOX}`}>
                <Label htmlFor="qr-bulk-export-reason" required>
                  Alasan perubahan label
                </Label>
                <Textarea
                  id="qr-bulk-export-reason"
                  aria-required="true"
                  value={reason}
                  maxLength={QR_LIMITS.reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Wajib; satu alasan dipakai untuk semua konfigurasi yang melahirkan versi baru dan
                  tercatat pada riwayat versinya (maks. {QR_LIMITS.reason} karakter).
                </p>
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" color="primary" onClick={() => requestClose(false)}>
                Batal
              </Button>
              <Button disabled={!canStart} onClick={() => void begin()}>
                {`Ekspor ${summary.exportable} konfigurasi`}
              </Button>
            </DialogFooter>
          </>
        ) : phase === 'running' ? (
          <>
            <DialogHeader>
              <DialogTitle>Mengekspor ke Drive</DialogTitle>
              <DialogDescription>
                Jangan menutup tab ini sampai selesai. Dialog tidak dapat ditutup selama berjalan.
              </DialogDescription>
            </DialogHeader>
            <p role="status" className="text-sm font-medium">
              Mengekspor {Math.min(processed + 1, total)} dari {total}
            </p>
            <RowList rows={rows} label="Status ekspor per konfigurasi" />
            <DialogFooter>
              <Button
                variant="outline"
                color="primary"
                disabled={cancelling}
                onClick={() => exporter.cancel()}
              >
                {cancelling ? 'Berhenti setelah yang ini…' : 'Berhenti setelah yang ini'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Ekspor selesai</DialogTitle>
              <DialogDescription>Ringkasan hasil ekspor ke Drive.</DialogDescription>
            </DialogHeader>
            <ul className="space-y-1 text-sm" aria-label="Hasil ekspor">
              <li>
                <strong>{outcome?.doneIds.length ?? 0}</strong> berhasil diekspor
              </li>
              {(outcome?.failedIds.length ?? 0) > 0 ? (
                <li className="text-destructive-text">{outcome?.failedIds.length} gagal</li>
              ) : null}
              {(outcome?.skippedIds.length ?? 0) > 0 ? (
                <li className="text-muted-foreground">{outcome?.skippedIds.length} dilewati</li>
              ) : null}
              {(outcome?.waitingIds.length ?? 0) > 0 ? (
                <li>{outcome?.waitingIds.length} belum dikerjakan</li>
              ) : null}
            </ul>
            {outcome?.stopped === 'unavailable' ? (
              <p role="alert" className="text-sm text-destructive-text">
                Server tidak terjangkau, jadi ekspor dihentikan. Yang belum selesai tetap terpilih;
                ulangi setelah koneksi pulih.
              </p>
            ) : null}
            {outcome?.stopped === 'cancelled' ? (
              <p className="text-sm">
                Dihentikan atas permintaan Anda. Yang belum dikerjakan tetap terpilih.
              </p>
            ) : null}
            {failedRows.length > 0 ? (
              <RowList rows={failedRows} label="Konfigurasi yang gagal" />
            ) : null}
            <DialogFooter>
              <Button onClick={() => requestClose(false)}>Tutup</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
