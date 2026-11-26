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

export interface RescanWarningDialogProps {
  open: boolean;
  warnings: readonly RescanWarning[];
  onContinue(): void;
  onCancel(): void;
}

/** Peringatan saat Simpan: serial yang discan ulang di BU dan lokasi yang sama dengan catatan terakhirnya. */
export function RescanWarningDialog({
  open,
  warnings,
  onContinue,
  onCancel,
}: RescanWarningDialogProps) {
  const shown = warnings.slice(0, RESCAN_LIST_MAX);
  const rest = warnings.length - shown.length;
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Lanjut atau tidak?</AlertDialogTitle>
          <AlertDialogDescription>
            {warnings.length} serial ini sudah dicatat di BU dan lokasi yang sama. Kalau memang mau
            dicek ulang, lanjutkan; kalau tidak sengaja, batalkan dan periksa lagi tabelnya.
          </AlertDialogDescription>
        </AlertDialogHeader>
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
        <AlertDialogFooter>
          <Button type="button" variant="outline" color="primary" onClick={onCancel}>
            Batal
          </Button>
          <Button type="button" color="primary" onClick={onContinue}>
            Lanjut menyimpan
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
