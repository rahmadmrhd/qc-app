import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from '@shared/files';
import { Camera, CircleAlert, ImagePlus, X } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { checkFile, formatBytes, partitionByType } from '@/components/file-dialog/accept';
import { errorText } from '@/components/file-dialog/error-text';
import { FileDropZone } from '@/components/file-dialog/file-drop-zone';
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
import { isCameraBlocked, markCameraBlocked, resetCameraBlocked } from '../lib/camera-session';
import { type ProofPhotoRef, proofSource, toProofRef } from '../lib/proof-source';
import type { StampPreviewInput } from '../lib/stamp-preview';
import { cameraSupported } from '../lib/use-camera-stream';
import { discardProofPhotos } from '../queries';
import { ProofCameraDialog } from './proof-camera';
import { ProofPhotoGrid } from './proof-photo-grid';

export interface ProofPhotoDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Foto yang sudah menjadi bagian entri (dihitung ke batas). */
  existingCount: number;
  /** Maksimum foto per entri. */
  max: number;
  /** Data pratinjau cap di kamera; tanpa ini kamera tidak menampilkan pratinjau cap. */
  stamp?: StampPreviewInput | undefined;
  /** Foto baru yang dikonfirmasi lewat "Tambahkan". */
  onAdd(photos: ProofPhotoRef[]): void;
}

/**
 * Dialog "Foto bukti": tombol Kamera (kamera layar penuh di dalam aplikasi) dan Telusuri (multi-pilih); kamera bawaan
 * sistem ponsel tidak ditawarkan (keputusan pemilik 2026-11-18). Setiap foto langsung diunggah (jadi `draft` di server)
 * dan tampil di kisi; baru masuk ke entri saat "Tambahkan". Menutup dialog dengan cara apa pun selain "Tambahkan"
 * (Batal, Esc, tombol tutup, unmount induk) membuang foto yang diunggah pada pembukaan itu.
 */
export function ProofPhotoDialog({ open, onOpenChange, ...rest }: ProofPhotoDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Isi (dan keadaan unggah) hanya ada selama dialog terbuka: menutup = unmount = pembersihan. */}
      <DialogContent className="sm:max-w-lg">
        <ProofPhotoBody onClose={() => onOpenChange(false)} {...rest} />
      </DialogContent>
    </Dialog>
  );
}

interface PendingUpload {
  key: string;
  name: string;
  status: 'uploading' | 'failed';
  error: string | null;
}

interface Notice {
  name: string;
  reason: string;
}

