import { BusyLabel } from '@/components/spinner';
import { useFileUrl } from '@/modules/files/queries';

/** Gambar logo dari Drive dengan keterangan saat dimuat. */
export function LogoThumb({ id, label }: { id: string; label: string }) {
  const { url, isLoading, isError } = useFileUrl(id);
  if (isLoading) {
    return (
      <span className="flex h-16 w-16 items-center justify-center text-xs text-muted-foreground">
        <BusyLabel>Memuat…</BusyLabel>
      </span>
    );
  }
  if (isError || !url) {
    return <span className="text-xs text-destructive-text">Logo tidak dapat dimuat</span>;
  }
  return (
    <img src={url} alt={label} className="h-16 w-16 rounded border bg-white object-contain p-1" />
  );
}

export interface LogoPickerProps {
  /** Logo terpilih; kosong = tanpa logo. */
  value: string;
  onChange: (fileId: string) => void;
  /** Id logo pada pustaka yang diatur pengelola di Konfigurasi default. */
  library: readonly string[];
}

/** Memilih logo dari pustaka (tanpa unggah). Logo lama di luar pustaka tetap tampil agar dapat dipertahankan. */
export function LogoPicker({ value, onChange, library }: LogoPickerProps) {
  const outside = value !== '' && !library.includes(value);
  const choices = outside ? [value, ...library] : [...library];
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Logo" className="flex flex-wrap gap-3">
        <label className="flex cursor-pointer flex-col items-center gap-1 text-sm">
          <input
            type="radio"
            name="qr-logo"
            aria-label="Tanpa logo"
            checked={value === ''}
            onChange={() => onChange('')}
          />
          <span className="flex h-16 w-16 items-center justify-center rounded border text-xs text-muted-foreground">
            Tanpa logo
          </span>
        </label>
        {choices.map((id, index) => (
          <label key={id} className="flex cursor-pointer flex-col items-center gap-1 text-sm">
            <input
              type="radio"
              name="qr-logo"
              aria-label={
                outside && index === 0 ? 'Logo saat ini (di luar pustaka)' : `Logo ${index + 1}`
              }
              checked={value === id}
              onChange={() => onChange(id)}
            />
            <LogoThumb id={id} label={`Logo ${index + 1}`} />
            {outside && index === 0 ? (
              <span className="text-xs text-muted-foreground">Logo saat ini</span>
            ) : null}
          </label>
        ))}
      </div>
      {library.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Pustaka logo masih kosong. Pengelola menambahkan logo di halaman Konfigurasi default.
        </p>
      ) : null}
    </div>
  );
}
