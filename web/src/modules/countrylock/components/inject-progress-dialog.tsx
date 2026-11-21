import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { InjectProgress, ProgressStage } from '../use-country-lock';

const STAGE_TITLES: Record<ProgressStage, string> = {
  connecting: 'Menghubungkan...',
  running: 'Menjalankan...',
  completed: 'Selesai.',
  failed: 'Gagal.',
  cancelled: 'Dibatalkan.',
};

interface InjectProgressDialogProps {
  progress: InjectProgress | null;
  /** Baris log yang sudah dibersihkan dan disamarkan; dirender sebagai TEKS, bukan HTML. */
  log: readonly string[];
  onCancel: () => void;
  onClose: () => void;
}

/**
 * Dialog progres inject (legacy `InjectProgressForm`): judul tahap, bar progres tak tentu, log
 * baca-saja yang menggulir otomatis, dan tombol Cancel (merah) yang berubah menjadi Close (abu)
 * saat selesai. Tidak dapat ditutup selama inject berjalan.
 */
export function InjectProgressDialog({
  progress,
  log,
  onCancel,
  onClose,
}: InjectProgressDialogProps) {
  const logRef = useRef<HTMLPreElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: menggulir ke bawah setiap baris log bertambah
  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [log.length]);

  const running = progress?.running ?? false;
  const outcome = progress?.outcome ?? null;

  return (
    <Dialog
      open={progress !== null}
      onOpenChange={(open) => {
        if (!open && !running) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-xl"
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (running) event.preventDefault();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{progress ? STAGE_TITLES[progress.stage] : ''}</DialogTitle>
          <DialogDescription>
            {progress && !running && progress.message !== ''
              ? progress.message
              : 'Jangan cabut atau matikan perangkat selama inject berjalan.'}
          </DialogDescription>
        </DialogHeader>
        <div
          role="progressbar"
          aria-label="Progres inject"
          aria-busy={running}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              'h-full w-full',
              running && 'animate-pulse bg-primary',
              outcome === 'success' && 'bg-success',
              outcome === 'failed' && 'bg-destructive',
              outcome === 'cancelled' && 'bg-muted-foreground',
            )}
          />
        </div>
        <pre
          ref={logRef}
          role="log"
          aria-label="Log inject"
          className="h-56 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap break-all"
        >
          {log.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: log hanya bertambah; baris dapat sama
            <div key={index}>{line}</div>
          ))}
        </pre>
        <DialogFooter>
          {running ? (
            <Button type="button" variant="soft" color="destructive" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Button type="button" variant="soft" color="secondary" onClick={onClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
