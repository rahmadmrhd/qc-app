import { MAX_FILE_BYTES } from '@shared/files';
import { QR_LIMITS } from '@shared/qrcode';
import { useEffect, useRef, useState } from 'react';
import {
  type AttachmentItem,
  AttachmentView,
  FileDropZone,
  FilePicker,
  PreviewDialog,
  type RejectedFile,
  RejectedList,
} from '@/components/file-dialog';
import { intakeFiles } from '@/components/file-dialog/intake';
import { useBackgroundUploads } from '@/components/file-dialog/use-background-uploads';
import { Button } from '@/components/ui/button';
import { logoFileSource } from '@/modules/files/file-source';
import { LogoThumb } from './logo-picker';

export interface LogoLibraryFieldProps {
  /** Pustaka logo bersama (id berkas). */
  library: readonly string[];
  onLibraryChange: (ids: string[]) => void;
  /** Ada logo yang masih diunggah (true) atau tidak (false); induk menahan tombol simpan pustaka. */
  onBusyChange?: (busy: boolean) => void;
}

const OWNER = 'logos';

/** Mengelola pustaka logo bersama (khusus pengelola): tambah (pilih atau seret-lepas, dikecilkan 512 px) dan hapus logo. */
export function LogoLibraryField({
  library,
  onLibraryChange,
  onBusyChange,
}: LogoLibraryFieldProps) {
  // Nilai terbaru, termasuk perubahan yang belum sempat dirender induk; dibaca ulang saat unggahan selesai.
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [preview, setPreview] = useState<AttachmentItem | null>(null);

  // Satu per waktu agar urutan logo mengikuti urutan pilihan.
  const uploads = useBackgroundUploads({
    source: logoFileSource,
    concurrency: 1,
    onUploaded: (_owner, item) => {
      if (libraryRef.current.length >= QR_LIMITS.logoLibrary) return false;
      const next = [...libraryRef.current, item.id];
      libraryRef.current = next;
      onLibraryChange(next);
      return true;
    },
  });
  const own = uploads.forOwner(OWNER);
  // Unggahan yang menunggu/berjalan sudah mengisi kuota; yang gagal tidak.
  const reserved = own.entries.filter((entry) => entry.phase !== 'failed').length;
  const room = Math.max(0, QR_LIMITS.logoLibrary - library.length - reserved);
  const full = room <= 0;
  const busy = own.busy;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  useEffect(() => {
    onBusyChangeRef.current?.(busy);
    return () => onBusyChangeRef.current?.(false);
  }, [busy]);

  function add(files: File[], refused: RejectedFile[]) {
    const result = intakeFiles(files, {
      accept: logoFileSource.mimeTypes,
      maxBytes: MAX_FILE_BYTES,
      room,
    });
    setRejected([...refused, ...result.rejected]);
    if (result.queued.length > 0) own.add(result.queued);
  }

  function previewOf(id: string, index: number): AttachmentItem {
    const label = `Logo ${index + 1}`;
    return {
      id,
      name: label,
      mime: 'image/*',
      renderImage: (variant) =>
        variant === 'thumb' ? (
          <LogoThumb id={id} label={label} className="size-full object-contain" />
        ) : (
          <LogoThumb id={id} label={label} className="max-h-[70dvh] max-w-full object-contain" />
        ),
    };
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {library.map((id, index) => (
          <div key={id} className="flex flex-col items-center gap-1 text-sm">
            <button
              type="button"
              aria-label={`Perbesar logo ${index + 1}`}
              className="block h-16 w-16 cursor-zoom-in overflow-hidden rounded border bg-white p-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => setPreview(previewOf(id, index))}
            >
              {previewOf(id, index).renderImage?.('thumb')}
            </button>
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
        {library.length === 0 && own.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Pustaka masih kosong.</p>
        ) : null}
      </div>
      <AttachmentView
        items={[]}
        pending={own.entries}
        layout="grid"
        label="logo"
        onRetry={own.retry}
        onCancel={own.remove}
      />
      <FileDropZone
        accept={logoFileSource.mimeTypes}
        disabled={full}
        onFiles={add}
        className="space-y-1.5 rounded-md border border-dashed p-3"
      >
        <FilePicker accept={logoFileSource.mimeTypes} multiple disabled={full} onFiles={add}>
          Tambah logo ke pustaka
        </FilePicker>
        <p className="text-xs text-muted-foreground">
          {full
            ? `Pustaka penuh (maksimal ${QR_LIMITS.logoLibrary} logo). `
            : 'Atau seret gambar ke sini. '}
          Logo dikecilkan otomatis. Perubahan pustaka tersimpan setelah Anda menekan Simpan pustaka
          logo.
        </p>
      </FileDropZone>
      <RejectedList items={rejected} onClear={() => setRejected([])} />
      <PreviewDialog item={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
