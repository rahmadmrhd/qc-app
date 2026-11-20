import { MAX_IMAGE_BYTES } from '@shared/files';
import { ITEM_LIMITS } from '@shared/items';
import { ChevronLeft, ChevronRight, ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

export interface ImageGalleryFieldProps {
  value: readonly string[];
  onChange: (ids: string[]) => void;
  max?: number;
  /** Nama item (merk + tipe) untuk teks alternatif gambar. */
  itemLabel?: string;
  /** Dipanggil saat ada unggahan berjalan atau menunggu (true) dan saat selesai/dibuang (false); pemanggil menahan Simpan. */
  onBusyChange?: ((busy: boolean) => void) | undefined;
}

const OWNER = 'gallery';

interface DialogState {
  open: boolean;
  files: File[];
  rejected: { name: string; reason: string }[];
}

const CLOSED: DialogState = { open: false, files: [], rejected: [] };

/**
 * Galeri gambar lampiran: tambah lewat dialog lampiran (Telusuri, seret-lepas, Kamera; diunggah di latar dengan
 * progres), pratinjau besar saat thumbnail diklik, geser urutan, hapus. Hasil unggahan yang melewati `max` ditolak
 * (hasil `files.upload` tidak punya rute hapus, jadi berkas yatimnya dibiarkan).
 */
export function ImageGalleryField({
  value,
  onChange,
  max = ITEM_LIMITS.attachments,
  itemLabel = '',
  onBusyChange,
}: ImageGalleryFieldProps) {
  // Nilai terbaru, termasuk perubahan yang belum sempat dirender induk; dibaca ulang saat unggahan selesai.
  const valueRef = useRef(value);
  valueRef.current = value;
  const commit = (next: string[]) => {
    valueRef.current = next;
    onChange(next);
  };
  const [dialog, setDialog] = useState<DialogState>(CLOSED);
  const [preview, setPreview] = useState<AttachmentItem | null>(null);
  const [full, setFull] = useState(false);

  const uploads = useBackgroundUploads({
    source: itemFileSource,
    onUploaded: (_owner, item) => {
      if (valueRef.current.length >= max) {
        setFull(true);
        return false;
      }
      commit([...valueRef.current, item.id]);
      return true;
    },
  });
  const own = uploads.forOwner(OWNER);
  // Unggahan yang menunggu/berjalan sudah mengisi kuota; yang gagal tidak.
  const reserved = own.entries.filter((entry) => entry.phase !== 'failed').length;
  const remaining = Math.max(0, max - value.length - reserved);
  const busy = own.busy;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  useEffect(() => {
    onBusyChangeRef.current?.(busy);
    return () => onBusyChangeRef.current?.(false);
  }, [busy]);

  function openDialog(files: File[], rejected: { name: string; reason: string }[]) {
    if (files.length === 0 && rejected.length === 0) return;
    if (remaining <= 0) {
      setFull(true);
      return;
    }
    setFull(false);
    setDialog({ open: true, files, rejected });
  }

  function move(index: number, delta: -1 | 1) {
    const next = [...valueRef.current];
    const target = index + delta;
    const moved = next[index];
    const other = next[target];
    if (moved === undefined || other === undefined) return;
    next[index] = other;
    next[target] = moved;
    commit(next);
  }

  function previewOf(id: string, index: number): AttachmentItem {
    const alt = `Gambar ${index + 1}${itemLabel ? ` ${itemLabel}` : ''}`;
    return {
      id,
      name: alt,
      mime: 'image/*',
      renderImage: (variant) => (
        <ImageThumb
          id={id}
          alt={alt}
          className={variant === 'thumb' ? 'size-full' : 'max-h-[70dvh] max-w-full'}
        />
      ),
    };
  }

  return (
    <>
      <FileDropZone accept={itemFileSource.mimeTypes} onFiles={openDialog} className="space-y-2">
        <fieldset className="m-0 min-w-0 space-y-2 border-0 p-0">
          <legend className="sr-only">Gambar lampiran</legend>
          {value.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {value.map((id, index) => (
                <li key={id} className="space-y-1">
                  <button
                    type="button"
                    aria-label={`Perbesar gambar ${index + 1}`}
                    className="block aspect-square w-full cursor-zoom-in overflow-hidden rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() => setPreview(previewOf(id, index))}
                  >
                    {previewOf(id, index).renderImage?.('thumb')}
                  </button>
                  <div className="flex items-center justify-between gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Geser gambar ${index + 1} ke kiri`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ChevronLeft aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Hapus gambar ${index + 1}`}
                      onClick={() => commit(valueRef.current.filter((_, i) => i !== index))}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Geser gambar ${index + 1} ke kanan`}
                      disabled={index === value.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : own.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada gambar.</p>
          ) : null}
          <AttachmentView
            items={[]}
            pending={own.entries}
            layout="grid"
            label="gambar lampiran"
            onRetry={own.retry}
            onCancel={own.remove}
          />
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={remaining <= 0}
              onClick={() => {
                setFull(false);
                setDialog({ open: true, files: [], rejected: [] });
              }}
            >
              <ImagePlus aria-hidden="true" />
              Tambah gambar
            </Button>
            <span className="text-xs text-muted-foreground">
              {value.length + reserved}/{max}
            </span>
            <span aria-live="polite" className="text-xs text-muted-foreground">
              {busy ? 'Mengunggah gambar…' : ''}
            </span>
          </div>
          {full ? (
            <p role="alert" className="text-sm text-destructive">
              Maksimal {max} gambar
            </p>
          ) : null}
        </fieldset>
      </FileDropZone>
      {dialog.open ? (
        <FileDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(CLOSED);
          }}
          source={itemFileSource}
          mode="multiple"
          accept={['image']}
          maxBytes={MAX_IMAGE_BYTES}
          maxFiles={Math.max(1, remaining)}
          initialFiles={dialog.files.length > 0 ? dialog.files : undefined}
          initialRejected={dialog.rejected.length > 0 ? dialog.rejected : undefined}
          title="Tambah gambar"
          confirmLabel="Tambahkan"
          hideNames
          onConfirm={(result) => own.add(result.files)}
        />
      ) : null}
      <PreviewDialog item={preview} onClose={() => setPreview(null)} />
    </>
  );
}
