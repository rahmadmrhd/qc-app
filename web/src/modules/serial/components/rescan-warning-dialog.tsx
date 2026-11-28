import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { formatStamp } from '@/lib/format-stamp';
import { RESCAN_LIST_MAX, type RescanWarning } from '../lib/rescan';
import type { SaveConfirmSummary } from '../lib/save-confirm';

export interface RescanWarningDialogProps {
  open: boolean;
  warnings: readonly RescanWarning[];
  /** Ringkasan isian (langkah konfirmasi Simpan); digabung dengan daftar cek ulang dalam satu dialog. */
  summary?: SaveConfirmSummary;
  onContinue(): void;
  onCancel(): void;
}

function summaryLines(summary: SaveConfirmSummary): { label: string; value: string }[] {
  const join = (values: string[]) => (values.length > 0 ? values.join(', ') : '-');
  const date =
    summary.testDateFrom === ''
      ? '-'
      : summary.testDateFrom === summary.testDateTo
        ? summary.testDateFrom
        : `${summary.testDateFrom} s.d. ${summary.testDateTo}`;
  const parts: string[] = [];
  if (summary.stickerKinds > 0)
    parts.push(`${summary.stickerKinds} jenis, ${summary.stickerQty} pcs`);
  if (summary.stickerPending > 0) parts.push(`${summary.stickerPending} baris bawaan`);
  return [
    {
      label: 'Serial Number',
      value: `${summary.total}${summary.newCount > 0 ? ` (${summary.newCount} baru)` : ''}`,
    },
    { label: 'BU', value: join(summary.buLabels) },
    { label: 'Item', value: join(summary.itemLabels) },
    { label: 'Lokasi', value: join(summary.locationLabels) },
    { label: 'Tanggal uji', value: date },
    { label: 'Stiker', value: parts.length > 0 ? parts.join('; ') : 'Tidak ada' },
  ];
}

/** Peringatan saat Simpan: serial yang discan ulang di BU dan lokasi yang sama dengan catatan terakhirnya. */
export function RescanWarningDialog({
  open,
  warnings,
  summary,
  onContinue,
  onCancel,
}: RescanWarningDialogProps) {
  const shown = warnings.slice(0, RESCAN_LIST_MAX);
  const rest = warnings.length - shown.length;
  const hasWarnings = warnings.length > 0;
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {hasWarnings ? 'Lanjut atau tidak?' : 'Simpan catatan ini?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {hasWarnings
              ? `${warnings.length} serial ini sudah dicatat di BU dan lokasi yang sama. Kalau memang mau dicek ulang, lanjutkan; kalau tidak sengaja, batalkan dan periksa lagi tabelnya.`
              : 'Periksa ringkasan berikut sebelum disimpan.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {summary ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {summaryLines(summary).map((line) => (
              <div key={line.label} className="contents">
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {hasWarnings ? (
          <ul className="space-y-1 text-sm" aria-label="Serial yang sudah dicatat">
            {shown.map((warning) => (
              <li key={warning.clientId} className="break-words">
                <span className="font-mono">{warning.serial}</span>
                <span className="text-muted-foreground">
                  {' '}
                  oleh {warning.actorName}
                  {warning.at ? `, ${formatStamp(warning.at)}` : ''}
                </span>
              </li>
            ))}
            {rest > 0 ? <li className="text-muted-foreground">dan {rest} lainnya</li> : null}
          </ul>
        ) : null}
        <AlertDialogFooter>
          <Button type="button" variant="outline" color="primary" onClick={onCancel}>
            Batal
          </Button>
          <Button type="button" color="primary" onClick={onContinue}>
            {hasWarnings ? 'Lanjut menyimpan' : 'Simpan'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
