import { MAX_IMAGE_BYTES } from '@shared/files';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type AttachmentItem,
  AttachmentView,
  FileDialog,
  FileDropZone,
  PreviewDialog,
} from '@/components/file-dialog';
import { useBackgroundUploads } from '@/components/file-dialog/use-background-uploads';
import { Button } from '@/components/ui/button';
import { itemFileSource } from '@/modules/files/file-source';
import { ImageThumb } from './image-thumb';

export interface ImagePickerProps {
  /** Id berkas terpilih, atau `null`. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Dipakai untuk nama aksesibel, mis. "stiker 1". */
  label: string;
  /** Dipanggil saat ada unggahan berjalan atau menunggu (true) dan saat selesai/dibuang (false); pemanggil menahan Simpan. */
  onBusyChange?: ((busy: boolean) => void) | undefined;
}

const OWNER = 'picker';

interface DialogState {
  open: boolean;
  files: File[];
  rejected: { name: string; reason: string }[];
}

const CLOSED: DialogState = { open: false, files: [], rejected: [] };

/** Satu gambar opsional (mis. contoh stiker): dialog lampiran (Telusuri, seret-lepas, Kamera) lalu diunggah di latar. */
export function ImagePicker({ value, onChange, label, onBusyChange }: ImagePickerProps) {
  const [dialog, setDialog] = useState<DialogState>(CLOSED);
  const [preview, setPreview] = useState<AttachmentItem | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Unggahan latar milik field ini; dibatalkan otomatis saat field dilepas. Hasil sukses langsung menjadi nilainya.
  const uploads = useBackgroundUploads({
    source: itemFileSource,
    onUploaded: (_owner, item) => {
      onChangeRef.current(item.id);
      return true;
    },
  });
  const own = uploads.forOwner(OWNER);
  const busy = own.blocking;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  useEffect(() => {
    onBusyChangeRef.current?.(busy);
    return () => onBusyChangeRef.current?.(false);
  }, [busy]);

  const name = `Contoh ${label}`;
  const current = useMemo<AttachmentItem | null>(
    () =>
      value
        ? {
            id: value,
            name,
            mime: 'image/*',
            renderImage: (variant) => (
              <ImageThumb
                id={value}
                alt={name}
                className={variant === 'thumb' ? 'size-full' : 'max-h-[70dvh] max-w-full'}
              />
            ),
          }
        : null,
    [value, name],
  );

  function openDialog(files: File[], rejected: { name: string; reason: string }[]) {
    if (busy) return;
    if (files.length > 0 || rejected.length > 0) setDialog({ open: true, files, rejected });
  }

  return (
    <>
      <FileDropZone
        accept={itemFileSource.mimeTypes}
        onFiles={openDialog}
        disabled={busy}
        className="flex flex-wrap items-center gap-2"
      >
        {current ? (
          <button
            type="button"
            aria-label={`Perbesar ${name}`}
            className="block size-12 shrink-0 cursor-zoom-in overflow-hidden rounded-md border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => setPreview(current)}
          >
            {current.renderImage?.('thumb')}
          </button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          color="primary"
          disabled={busy}
          onClick={() => setDialog({ open: true, files: [], rejected: [] })}
        >
          <ImagePlus aria-hidden="true" />
          {busy ? 'Mengunggah…' : value ? 'Ganti gambar' : 'Pilih gambar'}
        </Button>
        {value ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            color="primary"
            aria-label={`Hapus gambar contoh ${label}`}
            disabled={busy}
            onClick={() => onChange(null)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null}
        <AttachmentView
          items={[]}
          pending={own.entries}
          layout="grid"
          label={`gambar contoh ${label}`}
          onRetry={own.retry}
          onCancel={own.remove}
        />
      </FileDropZone>
      {dialog.open ? (
        <FileDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(CLOSED);
          }}
          source={itemFileSource}
          mode="single"
          accept={['image']}
          maxBytes={MAX_IMAGE_BYTES}
          initialFiles={dialog.files.length > 0 ? dialog.files : undefined}
          initialRejected={dialog.rejected.length > 0 ? dialog.rejected : undefined}
          title="Pilih gambar contoh"
          hideNames
          onConfirm={(result) => {
            // Percobaan baru menggantikan entri gagal sebelumnya.
            uploads.cancelOwner(OWNER);
            own.add(result.files);
          }}
        />
      ) : null}
      <PreviewDialog item={preview} onClose={() => setPreview(null)} />
    </>
  );
}
