import { memo } from 'react';
import type { UploadPhase } from './use-background-uploads';

export interface UploadProgressProps {
  phase: UploadPhase;
  /** 0..1; null = tanpa persen (bar tak-tentu, mis. desktop yang memakai fetch). */
  fraction: number | null;
}

function labelOf(phase: UploadPhase, percent: number | null): string {
  if (phase === 'waiting') return 'Menunggu';
  if (phase === 'preparing') return 'Menyiapkan';
  if (phase === 'processing') return 'Memproses';
  if (phase === 'failed') return 'Gagal';
  return percent === null ? 'Mengunggah' : `${percent}%`;
}

/**
 * Indikator satu unggahan: "Menyiapkan" (pengecilan, tanpa persen), persen unggah, lalu "Memproses" (byte sudah
 * terkirim, menunggu server). `role="progressbar"` memuat `aria-valuenow` hanya bila persennya diketahui.
 */
export const UploadProgress = memo(function UploadProgress({
  phase,
  fraction,
}: UploadProgressProps) {
  const percent = fraction === null ? null : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  const determinate = percent !== null && (phase === 'uploading' || phase === 'processing');
  const text = labelOf(phase, determinate ? percent : null);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        role="progressbar"
        aria-label={text}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? percent : undefined}
        aria-valuetext={text}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        {determinate ? (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-150"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="h-full w-full animate-pulse rounded-full bg-primary/50 motion-reduce:animate-none" />
        )}
      </div>
      <span className="text-xs text-muted-foreground">{text}</span>
    </div>
  );
});
