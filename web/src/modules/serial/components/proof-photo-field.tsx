import { Camera } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { mergeProofPhotos, type ProofPhotoRef } from '../lib/proof-source';
import type { StampPreviewInput } from '../lib/stamp-preview';
import { discardProofPhotos } from '../queries';
import { ProofPhotoDialog } from './proof-photo-dialog';
import { ProofPhotoGrid } from './proof-photo-grid';

export interface ProofPhotoFieldProps {
  value: ProofPhotoRef[];
  onChange(value: ProofPhotoRef[]): void;
  /** Maksimum foto per entri. */
  max: number;
  disabled?: boolean;
  /** Konteks untuk pembaca layar bila banyak field serupa di satu halaman (mis. serial barisnya). */
  label?: string;
  /** Data pratinjau cap di kamera foto; tanpa ini kamera tidak menampilkan pratinjau cap. */
  stamp?: StampPreviewInput | undefined;
}

/**
 * Field foto bukti QC: tombol "Foto (n)" membuka dialog Foto bukti (kamera di dalam aplikasi, Telusuri, kamera bawaan),
 * lalu kisi kecil foto yang sudah diunggah (masih `draft`: boleh dibuang, klik untuk memperbesar).
 */
export function ProofPhotoField({
  value,
  onChange,
  max,
  disabled,
  label,
  stamp,
}: ProofPhotoFieldProps) {
  const [open, setOpen] = useState(false);
  // Dialog baru dipasang saat pertama dibuka: tabel 200 baris tak membawa 200 dialog.
  const [mounted, setMounted] = useState(false);
  const suffix = label ? `, ${label}` : '';
  const room = Math.max(0, max - value.length);

  function remove(photo: ProofPhotoRef) {
    // Upaya terbaik: kegagalan hapus tidak menahan tampilan (foto draft yang tersisa disapu penjadwal server).
    void discardProofPhotos([photo.id]);
    onChange(value.filter((item) => item.id !== photo.id));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || room === 0}
          aria-label={`Foto (${value.length})${suffix}`}
          onClick={() => {
            setMounted(true);
            setOpen(true);
          }}
        >
          <Camera aria-hidden />
          Foto ({value.length})
        </Button>
        {room === 0 ? (
          <span className="text-xs text-muted-foreground">Batas {max} foto tercapai.</span>
        ) : null}
      </div>
      <ProofPhotoGrid photos={value} onRemove={remove} disabled={disabled} label={label} />
      {mounted ? (
        <ProofPhotoDialog
          open={open}
          onOpenChange={setOpen}
          existingCount={value.length}
          max={max}
          stamp={stamp}
          onAdd={(photos) => {
            const { next, extras } = mergeProofPhotos(value, photos, max);
            if (extras.length > 0) void discardProofPhotos(extras);
            onChange(next);
          }}
        />
      ) : null}
    </div>
  );
}
