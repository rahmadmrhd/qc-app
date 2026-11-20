import { type ReactNode, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { partitionByType } from './accept';
import type { RejectedFile } from './types';

export interface FilePickerProps {
  /** Jenis (mime) yang diterima. Pemilih berkas dapat lolos dari filter `accept` (mis. "Semua berkas"), jadi dipisah lagi. */
  accept: readonly string[];
  multiple?: boolean;
  disabled?: boolean;
  /** Berkas bertipe sah dan berkas yang ditolak (nama + alasan). Ukuran diperiksa pemanggil (`intakeFiles`). */
  onFiles(files: File[], rejected: RejectedFile[]): void;
  /** Label tombol. */
  children: ReactNode;
  className?: string;
}

/**
 * Tombol "Telusuri" berkas: satu-satunya tempat yang membuat `<input type="file">` (selain impor). Pilihan yang sama
 * dapat dipilih lagi; berkas dipisah menurut tipe seperti saat seret-lepas.
 */
export function FilePicker({
  accept,
  multiple,
  disabled,
  onFiles,
  children,
  className,
}: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        className={className}
        onClick={() => inputRef.current?.click()}
      >
        {children}
      </Button>
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple={multiple}
        accept={accept.join(',')}
        data-testid="file-picker-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Pilihan yang sama dapat dipilih lagi.
          event.target.value = '';
          if (files.length === 0) return;
          const split = partitionByType(files, accept);
          onFiles(split.files, split.rejected);
        }}
      />
    </>
  );
}
