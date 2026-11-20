import { MAX_FILE_BYTES } from '@shared/files';
import { Camera, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isCameraBlocked,
  markCameraBlocked,
  resetCameraBlocked,
} from '@/components/camera/camera-session';
import { cameraSupported } from '@/components/camera/use-camera-stream';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type FileCategory, fileMime, formatBytes, resolveAccept } from './accept';
import { type AttachmentItem, AttachmentView, libraryItemToAttachment } from './attachment-view';
import { CameraDialog, type CameraShot, type CameraStampSlot } from './camera/camera-dialog';
import { FileDropZone } from './file-drop-zone';
import { FilePicker } from './file-picker';
import { intakeFiles } from './intake';
import { LibraryTab } from './library-tab';
import { PreviewDialog } from './preview-dialog';
import { RejectedList } from './rejected-list';
import {
  type FileSource,
  isLibrarySource,
  type LibraryItem,
  type QueuedFile,
  type RejectedFile,
} from './types';
import { useObjectUrls } from './use-object-urls';

const DEFAULT_MAX_FILES = 20;

/** Hasil dialog: pilihan dari Pustaka (sudah di server) dan berkas baru yang akan diunggah pemanggil. */
export interface FileDialogResult {
  library: LibraryItem[];
  files: QueuedFile[];
}

export interface FileDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Dipakai untuk tab Pustaka (bila sumber berpustaka), format yang didukung, dan aturan nama. TIDAK dipakai mengunggah. */
  source: FileSource;
  mode: 'single' | 'multiple';
  accept: readonly FileCategory[];
  /** Bawaan `MAX_FILE_BYTES`. */
  maxBytes?: number;
  /** Sisa kapasitas dari pemanggil (mode `multiple`); bawaan 20. */
  maxFiles?: number;
  /** Dari seret-lepas: berkas sudah di antrean saat dialog terbuka. */
  initialFiles?: File[];
  /** Berkas yang sudah ditolak saat dijatuhkan (nama + alasan). */
  initialRejected?: RejectedFile[];
  /** Bawaan true; efektif hanya bila `isLibrarySource(source)`. */
  showLibrary?: boolean;
  /** Bawaan true bila `accept` memuat `'image'`. Objek = aktif dengan slot cap opsional. */
  camera?: boolean | { stamp?: CameraStampSlot };
  /** Bawaan: "Pilih gambar" / "Pilih berkas". */
  title?: string;
  /** Bawaan 'Lampirkan'. */
  confirmLabel?: string;
  /** Sembunyikan pengubah nama (bawaan false; nama hanya dapat diubah bila sumber punya `nameMax`). */
  hideNames?: boolean;
  onConfirm(result: FileDialogResult): void;
}

function sameFiles(a: readonly File[], b: readonly File[]): boolean {
  return a.length === b.length && a.every((file, index) => file === b[index]);
}

type TabValue = 'upload' | 'library';

/**
 * Dialog lampiran terpadu: tab Unggah (seret-lepas, Telusuri, Kamera, antrean) dan tab Pustaka (bila sumber berpustaka).
 * TIDAK mengunggah: konfirmasi menyerahkan `{ library, files }` ke pemanggil lalu menutup. `AlertDialog`: klik di luar
 * tidak menutup; Esc/Batal dengan isi meminta konfirmasi "Buang N berkas?".
 */
