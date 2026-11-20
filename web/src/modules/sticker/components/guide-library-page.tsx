import { MAX_IMAGE_BYTES } from '@shared/files';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AttachDialog,
  AttachmentView,
  FileDropZone,
  type LibraryItem,
  LibraryTab,
  libraryItemToAttachment,
  PreviewDialog,
} from '@/components/file-dialog';
import { useBackgroundUploads } from '@/components/file-dialog/use-background-uploads';
import { Button } from '@/components/ui/button';
import { stickerGuideSource } from '../lib/guide-source';

interface UploadDialogState {
  open: boolean;
  files: File[];
  rejected: { name: string; reason: string }[];
}

const OWNER = 'guides';
const CLOSED: UploadDialogState = { open: false, files: [], rejected: [] };

/**
 * Halaman Pustaka Gambar (gambar acuan penempelan stiker pada item): kisi pustaka yang dapat dicari/diurut/difilter, ganti nama dan hapus
 * lewat kartu, serta unggah lewat tombol atau seret-lepas. Tanpa izin `item: edit` halaman hanya dapat dibaca.
 */
export function GuideLibraryPage({ canUpload }: { canUpload: boolean }) {
  const queryClient = useQueryClient();
  const source = stickerGuideSource;
  const [upload, setUpload] = useState<UploadDialogState>(CLOSED);
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  // Unggahan berjalan di latar (progres tampil di halaman); tiap yang selesai langsung memuat ulang kisi.
  const done = useRef(0);
  const uploads = useBackgroundUploads({
    source,
    onUploaded: () => {
      done.current += 1;
      void refresh();
    },
  });
  const own = uploads.forOwner(OWNER);

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: [source.key] });
  }

  // Antrean habis (yang gagal tak dihitung): satu toast untuk semua yang berhasil.
  const busy = own.busy;
  useEffect(() => {
    if (busy || done.current === 0) return;
    toast.success(`${done.current} gambar ditambahkan`);
    done.current = 0;
  }, [busy]);

  function handleFiles(files: File[], rejected: { name: string; reason: string }[]) {
    if (!canUpload) {
      toast.error('Anda tidak memiliki izin untuk mengunggah gambar');
      return;
    }
    if (files.length > 0 || rejected.length > 0) setUpload({ open: true, files, rejected });
  }

  return (
    <>
      {/* Zona seret-lepas mencakup seluruh halaman; dialog di luarnya agar drop di dalam dialog tidak menggelembung ke sini. */}
      <FileDropZone accept={source.mimeTypes} onFiles={handleFiles} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Pustaka Gambar</h1>
          {canUpload ? (
            <Button onClick={() => setUpload({ open: true, files: [], rejected: [] })}>
              Unggah gambar
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Gambar acuan penempelan stiker pada item. Seret berkas ke halaman ini untuk mengunggah.
        </p>
        <AttachmentView
          items={[]}
          pending={own.entries}
          layout="list"
          label="unggahan gambar"
          onRetry={own.retry}
          onCancel={own.remove}
        />
        <LibraryTab
          source={source}
          selection={new Map()}
          mode="multiple"
          selectable={false}
          accept={source.mimeTypes}
          onToggle={() => undefined}
          onPreview={setPreview}
          dropZone={false}
          onFiles={handleFiles}
        />
      </FileDropZone>
      {canUpload && upload.open ? (
        <AttachDialog
          open
          onOpenChange={(open) => {
            if (!open) setUpload(CLOSED);
          }}
          source={source}
          mode="multiple"
          accept={['image']}
          maxBytes={MAX_IMAGE_BYTES}
          initialFiles={upload.files.length > 0 ? upload.files : undefined}
          initialRejected={upload.rejected.length > 0 ? upload.rejected : undefined}
          showLibrary={false}
          confirmLabel="Unggah"
          title="Unggah gambar"
          onConfirm={(result) => own.add(result.files)}
        />
      ) : null}
      <PreviewDialog
        item={preview ? libraryItemToAttachment(preview) : null}
        onClose={() => setPreview(null)}
      />
    </>
  );
}
