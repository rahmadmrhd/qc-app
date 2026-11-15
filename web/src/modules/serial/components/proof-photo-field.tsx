import { MAX_IMAGE_BYTES } from '@shared/files';
import { Camera, X } from 'lucide-react';
import { useState } from 'react';
import { FileDialog } from '@/components/file-dialog';
import { Button } from '@/components/ui/button';
import { type ProofPhotoRef, proofSource, toProofRef } from '../lib/proof-source';
import { discardProofPhotos } from '../queries';
import { ProofCameraTab } from './proof-camera-tab';

export interface ProofPhotoFieldProps {
  value: ProofPhotoRef[];
  onChange(value: ProofPhotoRef[]): void;
  /** Maksimum foto per entri. */
  max: number;
  disabled?: boolean;
}

/**
 * Field foto bukti QC: tombol "Foto (n)" membuka file dialog (tab Unggah + Kamera, tanpa Pustaka), lalu kisi kecil foto
 * yang sudah diunggah (masih `draft`: boleh dibuang). Foto baru terkirim ke server saat dialog dikonfirmasi.
 */
export function ProofPhotoField({ value, onChange, max, disabled }: ProofPhotoFieldProps) {
  const [open, setOpen] = useState(false);
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
          onClick={() => setOpen(true)}
        >
          <Camera aria-hidden />
          Foto ({value.length})
        </Button>
        {room === 0 ? (
          <span className="text-xs text-muted-foreground">Batas {max} foto tercapai.</span>
        ) : null}
      </div>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((photo, index) => (
            <li key={photo.id} className="relative">
              <img
                src={photo.thumbUrl}
                alt={`Foto bukti ${index + 1}`}
                className="size-14 rounded-md border object-cover"
                loading="lazy"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                aria-label={`Buang foto ${index + 1}`}
                disabled={disabled}
                className="absolute -top-1.5 -right-1.5 rounded-full"
                onClick={() => remove(photo)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <FileDialog
        open={open}
        onOpenChange={setOpen}
        source={proofSource}
        mode="multiple"
        accept={['image']}
        maxBytes={MAX_IMAGE_BYTES}
        maxFiles={Math.max(1, room)}
        showLibrary={false}
        title="Foto bukti QC"
        confirmLabel="Tambahkan"
        cameraTab={(api) => <ProofCameraTab {...api} />}
        onSelect={(items) => onChange([...value, ...items.map(toProofRef)].slice(0, max))}
      />
    </div>
  );
}
