import { type DragEvent, type ReactNode, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { partitionByType } from './accept';

export interface FileDropZoneProps {
  accept: readonly string[];
  /** Berkas bertipe sah, dan berkas yang ditolak (nama + alasan). Ukuran diperiksa oleh antrean unggah. */
  onFiles(files: File[], rejected: { name: string; reason: string }[]): void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/** Area seret-lepas berkas: memisahkan berkas sah/tak sah berdasarkan tipe, lalu menyerahkannya ke `onFiles`. */
export function FileDropZone({
  accept,
  onFiles,
  children,
  className,
  disabled,
}: FileDropZoneProps) {
  const [active, setActive] = useState(false);
  // Hitung masuk/keluar anak elemen agar penanda tidak berkedip.
  const depth = useRef(0);

  function reset() {
    depth.current = 0;
    setActive(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (disabled || !hasFiles(event)) return;
    event.preventDefault();
    reset();
    const { files, rejected } = partitionByType(Array.from(event.dataTransfer.files), accept);
    if (files.length > 0 || rejected.length > 0) onFiles(files, rejected);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: area seret-lepas; unggah lewat papan ketik tersedia lewat tombol Telusuri
    <div
      data-file-drop-zone=""
      data-active={active ? '' : undefined}
      className={cn('relative', className)}
      onDragEnter={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setActive(true);
      }}
      onDragOver={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (disabled || !hasFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      }}
      onDrop={onDrop}
    >
      {children}
      {active ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 text-sm font-medium text-primary">
          Lepaskan berkas di sini
        </div>
      ) : null}
    </div>
  );
}
