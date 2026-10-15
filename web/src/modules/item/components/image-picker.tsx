import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { isAcceptedImage } from '@/modules/files/image';
import { uploadErrorMessage } from '@/modules/files/upload-error';
import { useUploadImage } from '@/modules/files/use-upload-image';
import { ImageThumb } from './image-thumb';

export interface ImagePickerProps {
  /** Id berkas terpilih, atau `null`. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Dipakai untuk nama aksesibel, mis. "stiker 1". */
  label: string;
}

/** Satu gambar opsional (mis. contoh stiker): pilih berkas → kecilkan → unggah. */
export function ImagePicker({ value, onChange, label }: ImagePickerProps) {
  const uploadImage = useUploadImage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!isAcceptedImage(file)) {
      setError('Hanya gambar JPEG, PNG, atau WebP');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      onChange(await uploadImage(file));
    } catch (failure) {
      setError(uploadErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {value ? <ImageThumb id={value} alt={`Contoh ${label}`} className="size-12" /> : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus aria-hidden="true" />
        {busy ? 'Mengunggah…' : value ? 'Ganti gambar' : 'Pilih gambar'}
      </Button>
      {value ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Hapus gambar contoh ${label}`}
          disabled={busy}
          onClick={() => onChange(null)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={`Gambar contoh ${label}`}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void pick(file);
        }}
      />
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
