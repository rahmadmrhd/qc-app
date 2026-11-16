import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Spinner } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type FileCategory, resolveAccept } from './accept';
import { errorText } from './error-text';
import { LibraryTab } from './library-tab';
import { PreviewDialog } from './preview-dialog';
import type { FileLibrarySource, LibraryItem } from './types';
import { UploadTab } from './upload-tab';
import { type RejectedFile, useUploadQueue } from './use-upload-queue';

const DEFAULT_MAX_FILES = 20;

export interface FileDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  source: FileLibrarySource;
  mode: 'single' | 'multiple';
  accept: readonly FileCategory[];
  maxBytes: number;
  /** Maksimum berkas dalam satu antrean unggah (mode `multiple`). */
  maxFiles?: number;
  /** Dari seret-lepas: tab Unggah terbuka dengan berkas sudah di antrean. */
  initialFiles?: File[];
  /** Berkas yang sudah ditolak saat dijatuhkan (nama + alasan); ditampilkan di tab Unggah bersama `initialFiles`. */
  initialRejected?: { name: string; reason: string }[];
  /** Bawaan true. False = hanya pengunggahan (tanpa tab Pustaka), mis. bila pustaka sudah tampil di halaman. */
  showLibrary?: boolean;
  /** Teks tombol konfirmasi; bawaan 'Lampirkan'. */
  confirmLabel?: string;
  /** Bawaan 'Pilih gambar'. */
  title?: string;
  /**
   * Opsional: menambah tombol "Ambil foto dengan kamera" di tab Unggah yang membuka aplikasi kamera bawaan perangkat
   * (`<input type="file" capture>`); hasilnya masuk antrean seperti berkas biasa. Pemanggil mengisinya hanya di perangkat
   * mobile. Tanpa prop ini dialog persis seperti semula.
   */
  capture?: 'environment' | 'user' | undefined;
  /** Berkas yang sudah ada di luar antrean; ikut dihitung pada "n dari m" tombol kamera. */
  captureCountOffset?: number | undefined;
  /** Sembunyikan pengubah nama berkas di antrean unggah (bawaan false). */
  hideNames?: boolean;
  /**
   * Dipanggil dengan hasil unggahan yang sudah naik ke sumber tetapi TIDAK diteruskan lewat `onSelect` saat dialog
   * ditutup (mis. sebagian gagal lalu dibatalkan), agar pemanggil membuangnya. Bawaan: tidak ada.
   */
  onDiscardUploaded?(items: LibraryItem[]): void;
  onSelect(items: LibraryItem[]): void;
}

function sameFiles(a: File[], b: File[]): boolean {
  return a.length === b.length && a.every((file, index) => file === b[index]);
}

type TabValue = 'upload' | 'library';

