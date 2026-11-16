import { MAX_IMAGE_BYTES } from '@shared/files';
import { Camera, X } from 'lucide-react';
import { useState } from 'react';
import { FileDialog } from '@/components/file-dialog';
import { Button } from '@/components/ui/button';
import { isMobileDevice } from '../lib/device';
import { mergeProofSelection, type ProofPhotoRef, proofSource } from '../lib/proof-source';
import { discardProofPhotos } from '../queries';

export interface ProofPhotoFieldProps {
  value: ProofPhotoRef[];
  onChange(value: ProofPhotoRef[]): void;
  /** Maksimum foto per entri. */
  max: number;
  disabled?: boolean;
  /** Konteks untuk pembaca layar bila banyak field serupa di satu halaman (mis. serial barisnya). */
  label?: string;
}

/**
 * Field foto bukti QC: tombol "Foto (n)" membuka file dialog (tab Unggah + Kamera, tanpa Pustaka), lalu kisi kecil foto
 * yang sudah diunggah (masih `draft`: boleh dibuang). Foto baru terkirim ke server saat dialog dikonfirmasi.
 */
export function ProofPhotoField({ value, onChange, max, disabled, label }: ProofPhotoFieldProps) {
  const [open, setOpen] = useState(false);
  // Dialog (antrean unggah dan kamera) baru dipasang saat pertama dibuka: tabel 200 baris tak membawa 200 dialog.
  const [mounted, setMounted] = useState(false);
  // Gambar yang gagal dimuat (draf pulih dengan foto yang sudah disapu server): keterangan menggantikan gambar.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
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
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((photo, index) => (
            <li key={photo.id} className="relative">
              {broken.has(photo.id) ? (
                <p className="flex size-14 items-center justify-center rounded-md border border-dashed p-1 text-center text-[10px] leading-tight text-muted-foreground">
                  Foto kedaluwarsa, unggah lagi
                </p>
              ) : (
                <img
                  src={photo.thumbUrl}
                  alt={`Foto bukti ${index + 1}${suffix}`}
                  className="size-14 rounded-md border object-cover"
                  loading="lazy"
                  onError={() => setBroken((current) => new Set(current).add(photo.id))}
                />
              )}
              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                aria-label={`Buang foto ${index + 1}${suffix}`}
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
      {mounted ? (
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
          hideNames
          // Perangkat sentuh: tombol membuka aplikasi kamera bawaan; desktop hanya Telusuri.
          capture={isMobileDevice() ? 'environment' : undefined}
          captureCountOffset={value.length}
          onDiscardUploaded={(items) => void discardProofPhotos(items.map((item) => item.id))}
          onSelect={(items) => {
            const { next, extras } = mergeProofSelection(value, items, max);
            if (extras.length > 0) void discardProofPhotos(extras);
            onChange(next);
          }}
        />
      ) : null}
    </div>
  );
}
