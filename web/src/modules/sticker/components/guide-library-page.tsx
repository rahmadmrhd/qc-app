import { MAX_IMAGE_BYTES } from '@shared/files';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  FileDialog,
  FileDropZone,
  type LibraryItem,
  LibraryTab,
  libraryItemToAttachment,
  PreviewDialog,
} from '@/components/file-dialog';
import { Button } from '@/components/ui/button';
import { stickerGuideSource } from '../lib/guide-source';

interface UploadDialogState {
  open: boolean;
  files: File[];
  rejected: { name: string; reason: string }[];
}

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

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: [source.key] });
  }

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
      {canUpload ? (
        <FileDialog
          open={upload.open}
          onOpenChange={(open) => {
            if (open) return;
            setUpload(CLOSED);
            // Sebagian berkas mungkin sudah terunggah walau dialog ditutup sebelum selesai.
            void refresh();
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
          onSelect={(items) => {
            void refresh();
            toast.success(`${items.length} gambar ditambahkan`);
          }}
        />
      ) : null}
      <PreviewDialog
        item={preview ? libraryItemToAttachment(preview) : null}
        onClose={() => setPreview(null)}
      />
    </>
  );
}
