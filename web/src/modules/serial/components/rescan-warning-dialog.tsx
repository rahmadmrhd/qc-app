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
import type { SaveConfirmGroup, SaveConfirmSummary } from '../lib/save-confirm';

export interface RescanWarningDialogProps {
  open: boolean;
  warnings: readonly RescanWarning[];
  /** Ringkasan isian (langkah konfirmasi Simpan); digabung dengan daftar cek ulang dalam satu dialog. */
  summary?: SaveConfirmSummary;
  onContinue(): void;
  onCancel(): void;
}

/** Baris ringkasan yang berisi teks biasa (Serial Number dan Stiker). */
function summaryText(summary: SaveConfirmSummary): { label: string; value: string }[] {
  const parts: string[] = [];
  if (summary.stickerKinds > 0)
    parts.push(`${summary.stickerKinds} jenis, ${summary.stickerQty} pcs`);
  if (summary.stickerPending > 0) parts.push(`${summary.stickerPending} baris bawaan`);
  return [
    {
      label: 'Serial Number',
      value: `${summary.total}${summary.newCount > 0 ? ` (${summary.newCount} baru)` : ''}`,
    },
    { label: 'Stiker', value: parts.length > 0 ? parts.join('; ') : 'Tidak ada' },
  ];
}

/** Satu kartu per kombinasi unik BU, Item, Lokasi, dan Tanggal uji, dengan detail setiap field dan jumlah serial. */
function GroupCards({ groups }: { groups: readonly SaveConfirmGroup[] }) {
  return (
    <div className="grid gap-2">
      {groups.map((group) => (
        <div
          key={`${group.bu}|${group.item}|${group.location}|${group.testDate}`}
          className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm"
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-muted-foreground">BU</dt>
            <dd>{group.bu || '-'}</dd>
            <dt className="text-muted-foreground">Item</dt>
            <dd>{group.item || '-'}</dd>
            <dt className="text-muted-foreground">Lokasi</dt>
            <dd>{group.location || '-'}</dd>
            <dt className="text-muted-foreground">Tanggal uji</dt>
            <dd>{group.testDate || '-'}</dd>
          </dl>
          <p className="pt-1 font-medium">{group.count} serial</p>
        </div>
      ))}
    </div>
  );
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
          <div className="space-y-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {summaryText(summary).map((line) => (
                <div key={line.label} className="contents">
                  <dt className="text-muted-foreground">{line.label}</dt>
                  <dd>{line.value}</dd>
                </div>
              ))}
            </dl>
            <GroupCards groups={summary.groups} />
          </div>
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
