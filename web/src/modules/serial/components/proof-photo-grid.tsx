import { LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ProofPhotoRef } from '../lib/proof-source';

export interface ProofPhotoGridProps {
  photos: ProofPhotoRef[];
  /** Tanpa ini foto tidak punya tombol buang. */
  onRemove?(photo: ProofPhotoRef): void;
  disabled?: boolean;
  /** Konteks untuk pembaca layar bila banyak kisi serupa di satu halaman (mis. serial barisnya). */
  label?: string;
  /**
   * `grid` (bawaan) = kisi yang membungkus; `strip` = satu baris horizontal yang menggulir ke samping (kamera foto
   * layar penuh), thumbnail tak menyusut.
   */
  variant?: 'grid' | 'strip';
  /** Hanya `strip`: jumlah foto yang sedang diunggah; tiap satu tampil sebagai sel kecil berputar di ujung baris. */
  uploading?: number;
  /** Dipanggil saat tampilan besar dibuka/ditutup (pemanggil boleh menahan pembersihan otomatis selama terbuka). */
  onPreviewChange?(open: boolean): void;
}

/**
 * Kisi foto bukti kecil. Klik gambar membuka tampilan besar (dialog yang menutup dengan Esc, tanpa membuang foto);
 * tombol buang terpisah per foto. Gambar yang gagal dimuat (draf pulih dengan foto yang sudah disapu server) diganti
 * keterangan dan tombol buangnya tetap ada.
 */
export function ProofPhotoGrid({
  photos,
  onRemove,
  disabled,
  label,
  variant = 'grid',
  uploading = 0,
  onPreviewChange,
}: ProofPhotoGridProps) {
  const [preview, setPreview] = useState<{ photo: ProofPhotoRef; index: number } | null>(null);
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const previewChangeRef = useRef(onPreviewChange);
  previewChangeRef.current = onPreviewChange;
  const previewOpen = preview !== null;
  useEffect(() => {
    previewChangeRef.current?.(previewOpen);
    return () => previewChangeRef.current?.(false);
  }, [previewOpen]);
  const suffix = label ? `, ${label}` : '';
  const strip = variant === 'strip';
  const pendingCount = strip ? uploading : 0;
  if (photos.length === 0 && pendingCount === 0) return null;
  return (
    <>
      <ul
        data-testid={strip ? 'proof-photo-strip' : undefined}
        aria-label={strip && label ? `Foto ${label}` : undefined}
        // Strip: padding atas/kanan memberi ruang tombol buang yang menonjol (overflow-x memotong sumbu y juga).
        className={
          strip
            ? 'flex flex-nowrap gap-2 overflow-x-auto overscroll-x-contain pt-2 pr-2 pb-1 touch-pan-x'
            : 'flex flex-wrap gap-2'
        }
      >
        {photos.map((photo, index) => (
          <li key={photo.id} className="relative shrink-0">
            {broken.has(photo.id) ? (
              <p className="flex size-14 items-center justify-center rounded-md border border-dashed p-1 text-center text-[10px] leading-tight text-muted-foreground">
                Foto kedaluwarsa, unggah lagi
              </p>
            ) : (
              <button
                type="button"
                aria-label={`Perbesar foto ${index + 1}${suffix}`}
                className="block cursor-zoom-in rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => setPreview({ photo, index })}
              >
                <img
                  src={photo.thumbUrl}
                  alt={`Foto bukti ${index + 1}${suffix}`}
                  className="size-14 rounded-md border object-cover"
                  loading="lazy"
                  onError={() => setBroken((current) => new Set(current).add(photo.id))}
                />
              </button>
            )}
            {onRemove ? (
              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                aria-label={`Buang foto ${index + 1}${suffix}`}
                disabled={disabled}
                className="absolute -top-1.5 -right-1.5 rounded-full"
                onClick={() => onRemove(photo)}
              >
                <X />
              </Button>
            ) : null}
          </li>
        ))}
        {Array.from({ length: pendingCount }, (_, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: sel sementara tanpa identitas; urutan = antrean
            key={`uploading-${index}`}
            data-testid="proof-photo-uploading"
            className="flex size-14 shrink-0 items-center justify-center rounded-md border border-white/40 bg-black/50 text-white"
          >
            <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
            <span className="sr-only">Mengunggah foto</span>
          </li>
        ))}
      </ul>
      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="pr-8">
              Foto bukti {preview ? preview.index + 1 : ''}
            </DialogTitle>
            <DialogDescription className="sr-only">Pratinjau foto ukuran besar</DialogDescription>
          </DialogHeader>
          {preview ? (
            <div className="flex max-h-[70dvh] items-center justify-center overflow-auto rounded-md bg-muted">
              <img
                src={preview.photo.thumbUrl}
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
