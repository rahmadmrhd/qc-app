import { QR_LIMITS } from '@shared/qrcode';
import { useState } from 'react';
import { runBusy } from '@/app/pwa/busy';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { prepareImage } from '@/modules/files/image';
import { useUploadFile } from '@/modules/files/queries';
import { LogoThumb } from './logo-picker';

const LOGO_MAX_SIDE = 512;

export interface LogoLibraryFieldProps {
  /** Pustaka logo bersama (id berkas). */
  library: readonly string[];
  onLibraryChange: (ids: string[]) => void;
  onBusyChange?: (busy: boolean) => void;
}

/** Mengelola pustaka logo bersama (khusus pengelola): tambah dan hapus logo. */
export function LogoLibraryField({
  library,
  onLibraryChange,
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
      // Pengecilan + unggah = satu penulisan berjalan (muat ulang otomatis PWA tak boleh memotongnya).
      const saved = await runBusy(async () => {
        const prepared = await prepareImage(file, LOGO_MAX_SIDE);
        setPhase('upload');
        return upload.mutateAsync(prepared);
      });
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
      <div className="flex flex-wrap gap-3">
        {library.map((id, index) => (
          <div key={id} className="flex flex-col items-center gap-1 text-sm">
            <LogoThumb id={id} label={`Logo ${index + 1}`} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Hapus logo ${index + 1} dari pustaka`}
              onClick={() => onLibraryChange(library.filter((item) => item !== id))}
            >
              Hapus
            </Button>
          </div>
        ))}
        {library.length === 0 ? (
          <p className="text-sm text-muted-foreground">Pustaka masih kosong.</p>
        ) : null}
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
          Logo dikecilkan otomatis. Perubahan pustaka tersimpan setelah Anda menekan Simpan pustaka
          logo.
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
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
