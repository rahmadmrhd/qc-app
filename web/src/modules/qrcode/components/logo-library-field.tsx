import { QR_LIMITS } from '@shared/qrcode';
import { useState } from 'react';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { prepareImage } from '@/modules/files/image';
import { useUploadFile } from '@/modules/files/queries';
import { LogoThumb } from './logo-picker';

const LOGO_MAX_SIDE = 512;

export interface LogoLibraryFieldProps {
  /** Pustaka logo (id berkas). */
  library: readonly string[];
  onLibraryChange: (ids: string[]) => void;
  /** Logo awal pada QR baru; kosong = tanpa logo. */
  defaultLogoId: string;
  onDefaultLogoChange: (fileId: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

/** Mengelola pustaka logo (khusus pengelola): tambah, hapus, dan pilih logo awal untuk QR baru. */
export function LogoLibraryField({
  library,
  onLibraryChange,
  defaultLogoId,
  onDefaultLogoChange,
  onBusyChange,
}: LogoLibraryFieldProps) {
  const upload = useUploadFile();
  const [phase, setPhase] = useState<'resize' | 'upload' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const full = library.length >= QR_LIMITS.logoLibrary;

  async function add(file: File | undefined) {
    setError(null);
    if (!file) return;
    onBusyChange?.(true);
    setPhase('resize');
    try {
      const prepared = await prepareImage(file, LOGO_MAX_SIDE);
      setPhase('upload');
      const saved = await upload.mutateAsync(prepared);
      onLibraryChange([...library, saved.id]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal mengunggah logo');
    } finally {
      setPhase(null);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Logo di pustaka ini dapat dipilih user saat membuat QR. Pilih satu sebagai logo awal pada QR
        baru.
      </p>
      <div role="radiogroup" aria-label="Logo awal" className="flex flex-wrap gap-3">
        <label className="flex cursor-pointer flex-col items-center gap-1 text-sm">
          <input
            type="radio"
            name="qr-default-logo"
            aria-label="Tanpa logo awal"
            checked={defaultLogoId === ''}
            onChange={() => onDefaultLogoChange('')}
          />
          <span className="flex h-16 w-16 items-center justify-center rounded border text-xs text-muted-foreground">
            Tanpa logo
          </span>
        </label>
        {library.map((id, index) => (
          <div key={id} className="flex flex-col items-center gap-1 text-sm">
            <label className="flex cursor-pointer flex-col items-center gap-1">
              <input
                type="radio"
                name="qr-default-logo"
                aria-label={`Jadikan logo ${index + 1} sebagai logo awal`}
                checked={defaultLogoId === id}
                onChange={() => onDefaultLogoChange(id)}
              />
              <LogoThumb id={id} label={`Logo ${index + 1}`} />
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Hapus logo ${index + 1} dari pustaka`}
              onClick={() => {
                onLibraryChange(library.filter((item) => item !== id));
                if (defaultLogoId === id) onDefaultLogoChange('');
              }}
            >
              Hapus
            </Button>
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="qr-logo-library-file">Tambah logo ke pustaka</Label>
        <Input
          id="qr-logo-library-file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={phase !== null || full}
          onChange={(event) => {
            void add(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <p className="text-xs text-muted-foreground">
          {full ? `Pustaka penuh (maksimal ${QR_LIMITS.logoLibrary} logo). ` : ''}
          Logo dikecilkan otomatis. Perubahan pustaka tersimpan setelah Anda menekan Simpan.
        </p>
      </div>
      {phase !== null ? (
        <p role="status" className="text-sm">
          <BusyLabel>
            {phase === 'resize'
              ? 'Memeriksa dan mengecilkan gambar logo…'
              : 'Mengunggah logo ke Drive…'}
          </BusyLabel>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