function ProofPhotoBody({
  onClose,
  existingCount,
  max,
  stamp,
  onAdd,
}: Omit<ProofPhotoDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [shots, setShots] = useState<ProofPhotoRef[]>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraBlocked, setCameraBlocked] = useState(isCameraBlocked);
  const shotsRef = useRef<ProofPhotoRef[]>([]);
  // Foto yang sudah ada atau sedang naik (sinkron): jepretan beruntun tak boleh melewati batas sebelum render ulang.
  const reservedRef = useRef(0);
  const aliveRef = useRef(true);
  const committedRef = useRef(false);
  const counterRef = useRef(0);
  const browseRef = useRef<HTMLInputElement>(null);
  const canCamera = cameraSupported() && !cameraBlocked;

  // Pembersihan: foto yang belum dikonfirmasi dibuang. Penanda hidup dinyalakan di efek agar StrictMode (pasang ulang)
  // tidak meninggalkannya mati; unggahan yang selesai sesudah ini membuang fotonya sendiri.
  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (!committedRef.current && shotsRef.current.length > 0) {
        void discardProofPhotos(shotsRef.current.map((photo) => photo.id));
      }
    };
  }, []);

  const uploading = pending.filter((entry) => entry.status === 'uploading').length;
  const total = existingCount + shots.length;
  const remaining = Math.max(0, max - total - uploading);

  const upload = useCallback(async (file: File, reportInList: boolean): Promise<void> => {
    reservedRef.current += 1;
    counterRef.current += 1;
    const key = `u${counterRef.current}`;
    setPending((current) => [
      ...current,
      { key, name: file.name, status: 'uploading', error: null },
    ]);
    try {
      const photo = toProofRef(await proofSource.upload(file, file.name));
      if (!aliveRef.current) {
        // Dialog sudah ditutup: foto ini tak punya pemilik, buang.
        void discardProofPhotos([photo.id]);
        return;
      }
      shotsRef.current = [...shotsRef.current, photo];
      setShots(shotsRef.current);
      setPending((current) => current.filter((entry) => entry.key !== key));
    } catch (error) {
      reservedRef.current -= 1;
      const message = errorText(error, 'Gagal mengunggah');
      if (aliveRef.current) {
        setPending((current) =>
          reportInList
            ? current.map((entry) =>
                entry.key === key ? { ...entry, status: 'failed', error: message } : entry,
              )
            : current.filter((entry) => entry.key !== key),
        );
      }
      throw new Error(message);
    }
  }, []);

  const addFiles = useCallback(
    (files: File[], refused: Notice[] = []) => {
      const notes = [...refused];
      for (const file of files) {
        const reason = checkFile(file, { accept: IMAGE_MIME_TYPES, maxBytes: MAX_IMAGE_BYTES });
        if (reason !== null) {
          notes.push({ name: file.name, reason });
        } else if (max - existingCount - reservedRef.current <= 0) {
          notes.push({ name: file.name, reason: `Batas ${max} foto per entri tercapai` });
        } else {
          upload(file, true).catch(() => undefined);
        }
      }
      if (notes.length > 0) setNotices((current) => [...current, ...notes]);
    },
    [existingCount, max, upload],
  );

  /** Jepretan kamera: menolak (dengan pesan) bila batas tercapai atau unggah gagal; pesan tampil di kamera. */
  const shoot = useCallback(
    async (file: File): Promise<void> => {
      if (max - existingCount - reservedRef.current <= 0) {
        throw new Error(`Batas ${max} foto per entri tercapai`);
      }
      await upload(file, false);
    },
    [existingCount, max, upload],
  );

  function removeShot(photo: ProofPhotoRef) {
    void discardProofPhotos([photo.id]);
    shotsRef.current = shotsRef.current.filter((item) => item.id !== photo.id);
    reservedRef.current -= 1;
    setShots(shotsRef.current);
  }

  function confirm() {
    if (shotsRef.current.length === 0 || uploading > 0) return;
    committedRef.current = true;
    onAdd(shotsRef.current);
    onClose();
  }

  const full = remaining <= 0;
  const addLabel = shots.length > 0 ? `Tambahkan (${shots.length})` : 'Tambahkan';

  return (
    <>
      <DialogHeader>
        <DialogTitle>Foto bukti</DialogTitle>
        <DialogDescription>
          Dipakai untuk berjaga-jaga bila ada komplain. Foto otomatis diberi cap saat disimpan dan
          tidak bisa diubah setelahnya.
        </DialogDescription>
      </DialogHeader>

      <FileDropZone
        accept={IMAGE_MIME_TYPES}
        disabled={full}
        className="flex flex-col gap-3"
        onFiles={(files, refused) => addFiles(files, refused)}
      >
        <div className="flex flex-wrap gap-2">
          {canCamera ? (
            <Button
              type="button"
              variant="outline"
              disabled={full}
              onClick={() => setCameraOpen(true)}
            >
              <Camera aria-hidden />
              Kamera
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={full}
            onClick={() => browseRef.current?.click()}
          >
            <ImagePlus aria-hidden />
            Telusuri
          </Button>
        </div>
        <input
          ref={browseRef}
          type="file"
          multiple
          hidden
          accept={IMAGE_MIME_TYPES.join(',')}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            // Pilihan yang sama dapat dipilih lagi.
            event.target.value = '';
            if (files.length > 0) {
              const split = partitionByType(files, IMAGE_MIME_TYPES);
              addFiles(split.files, split.rejected);
            }
          }}
        />
        <p className="text-xs text-muted-foreground">
          {total + uploading} dari {max} foto (maks. {formatBytes(MAX_IMAGE_BYTES)} per foto).
          {full ? ' Batas tercapai.' : ''}
        </p>
      </FileDropZone>

      {notices.length > 0 ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-destructive">
              {notices.length} berkas tidak dapat ditambahkan
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Tutup daftar berkas ditolak"
              onClick={() => setNotices([])}
            >
              <X />
            </Button>
          </div>
          <ul aria-label="Berkas ditolak" className="mt-1 space-y-0.5">
            {notices.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: nama berkas boleh kembar
              <li key={`${item.name}-${index}`} className="break-words">
                <span className="font-medium">{item.name}</span>
                <span className="text-muted-foreground"> — {item.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <ul aria-label="Antrean unggah" className="space-y-1">
          {pending.map((entry) => (
            <li
              key={entry.key}
              className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate" title={entry.name}>
                  {entry.name}
                </span>
                {entry.status === 'failed' && entry.error ? (
                  <span className="text-xs text-destructive">{entry.error}</span>
                ) : null}
              </div>
              {entry.status === 'uploading' ? (
                <Spinner />
              ) : (
                <>
                  <CircleAlert aria-hidden className="size-4 text-destructive" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Singkirkan ${entry.name}`}
                    onClick={() =>
                      setPending((current) => current.filter((item) => item.key !== entry.key))
                    }
                  >
                    <X />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <ProofPhotoGrid photos={shots} onRemove={removeShot} label="baru" />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button type="button" disabled={shots.length === 0 || uploading > 0} onClick={confirm}>
          {addLabel}
        </Button>
      </DialogFooter>

      {canCamera || cameraOpen ? (
        <ProofCameraDialog
          open={cameraOpen}
          onOpenChange={setCameraOpen}
          remaining={remaining}
          stamp={stamp}
          shots={shots}
          uploading={uploading}
          onRemoveShot={removeShot}
          onShot={shoot}
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
