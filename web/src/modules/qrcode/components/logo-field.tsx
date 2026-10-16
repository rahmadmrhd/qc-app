import type { QrDesignDto } from '@shared/rpc';
import { useState } from 'react';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { prepareImage } from '@/modules/files/image';
import { useFileUrl, useUploadFile } from '@/modules/files/queries';

const LOGO_MAX_SIDE = 512;

export interface LogoFieldProps {
  value: string;
  onChange: (fileId: string) => void;
  /** Konfigurasi lain: logonya dapat dipakai ulang tanpa unggah ulang. */
  designs: readonly QrDesignDto[];
  /** Dipanggil saat unggahan logo mulai/selesai; induk menonaktifkan Simpan selama berjalan. */
  onBusyChange?: (busy: boolean) => void;
}

export function LogoField({ value, onChange, designs, onBusyChange }: LogoFieldProps) {
  const upload = useUploadFile();
  const { url, isLoading: loadingLogo } = useFileUrl(value);
  const [phase, setPhase] = useState<'resize' | 'upload' | null>(null);
  const uploading = phase !== null;
  const [error, setError] = useState<string | null>(null);
  const reusable = designs.filter((design, index, all) => {
    return (
      design.logoFileId !== '' && all.findIndex((d) => d.logoFileId === design.logoFileId) === index
    );
  });

  async function choose(file: File | undefined) {
    setError(null);
    if (!file) return;
    onBusyChange?.(true);
    setPhase('resize');
    try {
      const prepared = await prepareImage(file, LOGO_MAX_SIDE);
      setPhase('upload');
      onChange((await upload.mutateAsync(prepared)).id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal mengunggah logo');
    } finally {
      setPhase(null);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="space-y-3">
      {uploading ? (
        <p className="text-sm text-muted-foreground">
          <BusyLabel>
            {phase === 'resize'
              ? 'Memeriksa dan mengecilkan gambar logo…'
              : 'Mengunggah logo ke Drive…'}
          </BusyLabel>
        </p>
      ) : value !== '' && loadingLogo ? (
        <p className="text-sm text-muted-foreground">
          <BusyLabel>Memuat gambar logo dari Drive…</BusyLabel>
        </p>
      ) : value !== '' && url ? (
        <img
          src={url}
          alt="Logo label"
          className="h-16 w-16 rounded border bg-white object-contain p-1"
        />
      ) : (
        <p className="text-sm text-muted-foreground">Tanpa logo (QR polos).</p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="qr-logo-file">Unggah logo</Label>
        <Input
          id="qr-logo-file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploading}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      {reusable.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor="qr-logo-reuse">Pakai logo dari konfigurasi lain</Label>
          <select
            id="qr-logo-reuse"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value=""
            onChange={(event) => event.target.value !== '' && onChange(event.target.value)}
          >
            <option value="">Pilih konfigurasi…</option>
            {reusable.map((design) => (
              <option key={design.id} value={design.logoFileId}>
                {design.title}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {value !== '' ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange('')}>
          Hapus logo
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
