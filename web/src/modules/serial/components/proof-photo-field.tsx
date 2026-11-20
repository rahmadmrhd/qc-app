import { MAX_IMAGE_BYTES } from '@shared/files';
import { Camera } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  type AttachmentItem,
  AttachmentView,
  FileDialog,
  FileDropZone,
  type RejectedFile,
} from '@/components/file-dialog';
import type { OwnerUploads } from '@/components/file-dialog/use-background-uploads';
import { Button } from '@/components/ui/button';
import { type ProofPhotoRef, proofSource, proofThumbUrl } from '../lib/proof-source';
import type { StampPreviewInput } from '../lib/stamp-preview';
import { discardProofPhotos } from '../queries';
import { proofCameraStamp } from './stamp-preview';

/** Bagian `OwnerUploads` yang dipakai field: tampilan dan kendali unggahan milik satu pemegang foto. */
export type ProofFieldUploads = Pick<OwnerUploads, 'entries' | 'add' | 'retry' | 'remove'>;

export interface ProofPhotoFieldProps {
  value: ProofPhotoRef[];
  onChange(value: ProofPhotoRef[]): void;
  /** Unggahan latar milik pemegang foto ini (hook `useProofUploads` dipasang di pemiliknya, bukan di field). */
  uploads: ProofFieldUploads;
  /** Maksimum foto per entri (selesai + sedang diunggah). */
  max: number;
  disabled?: boolean;
  /** Konteks untuk pembaca layar bila banyak field serupa di satu halaman (mis. serial barisnya). */
  label?: string;
  /** Data pratinjau cap di kamera foto; tanpa ini kamera tidak menampilkan pratinjau cap. */
  stamp?: StampPreviewInput | undefined;
}

interface DialogState {
  open: boolean;
  files: File[];
  rejected: RejectedFile[];
}

const CLOSED: DialogState = { open: false, files: [], rejected: [] };

/** Gambar draf yang tak bisa dimuat (mis. sudah disapu server) diganti keterangan; tombol buangnya tetap ada. */
function ProofThumb({
  photo,
  index,
  suffix,
  variant,
}: {
  photo: ProofPhotoRef;
  index: number;
  suffix: string;
  variant: 'thumb' | 'large';
}) {
  const [broken, setBroken] = useState(false);
  // Selalu diturunkan dari id: `thumbUrl` hasil bacaan draf tak dipercaya (draf dapat diubah di perangkat).
  if (broken) {
    return (
      <p className="flex size-14 items-center justify-center rounded-md border border-dashed p-1 text-center text-[10px] leading-tight text-muted-foreground">
        Foto kedaluwarsa, unggah lagi
      </p>
    );
  }
  return variant === 'thumb' ? (
    <img
      src={proofThumbUrl(photo.id)}
      alt={`Foto bukti ${index + 1}${suffix}`}
      className="size-full object-cover"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  ) : (
    <img
      src={proofThumbUrl(photo.id)}
      alt={`Pratinjau besar foto ${index + 1}`}
      className="max-h-[70dvh] max-w-full object-contain"
    />
  );
}

/** Foto bukti selesai sebagai item `AttachmentView` (juga dipakai dialog scan wajib foto dan Ubah baris). */
export function proofAttachmentItems(
  photos: readonly ProofPhotoRef[],
  suffix = '',
): AttachmentItem[] {
  return photos.map((photo, index) => ({
    id: photo.id,
    name: `foto ${index + 1}`,
    mime: photo.mime,
    size: photo.size,
    renderImage: (variant) => (
      <ProofThumb photo={photo} index={index} suffix={suffix} variant={variant} />
    ),
  }));
}

/**
 * Field foto bukti QC: tombol "Foto (n)" membuka dialog lampiran (kamera di dalam aplikasi, Telusuri), seret-lepas ke
 * field, lalu foto selesai (masih `draft`: boleh dibuang, klik untuk memperbesar) dan kartu progres unggahan latar.
 * Dialog hanya mengumpulkan berkas; unggahannya berjalan di hook milik pemegang foto (`uploads`).
 */
export function ProofPhotoField({
  value,
  onChange,
  uploads,
  max,
  disabled,
  label,
  stamp,
}: ProofPhotoFieldProps) {
  const [dialog, setDialog] = useState<DialogState>(CLOSED);
  const suffix = label ? `, ${label}` : '';
  // Unggahan yang menunggu/berjalan sudah mengisi kuota; yang gagal tidak.
  const reserved = uploads.entries.filter((entry) => entry.phase !== 'failed').length;
  const room = Math.max(0, max - value.length - reserved);
  const count = value.length + reserved;

  function remove(id: string) {
    // Upaya terbaik: kegagalan hapus tidak menahan tampilan (foto draft yang tersisa disapu penjadwal server).
    void discardProofPhotos([id]);
    onChange(value.filter((item) => item.id !== id));
  }

  const items = useMemo(() => proofAttachmentItems(value, suffix), [value, suffix]);

  function openDialog(files: File[], rejected: RejectedFile[]) {
    if (disabled || room === 0) return;
    setDialog({ open: true, files, rejected });
  }

  return (
    <>
      <FileDropZone
        accept={proofSource.mimeTypes}
        onFiles={openDialog}
        disabled={disabled || room === 0}
        className="flex flex-col gap-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || room === 0}
            aria-label={`Foto (${count})${suffix}`}
            onClick={() => openDialog([], [])}
          >
            <Camera aria-hidden />
            Foto ({count})
          </Button>
          {room === 0 ? (
            <span className="text-xs text-muted-foreground">Batas {max} foto tercapai.</span>
          ) : null}
        </div>
        <AttachmentView
          items={items}
          pending={uploads.entries}
          layout="grid"
          label={label}
          disabled={disabled}
          onRemove={remove}
          onRetry={uploads.retry}
          onCancel={uploads.remove}
        />
      </FileDropZone>
      {/* Di luar zona: event React dari portal dialog tak boleh menggelembung ke zona field (berkas ganda). */}
      {dialog.open ? (
        <FileDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(CLOSED);
          }}
          source={proofSource}
          mode="multiple"
          accept={['image']}
          maxBytes={MAX_IMAGE_BYTES}
          maxFiles={room}
          hideNames
          title="Foto bukti"
          confirmLabel="Tambahkan"
          camera={stamp ? { stamp: proofCameraStamp(stamp) } : true}
          initialFiles={dialog.files.length > 0 ? dialog.files : undefined}
          initialRejected={dialog.rejected.length > 0 ? dialog.rejected : undefined}
          onConfirm={(result) => uploads.add(result.files)}
        />
      ) : null}
    </>
  );
}
