import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';

/** Indikator proses berjalan (memuat, memeriksa, mengunggah, menyimpan). */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <LoaderCircle
      role="status"
      aria-label="Memuat"
      className={`size-4 animate-spin${className ? ` ${className}` : ''}`}
    />
  );
}

/** Teks proses dengan spinner di sampingnya, mis. "Memeriksa berkas…". */
export function BusyLabel({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LoaderCircle aria-hidden className="size-4 animate-spin" />
      <span>{children}</span>
    </span>
  );
}