/** Dialog pilih berkas: tab Unggah (antrean) dan tab Pustaka (kisi), satu himpunan pilihan untuk keduanya. */
export function FileDialog({
  open,
  onOpenChange,
  source,
  mode,
  accept,
  maxBytes,
  maxFiles = DEFAULT_MAX_FILES,
  initialFiles,
  initialRejected,
  showLibrary = true,
  confirmLabel = 'Lampirkan',
  title = 'Pilih gambar',
  capture,
  captureCountOffset,
  hideNames,
  onDiscardUploaded,
  onSelect,
}: FileDialogProps) {
  const mimes = resolveAccept(accept, source.mimeTypes);
  const [tab, setTab] = useState<TabValue>('upload');
  const [selection, setSelection] = useState<ReadonlyMap<string, LibraryItem>>(new Map());
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const [busy, setBusy] = useState(false);
  // Penjaga sinkron: dua klik cepat tidak boleh memulai dua rangkaian unggah sebelum render berikutnya.
  const busyRef = useRef(false);
  const queryClient = useQueryClient();
  const consumedInitial = useRef<{ files: File[]; rejected?: RejectedFile[] } | undefined>(
    undefined,
  );
  const queue = useUploadQueue({
    source,
    accept: mimes,
    maxBytes,
    maxFiles: mode === 'single' ? 1 : maxFiles,
  });
  const { add, addRejected, reset } = queue;
  // Id hasil unggahan yang sudah diteruskan ke `onSelect`; sisanya (sudah naik, tak diteruskan) dibuang saat ditutup.
  const forwardedRef = useRef<Set<string>>(new Set());
  const onDiscardRef = useRef(onDiscardUploaded);
  onDiscardRef.current = onDiscardUploaded;
  const snapshotRef = useRef(queue.snapshot);
  snapshotRef.current = queue.snapshot;
  const discardStray = useRef(() => {
    const stray = snapshotRef
      .current()
      .flatMap((entry) =>
        entry.status === 'done' && entry.result && !forwardedRef.current.has(entry.result.id)
          ? [entry.result]
          : [],
      );
    forwardedRef.current = new Set();
    if (stray.length > 0) onDiscardRef.current?.(stray);
  }).current;
  // Komponen dilepas saat masih terbuka: hasil yang belum diteruskan tetap dibuang.
  useEffect(() => discardStray, [discardStray]);

  // Berkas awal (seret-lepas) masuk antrean sekali per pembukaan; Strict Mode memanggil efek dua kali.
  useEffect(() => {
    const files = initialFiles ?? [];
    const refused = initialRejected ?? [];
    if (!open || (files.length === 0 && refused.length === 0)) return;
    const seen = consumedInitial.current;
    if (seen && sameFiles(seen.files, files) && seen.rejected === initialRejected) return;
    consumedInitial.current = { files, rejected: initialRejected };
    setTab('upload');
    add(files);
    addRejected(refused);
  }, [open, initialFiles, initialRejected, add, addRejected]);

  // Menutup dialog membersihkan antrean dan pilihan.
  useEffect(() => {
    if (open) return;
    consumedInitial.current = undefined;
    discardStray();
    setSelection(new Map());
    setPreview(null);
    setTab('upload');
    reset();
  }, [open, reset, discardStray]);

  function handleFiles(files: File[], rejected: { name: string; reason: string }[]) {
    if (busyRef.current) return;
    if (mode === 'single' && files.length > 0) {
      // Satu item saja: berkas baru menggantikan pilihan/antrean sebelumnya.
      setSelection(new Map());
      reset();
    }
    add(files);
    addRejected(rejected);
    if (files.length > 0 || rejected.length > 0) setTab('upload');
  }

  function toggle(item: LibraryItem) {
    // Pilihan dibekukan selama mengunggah agar yang dilampirkan sama dengan yang terlihat saat Lampirkan ditekan.
    if (busyRef.current) return;
    setSelection((current) => {
      const next = new Map(mode === 'single' ? [] : current);
      if (current.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
    if (mode === 'single' && queue.snapshot().length > 0) reset();
  }

  const total = selection.size + queue.entries.length;
  const failed = queue.entries.filter((entry) => entry.status === 'failed').length;

  async function attach() {
    if (busyRef.current || total === 0) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const uploaded = await queue.start();
      // Yang sudah terunggah otomatis masuk pustaka: segarkan daftar (juga bila sebagian gagal).
      if (uploaded.length > 0) void queryClient.invalidateQueries({ queryKey: [source.key] });
      if (queue.snapshot().some((entry) => entry.status === 'failed')) {
        // Ada yang gagal: dialog tetap terbuka dan tab Unggah menampilkan yang gagal.
        setTab('upload');
        return;
      }
      for (const item of uploaded) forwardedRef.current.add(item.id);
      onSelect([...selectionRef.current.values(), ...uploaded]);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorText(error, 'Gagal melampirkan gambar'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function handleOpenChange(next: boolean) {
    // Selama mengunggah, dialog tidak ditutup: hasil unggahan akan hilang dari pilihan.
    if (!next && busyRef.current) return;
    onOpenChange(next);
  }

  const uploadTab = (
    <UploadTab
      queue={queue}
      accept={mimes}
      maxBytes={maxBytes}
      maxFiles={mode === 'single' ? 1 : maxFiles}
      nameMax={source.nameMax}
      disabled={busy}
      hideNames={hideNames}
      capture={capture}
      countOffset={captureCountOffset}
      single={mode === 'single'}
      onFiles={handleFiles}
    />
  );
  const libraryTab = (
    <LibraryTab
      source={source}
      selection={selection}
      mode={mode}
      onToggle={toggle}
      onPreview={setPreview}
      accept={mimes}
      onFiles={handleFiles}
      onRenamed={(item) =>
        setSelection((current) => {
          if (!current.has(item.id)) return current;
          return new Map(current).set(item.id, item);
        })
      }
      onRemoved={(id) =>
        setSelection((current) => {
          if (!current.has(id)) return current;
          const next = new Map(current);
          next.delete(id);
          return next;
        })
      }
    />
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="flex max-h-dvh flex-col gap-3 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:h-[80dvh] sm:max-w-4xl"
          onInteractOutside={(event) => {
            if (busyRef.current) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">
              {showLibrary
                ? 'Unggah berkas baru atau pilih dari pustaka.'
                : capture
                  ? 'Unggah berkas baru atau ambil foto dengan kamera.'
                  : 'Unggah berkas baru.'}
            </DialogDescription>
          </DialogHeader>
          {showLibrary ? (
            <Tabs
              value={tab}
              onValueChange={(value) => setTab(value as TabValue)}
              className="min-h-0 flex-1"
            >
              <TabsList>
                <TabsTrigger value="upload">
                  Unggah{queue.entries.length > 0 ? ` (${queue.entries.length})` : ''}
                </TabsTrigger>
                {showLibrary ? (
                  <TabsTrigger value="library">
                    Pustaka{selection.size > 0 ? ` (${selection.size})` : ''}
                  </TabsTrigger>
                ) : null}
              </TabsList>
              <TabsContent value="upload" className="min-h-0 flex-1 overflow-y-auto">
                {uploadTab}
              </TabsContent>
              {showLibrary ? (
                <TabsContent value="library" className="min-h-0 flex-1 overflow-y-auto">
                  {libraryTab}
                </TabsContent>
              ) : null}
            </Tabs>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{uploadTab}</div>
          )}
          {failed > 0 && !busy ? (
            <p role="status" className="text-sm text-destructive">
              {`${failed} berkas gagal diunggah. Periksa alasannya di daftar unggahan, lalu tekan ${confirmLabel} lagi; berkas yang sudah berhasil tidak diunggah ulang.`}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => handleOpenChange(false)}
            >
              Batal
            </Button>
            <Button type="button" disabled={busy || total === 0} onClick={() => void attach()}>
              {busy ? <Spinner /> : null}
              {confirmLabel} ({total})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PreviewDialog item={preview} onClose={() => setPreview(null)} />
    </>
  );
}
