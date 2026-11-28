import type { WarehouseSkippedRowDto } from '@shared/contract';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { copyLines } from '../lib/clipboard';

export interface ClipboardResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  count: number;
  onOpenHistory?: () => void;
  /** true = clipboard sudah terisi otomatis; false/kosong = penulisan gagal, pengguna perlu menyalin manual. */
  copied?: boolean;
  /** Baris yang dilewati server (SN + alasan); barisnya masih ada di draf form. */
  skipped?: readonly WarehouseSkippedRowDto[];
}

/** Hasil salin: daftar SN siap disalin lagi (juga dipakai "Salin ulang" di Riwayat). */
export function ClipboardResultDialog({
  open,
  onOpenChange,
  text,
  count,
  onOpenHistory,
  copied,
  skipped = [],
}: ClipboardResultDialogProps) {
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'failed'>('idle');
  const area = useRef<HTMLTextAreaElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Daftar Serial Number</DialogTitle>
          <DialogDescription>
            {count === 0
              ? 'Tidak ada Serial Number yang tersimpan.'
              : copied === true
                ? `${count} Serial Number tersimpan dan sudah tersalin ke clipboard.`
                : `${count} Serial Number sudah tersimpan. Salin daftarnya di bawah.`}
          </DialogDescription>
        </DialogHeader>
        <textarea
          ref={area}
          readOnly
          value={text}
          rows={8}
          className="w-full rounded-md border bg-background p-2 font-mono text-sm"
          aria-label="Daftar Serial Number"
        />
        {skipped.length > 0 ? (
          <div className="space-y-1.5" data-testid="skipped-list">
            <p className="text-sm font-medium text-warning-text">Dilewati ({skipped.length})</p>
            <p className="text-xs text-muted-foreground">
              Serial ini tidak masuk catatan dan masih ada di pilihan. Perbaiki atau keluarkan, lalu
              kirim lagi (boleh ke SO yang sama).
            </p>
            <ul className="max-h-40 space-y-0.5 overflow-auto text-sm">
              {skipped.map((entry) => (
                <li key={entry.serial}>
                  <span className="font-mono">{entry.serial}</span>: {entry.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <DialogFooter>
          {onOpenHistory ? (
            <Button type="button" variant="ghost" color="primary" onClick={onOpenHistory}>
              Buka riwayat
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => {
              area.current?.select();
              void copyLines(text).then((ok) => setCopyState(ok ? 'ok' : 'failed'));
            }}
          >
            Salin lagi
          </Button>
          {copyState === 'ok' ? (
            <span role="status" className="self-center text-xs text-success-text">
              Tersalin
            </span>
          ) : null}
          {copyState === 'failed' ? (
            <span role="status" className="self-center text-xs text-destructive-text">
              Gagal menyalin: blok teks di atas lalu salin manual
            </span>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
