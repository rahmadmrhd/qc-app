import type { PendingEntry } from '@countrylock/pending';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
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
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type UploadOutcome, type UploadSummary, uploadBlocker } from '../lib/upload';

const BRAND_LABELS: Record<PendingEntry['brand'], string> = {
  mikrotik: 'Mikrotik',
  ubiquiti: 'Ubiquiti',
  none: '-',
};

function reinjectedLabel(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'Diinject ulang'
    : `Diinject ulang ${date.toLocaleString('id-ID')}`;
}

/** Kontrol unggah dari halaman: apakah boleh, alasan bila tidak, dan hasil terakhir. */
export interface PendingUpload {
  /** Alasan unggah belum tersedia (belum masuk, aplikasi lama); `null` = tersedia. */
  unavailable: string | null;
  uploading: boolean;
  readyCount: number;
  outcomes: ReadonlyMap<string, UploadOutcome>;
  summary: UploadSummary | null;
  onUpload(): void;
}

const OUTCOME_CLASS: Record<UploadOutcome['state'], string> = {
  created: 'text-muted-foreground',
  duplicate: 'text-amber-600 dark:text-amber-400',
  invalid: 'text-destructive',
  error: 'text-destructive',
};

function SummaryLine({ summary }: { summary: UploadSummary }) {
  const parts = [
    summary.created > 0 ? `${summary.created} terunggah` : null,
    summary.duplicate > 0 ? `${summary.duplicate} duplikat` : null,
    summary.failed > 0 ? `${summary.failed} gagal` : null,
  ].filter((part): part is string => part !== null);
  return (
    <p role="status" className="text-sm">
      {parts.length > 0 ? `Hasil unggah: ${parts.join(', ')}.` : 'Tidak ada baris yang terkirim.'}
      {summary.stopped ? (
        <span className="text-destructive"> Unggah berhenti: {summary.stopped}</span>
      ) : null}
    </p>
  );
}

/**
 * Antrean perangkat yang sudah di-inject dan belum diunggah. Unggah (Fase 5) mengirim baris yang siap ke Daftar Serial
 * Number; yang berhasil hilang dari antrean, duplikat dan gagal tetap di sini dengan alasannya dan dapat dihapus manual.
 */
export function PendingList({
  entries,
  upload,
  onRemove,
}: {
  entries: readonly PendingEntry[];
  upload: PendingUpload;
  onRemove(serial: string): void;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const canUpload = upload.unavailable === null && upload.readyCount > 0 && !upload.uploading;

  return (
    <section className="space-y-3" aria-labelledby="country-lock-pending-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="country-lock-pending-title" className="font-medium">
          Perangkat tercatat ({entries.length})
        </h2>
        <Button
          type="button"
          variant="outline"
          disabled={!canUpload}
          onClick={upload.onUpload}
          aria-describedby="country-lock-upload-note"
        >
          {upload.uploading
            ? 'Mengunggah...'
            : upload.readyCount > 0
              ? `Unggah ke server (${upload.readyCount})`
              : 'Unggah ke server'}
        </Button>
      </div>
      <p id="country-lock-upload-note" className="text-xs text-muted-foreground">
        {upload.unavailable ??
          'Unggah mengirim serial ke Daftar Serial Number (sumber Country Lock) dengan stiker bawaan; yang berhasil dihapus dari antrean. Hasil inject disimpan di komputer ini sampai terunggah.'}
      </p>
      {upload.summary ? <SummaryLine summary={upload.summary} /> : null}
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada perangkat yang tercatat.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Serial</TableHead>
              <TableHead>Merk</TableHead>
              <TableHead>Tipe</TableHead>
              <TableHead>BU</TableHead>
              <TableHead>Lokasi</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead>Keterangan</TableHead>
              <TableHead>
                <span className="sr-only">Aksi</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const outcome = upload.outcomes.get(entry.serial);
              const blocker = uploadBlocker(entry);
              const reinjected = reinjectedLabel(entry.reinjectedAt);
              return (
                <TableRow key={entry.serial}>
                  <TableCell className="font-mono">{entry.serial}</TableCell>
                  <TableCell>{BRAND_LABELS[entry.brand]}</TableCell>
                  <TableCell>{entry.tipe || '-'}</TableCell>
                  <TableCell>{entry.buLabel || '-'}</TableCell>
                  <TableCell>{entry.locationLabel || '-'}</TableCell>
                  <TableCell>{entry.date}</TableCell>
                  <TableCell className="max-w-64 whitespace-normal text-xs">
                    {outcome ? (
                      <span className={OUTCOME_CLASS[outcome.state]}>{outcome.message}</span>
                    ) : blocker ? (
                      <span className="text-amber-600 dark:text-amber-400">{blocker}</span>
                    ) : null}
                    {reinjected !== '' ? (
                      <span className="block text-muted-foreground">{reinjected}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Hapus ${entry.serial} dari antrean`}
                      disabled={upload.uploading}
                      onClick={() => setRemoving(entry.serial)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus dari antrean?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing} dihapus dari antrean di komputer ini dan tidak akan diunggah. Perangkat
              dapat diinject ulang nanti.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing !== null) onRemove(removing);
                setRemoving(null);
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
