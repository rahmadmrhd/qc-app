import { ITEM_LIMITS } from '@shared/items';
import { ChevronLeft, ChevronRight, ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { isAcceptedImage } from '@/modules/files/image';
import { uploadErrorMessage } from '@/modules/files/upload-error';
import { useUploadImage } from '@/modules/files/use-upload-image';
import { ImageThumb } from './image-thumb';

export interface ImageGalleryFieldProps {
  value: readonly string[];
  onChange: (ids: string[]) => void;
  max?: number;
  disabled?: boolean;
}

/** Galeri gambar lampiran: tambah (kecilkan + unggah), geser urutan, hapus. */
export function ImageGalleryField({
  value,
  onChange,
  max = ITEM_LIMITS.attachments,
  disabled = false,
}: ImageGalleryFieldProps) {
  const uploadImage = useUploadImage();
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(files: File[]) {
    const images = files.filter(isAcceptedImage);
    if (images.length === 0) {
      setError('Hanya gambar JPEG, PNG, atau WebP');
      return;
    }
    setError(null);
    // Akumulasi lokal: render ulang induk belum tentu sudah terjadi di antara dua unggahan berturut-turut.
    let current: readonly string[] = valueRef.current;
    for (const file of images) {
      if (current.length >= max) {
        setError(`Maksimal ${max} gambar`);
        return;
      }
      setUploading((count) => count + 1);
      try {
        const id = await uploadImage(file);
        current = [...current, id];
        onChange([...current]);
      } catch (failure) {
        setError(uploadErrorMessage(failure));
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  function move(index: number, delta: -1 | 1) {
    const next = [...value];
    const target = index + delta;
    const moved = next[index];
    const other = next[target];
    if (moved === undefined || other === undefined) return;
    next[index] = other;
    next[target] = moved;
    onChange(next);
  }

  return (
    <div role="group" aria-label="Gambar lampiran" className="space-y-2">
      {value.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {value.map((id, index) => (
            <li key={id} className="space-y-1">
              <ImageThumb id={id} alt={`Gambar ${index + 1}`} className="aspect-square w-full" />
              <div className="flex items-center justify-between gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Geser gambar ${index + 1} ke kiri`}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Hapus gambar ${index + 1}`}
                  disabled={disabled}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Geser gambar ${index + 1} ke kanan`}
                  disabled={disabled || index === value.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Belum ada gambar.</p>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || value.length >= max}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus aria-hidden="true" />
          Tambah gambar
        </Button>
        <span className="text-xs text-muted-foreground">
          {value.length}/{max}
        </span>
        <span aria-live="polite" className="text-xs text-muted-foreground">
          {uploading > 0 ? 'Mengunggah gambar…' : ''}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        aria-label="Pilih gambar galeri"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length > 0) void addFiles(files);
        }}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