export function FileDialog({
  open,
  onOpenChange,
  source,
  mode,
  accept,
  maxBytes = MAX_FILE_BYTES,
  maxFiles = DEFAULT_MAX_FILES,
  initialFiles,
  initialRejected,
  showLibrary = true,
  camera,
  title,
  confirmLabel = 'Lampirkan',
  hideNames,
  onConfirm,
}: FileDialogProps) {
  const mimes = useMemo(() => resolveAccept(accept, source.mimeTypes), [accept, source.mimeTypes]);
  const librarySource = showLibrary && isLibrarySource(source) ? source : null;
  const capacity = mode === 'single' ? 1 : maxFiles;
  const onlyImage = accept.length === 1 && accept[0] === 'image';
  const cameraWanted = camera === undefined ? accept.includes('image') : camera !== false;
  const stamp = typeof camera === 'object' ? camera.stamp : undefined;
  const canRename = source.nameMax !== undefined && !hideNames;

  const [tab, setTab] = useState<TabValue>('upload');
  const [queued, setQueuedState] = useState<QueuedFile[]>([]);
  const [selection, setSelectionState] = useState<ReadonlyMap<string, LibraryItem>>(new Map());
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraBlocked, setCameraBlocked] = useState(isCameraBlocked);
  // Cermin sinkron: dua masukan beruntun (mis. banyak jepretan) harus melihat keadaan terkini.
  const queuedRef = useRef<QueuedFile[]>([]);
  const selectionRef = useRef<ReadonlyMap<string, LibraryItem>>(new Map());
  const consumedInitial = useRef<{ files: File[]; rejected?: RejectedFile[] } | undefined>(
    undefined,
  );

  // Stabil (hanya menyentuh ref dan setState) agar aman dipakai di dependensi efek.
  const setQueued = useCallback((next: QueuedFile[]) => {
    queuedRef.current = next;
    setQueuedState(next);
  }, []);
  const setSelection = useCallback((next: ReadonlyMap<string, LibraryItem>) => {
    selectionRef.current = next;
    setSelectionState(next);
  }, []);
  function addRejected(items: RejectedFile[]) {
    if (items.length > 0) setRejected((current) => [...current, ...items]);
  }

  /** Sisa tempat untuk berkas baru (mode `single` selalu 1: berkas baru menggantikan). */
  function roomLeft(): number {
    if (mode === 'single') return 1;
    return Math.max(0, capacity - queuedRef.current.length - selectionRef.current.size);
  }

  function addFiles(files: File[], refused: RejectedFile[] = []) {
    if (files.length > 0 && mode === 'single') setSelection(new Map());
    const base = mode === 'single' && files.length > 0 ? [] : queuedRef.current;
    const result = intakeFiles(files, {
      accept: mimes,
      maxBytes,
      nameMax: source.nameMax,
      room: mode === 'single' ? 1 : roomLeft(),
      max: capacity,
    });
    setQueued(mode === 'single' && files.length > 0 ? result.queued : [...base, ...result.queued]);
    addRejected([...refused, ...result.rejected]);
    if (files.length > 0 || refused.length > 0) setTab('upload');
  }

  /** Jepretan kamera: masuk antrean seperti berkas biasa; penuh = galat yang tampil di kamera. */
  function takeShot(file: File) {
    if (mode === 'single') {
      setSelection(new Map());
      setQueued(
        intakeFiles([file], { accept: mimes, maxBytes, nameMax: source.nameMax, room: 1 }).queued,
      );
      return;
    }
    const result = intakeFiles([file], {
      accept: mimes,
      maxBytes,
      nameMax: source.nameMax,
      room: roomLeft(),
      max: capacity,
    });
    const reason = result.rejected[0]?.reason;
    if (reason !== undefined) throw new Error(reason);
    setQueued([...queuedRef.current, ...result.queued]);
  }

  function toggle(item: LibraryItem) {
    const current = selectionRef.current;
    if (current.has(item.id)) {
      const next = new Map(current);
      next.delete(item.id);
      setSelection(next);
      return;
    }
    if (mode === 'single') {
      setQueued([]);
      setSelection(new Map([[item.id, item]]));
      return;
    }
    if (roomLeft() <= 0) {
      addRejected([{ name: item.name, reason: `Maksimal ${capacity} berkas per unggahan` }]);
      return;
    }
    setSelection(new Map(current).set(item.id, item));
  }

  const total = queued.length + selection.size;

  function requestClose() {
    if (total > 0) setConfirmDiscard(true);
    else onOpenChange(false);
  }

  function confirm() {
    if (total === 0) return;
    onConfirm({ library: [...selectionRef.current.values()], files: queuedRef.current });
    onOpenChange(false);
  }

  // Berkas awal (seret-lepas) masuk antrean sekali per pembukaan; Strict Mode memanggil efek dua kali.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `addFiles` dibuat ulang tiap render; hanya masukan ini yang memicu.
  useEffect(() => {
    const files = initialFiles ?? [];
    const refused = initialRejected ?? [];
    if (!open || (files.length === 0 && refused.length === 0)) return;
    const seen = consumedInitial.current;
    if (seen && sameFiles(seen.files, files) && seen.rejected === initialRejected) return;
    consumedInitial.current = { files, rejected: initialRejected };
    addFiles(files, refused);
  }, [open, initialFiles, initialRejected]);

  // Menutup dialog membersihkan antrean, pilihan, dan keadaan sementara.
  useEffect(() => {
    if (open) return;
    consumedInitial.current = undefined;
    setQueued([]);
    setSelection(new Map());
    setRejected([]);
    setPreview(null);
    setTab('upload');
    setConfirmDiscard(false);
    setCameraOpen(false);
  }, [open, setQueued, setSelection]);

  const urls = useObjectUrls(queued);
  const attachments = useMemo<AttachmentItem[]>(
    () =>
      queued.map((entry) => {
        const url = urls.get(entry.key);
        return {
          id: entry.key,
          name: entry.name,
          mime: fileMime(entry.file),
          size: entry.file.size,
          ...(url
            ? {
                renderImage: (variant: 'thumb' | 'large') => (
                  <img
                    src={url}
                    alt={entry.name}
                    className={
                      variant === 'thumb'
                        ? 'size-full object-cover'
                        : 'max-h-[70dvh] max-w-full object-contain'
                    }
                  />
                ),
              }
            : {}),
        };
      }),
    [queued, urls],
  );
  const cameraShots = useMemo<CameraShot[]>(
    () =>
      queued.flatMap((entry) => {
        const url = urls.get(entry.key);
        return url ? [{ key: entry.key, url }] : [];
      }),
    [queued, urls],
  );

  const canCamera = cameraWanted && cameraSupported() && !cameraBlocked;
  const noun = onlyImage ? 'gambar' : 'berkas';

  const uploadTab = (
    <FileDropZone
      accept={mimes}
      className="flex min-h-0 flex-1 flex-col gap-3"
      onFiles={(files, refused) => addFiles(files, refused)}
    >
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center">
        <Upload aria-hidden className="size-6 text-muted-foreground" />
        <p className="text-sm">Seret {noun} ke sini, atau</p>
        <div className="flex flex-wrap justify-center gap-2">
          <FilePicker
            accept={mimes}
            multiple={mode === 'multiple'}
            onFiles={(files, refused) => addFiles(files, refused)}
          >
            Telusuri
          </FilePicker>
          {canCamera ? (
            <Button type="button" variant="outline" onClick={() => setCameraOpen(true)}>
              <Camera aria-hidden />
              Kamera
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Maksimum {formatBytes(maxBytes)} per berkas
          {mode === 'multiple' ? `, hingga ${capacity} berkas sekali unggah` : ''}.
        </p>
      </div>
      <RejectedList items={rejected} onClear={() => setRejected([])} />
      <AttachmentView
        items={attachments}
        layout={onlyImage ? 'grid' : 'list'}
        label="antrean"
        onRemove={(key) => setQueued(queuedRef.current.filter((entry) => entry.key !== key))}
        {...(canRename
          ? {
              nameMax: source.nameMax,
              onRename: (key: string, name: string) => {
                const trimmed = name.trim();
                if (trimmed === '') return;
                setQueued(
                  queuedRef.current.map((entry) =>
                    entry.key === key ? { ...entry, name: trimmed } : entry,
                  ),
                );
              },
            }
          : {})}
      />
    </FileDropZone>
  );

  const libraryTab = librarySource ? (
    <LibraryTab
      source={librarySource}
      selection={selection}
      mode={mode}
      onToggle={toggle}
      onPreview={setPreview}
      accept={mimes}
      onFiles={(files, refused) => addFiles(files, refused)}
      onRenamed={(item) => {
        if (!selectionRef.current.has(item.id)) return;
        setSelection(new Map(selectionRef.current).set(item.id, item));
      }}
      onRemoved={(id) => {
        if (!selectionRef.current.has(id)) return;
        const next = new Map(selectionRef.current);
        next.delete(id);
        setSelection(next);
      }}
    />
  ) : null;

  return (
    <>
      <AlertDialog open={open}>
        <AlertDialogContent
          className="data-[size=default]:max-w-2xl data-[size=default]:sm:max-w-4xl max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:h-[80dvh]"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            requestClose();
          }}
        >
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>
              {title ?? (onlyImage ? 'Pilih gambar' : 'Pilih berkas')}
            </AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              {librarySource
                ? 'Unggah berkas baru atau pilih dari pustaka.'
                : 'Pilih berkas untuk dilampirkan.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {librarySource ? (
            <Tabs
              value={tab}
              onValueChange={(value) => setTab(value as TabValue)}
              className="min-h-0 flex-1"
            >
              <TabsList>
                <TabsTrigger value="upload">
                  Unggah{queued.length > 0 ? ` (${queued.length})` : ''}
                </TabsTrigger>
                <TabsTrigger value="library">
                  Pustaka{selection.size > 0 ? ` (${selection.size})` : ''}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="upload" className="min-h-0 flex-1 overflow-y-auto">
                {uploadTab}
              </TabsContent>
              <TabsContent value="library" className="min-h-0 flex-1 overflow-y-auto">
                {libraryTab}
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{uploadTab}</div>
          )}
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={requestClose}>
              Batal
            </Button>
            <Button type="button" disabled={total === 0} onClick={confirm}>
              {confirmLabel} ({total})
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Buang {total} berkas?</AlertDialogTitle>
            <AlertDialogDescription>
              Berkas yang sudah dipilih belum dilampirkan dan akan hilang bila ditutup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDiscard(false)}>
              Tidak
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false);
                onOpenChange(false);
              }}
            >
              Ya, buang
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PreviewDialog
        item={preview ? libraryItemToAttachment(preview) : null}
        onClose={() => setPreview(null)}
      />

      {canCamera || cameraOpen ? (
        <CameraDialog
          open={cameraOpen}
          onOpenChange={setCameraOpen}
          remaining={roomLeft()}
          stamp={stamp}
          shots={cameraShots}
          onRemoveShot={(key) => setQueued(queuedRef.current.filter((entry) => entry.key !== key))}
          onShot={takeShot}
          // Izin ditolak atau kamera tak ada: pesannya tampil di kamera, lalu tombol Kamera hilang (Telusuri tetap).
          onUnavailable={() => {
            markCameraBlocked();
            setCameraBlocked(true);
          }}
          // "Coba lagi" berhasil menyalakan kamera: tombol Kamera boleh tampil lagi.
          onAvailable={() => {
            resetCameraBlocked();
            setCameraBlocked(false);
          }}
        />
      ) : null}
    </>
  );
}
