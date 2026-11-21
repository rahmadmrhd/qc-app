import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CameraShot } from './camera-dialog';

export interface ShotStripProps {
  shots: readonly CameraShot[];
  /** Tanpa ini thumbnail tidak punya tombol buang. */
  onRemove?(key: string): void;
  /** Dipanggil saat pratinjau besar dibuka/ditutup (pemanggil menahan tutup-otomatis strip selama terbuka). */
  onPreviewChange?(open: boolean): void;
  /** Konteks untuk pembaca layar. */
  label?: string;
}

/**
 * Strip thumbnail jepretan: satu baris horizontal yang menggulir ke samping. Klik gambar membuka tampilan besar (dialog
 * yang menutup dengan Esc, tanpa membuang foto); tombol buang terpisah per foto.
 */
export function ShotStrip({ shots, onRemove, onPreviewChange, label }: ShotStripProps) {
  const [preview, setPreview] = useState<{ shot: CameraShot; index: number } | null>(null);
  const previewChangeRef = useRef(onPreviewChange);
  previewChangeRef.current = onPreviewChange;
  const previewOpen = preview !== null;
  useEffect(() => {
    previewChangeRef.current?.(previewOpen);
    return () => previewChangeRef.current?.(false);
  }, [previewOpen]);
  const suffix = label ? `, ${label}` : '';
  if (shots.length === 0) return null;
  return (
    <>
      <ul
        data-testid="proof-photo-strip"
        aria-label={label ? `Foto ${label}` : undefined}
        // Padding atas/kanan memberi ruang tombol buang yang menonjol (overflow-x memotong sumbu y juga).
        className="flex flex-nowrap gap-2 overflow-x-auto overscroll-x-contain pt-2 pr-2 pb-1 touch-pan-x"
      >
        {shots.map((shot, index) => (
          <li key={shot.key} className="relative shrink-0">
            <button
              type="button"
              aria-label={`Perbesar foto ${index + 1}${suffix}`}
              className="block cursor-zoom-in rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => setPreview({ shot, index })}
            >
              <img
                src={shot.url}
                alt={`Foto ${index + 1}${suffix}`}
                className="size-14 rounded-md border object-cover"
                loading="lazy"
              />
            </button>
            {onRemove ? (
              <Button
                type="button"
                variant="soft"
                color="secondary"
                size="icon-xs"
                aria-label={`Buang foto ${index + 1}${suffix}`}
                className="absolute -top-1.5 -right-1.5 rounded-full"
                onClick={() => onRemove(shot.key)}
              >
                <X />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="pr-8">Foto {preview ? preview.index + 1 : ''}</DialogTitle>
            <DialogDescription className="sr-only">Pratinjau foto ukuran besar</DialogDescription>
          </DialogHeader>
          {preview ? (
            <div className="flex max-h-[70dvh] items-center justify-center overflow-auto rounded-md bg-muted">
              <img
                src={preview.shot.url}
                alt={`Pratinjau besar foto ${preview.index + 1}`}
                className="max-h-[70dvh] max-w-full object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
