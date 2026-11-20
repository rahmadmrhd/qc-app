import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { QueuedFile } from '@/components/file-dialog';
import type { UploadEntry } from '@/components/file-dialog/use-background-uploads';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { discardProofPhotos, useReplaceProof } from '../queries';
import { useProofUploads } from './use-proof-uploads';

/** Galat yang pasti berarti "pengganti tidak terpasang": unggahan drafnya tak berguna dan dibuang di server. */
const DISCARD_CODES: ReadonlySet<string> = new Set(['VALIDATION', 'CONFLICT', 'NOT_FOUND']);

export interface ProofReplaceState {
  /** Unggahan pengganti yang masih berjalan atau gagal untuk foto ini (maks. satu). */
  entry: UploadEntry | null;
  /** Pesan galat terakhir penggantian (setelah unggahan sukses tetapi `replace` ditolak). */
  error: string | null;
}

export interface ProofReplace {
  /** Mengunggah satu foto pengganti untuk foto gagal `photoId`, lalu `serialProofs.replace` bila unggahan selesai. */
  start(photoId: string, files: readonly QueuedFile[]): void;
  /** Membatalkan/membuang unggahan pengganti foto ini (tidak memanggil `replace`). */
  cancel(photoId: string): void;
  stateOf(photoId: string): ProofReplaceState;
}

/**
 * Unggah ulang foto bukti QC yang gagal. Dipasang di komponen yang membuka dialog (galeri foto atau banner masalah):
 * unggahan dikerjakan hook latar (progres tampil di kartu foto gagal), dan hanya bila unggahan selesai
 * `serialProofs.replace` dipanggil. Foto gagal lama tetap tampil sampai penggantian berhasil; gagal = kartu kembali ke
 * keadaan gagal dengan pesan dan "Unggah ulang" tersedia lagi. Berpindah halaman (komponen dilepas) saat unggahan
 * berjalan membatalkannya tanpa memanggil `replace`.
 */
export function useProofReplace(): ProofReplace {
  const replace = useReplaceProof();
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const { mutateAsync } = replace;

  const setError = useCallback((photoId: string, message: string | null) => {
    setErrors((current) => {
      if (message === null) {
        if (!(photoId in current)) return current;
        const { [photoId]: _gone, ...rest } = current;
        return rest;
      }
      return { ...current, [photoId]: message };
    });
  }, []);

  const uploads = useProofUploads({
    // Pemilik = id foto gagal; hasil unggahan langsung dipakai untuk `replace` (selalu diklaim).
    onAdd: (photoId, photo) => {
      void (async () => {
        try {
          await mutateAsync({ photoId, newPhotoId: photo.id });
          toast.success('Foto pengganti diterima, sedang diberi cap.');
        } catch (error) {
          if (error instanceof ApiError && DISCARD_CODES.has(error.code)) {
            void discardProofPhotos([photo.id]);
          }
          const message = describeError(error);
          setError(photoId, message);
          toast.error(message);
        }
      })();
      return true;
    },
  });
  const { cancelOwner, forOwner, entries } = uploads;

  const start = useCallback(
    (photoId: string, files: readonly QueuedFile[]) => {
      const first = files[0];
      if (!first) return;
      // Percobaan baru menggantikan entri gagal sebelumnya dan menghapus pesan lama.
      cancelOwner(photoId);
      setError(photoId, null);
      forOwner(photoId).add([first]);
    },
    [cancelOwner, forOwner, setError],
  );

  const cancel = useCallback(
    (photoId: string) => {
      cancelOwner(photoId);
      setError(photoId, null);
    },
    [cancelOwner, setError],
  );

  const stateOf = useCallback(
    (photoId: string): ProofReplaceState => ({
      entry: entries.find((entry) => entry.owner === photoId) ?? null,
      error: errors[photoId] ?? null,
    }),
    [entries, errors],
  );

  return { start, cancel, stateOf };
}
