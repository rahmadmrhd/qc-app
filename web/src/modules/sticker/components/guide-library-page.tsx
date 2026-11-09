import { MAX_IMAGE_BYTES } from '@shared/files';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { FileDialog, type LibraryItem, LibraryTab, PreviewDialog } from '@/components/file-dialog';
import { Button } from '@/components/ui/button';
import { stickerGuideSource } from '../lib/guide-source';

interface UploadDialogState {
  open: boolean;
  files: File[];
  rejected: { name: string; reason: string }[];
}

const CLOSED: UploadDialogState = { open: false, files: [], rejected: [] };

/**
 * Halaman Pustaka Gambar (gambar contoh stiker): kisi pustaka yang dapat dicari/diurut/difilter, ganti nama dan hapus
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Pustaka Gambar</h1>
        {canUpload ? (
          <Button onClick={() => setUpload({ open: true, files: [], rejected: [] })}>
            Unggah gambar
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Gambar contoh yang dipakai stiker. Seret berkas ke halaman ini untuk mengunggah.
      </p>
      <LibraryTab
        source={source}
        selection={new Map()}
        mode="multiple"
        selectable={false}
        accept={source.mimeTypes}
        onToggle={() => undefined}
        onPreview={setPreview}
        onFiles={(files, rejected) => {
          if (!canUpload) {
            toast.error('Anda tidak memiliki izin untuk mengunggah gambar');
            return;
          }
          if (files.length > 0 || rejected.length > 0) setUpload({ open: true, files, rejected });
        }}
      />
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
      <PreviewDialog item={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
