import {
  type BackgroundUploads,
  useBackgroundUploads,
} from '@/components/file-dialog/use-background-uploads';
import { type ProofPhotoRef, proofSource, toProofRef } from './proof-source';

export interface ProofUploadsOptions {
  /**
   * Dipanggil saat satu foto selesai diunggah. Mengembalikan `false` bila pemiliknya sudah tidak ada atau penuh:
   * foto itu lalu dibuang di server (`proofSource.onDiscard`). Selain itu pemanggil sudah memegang fotonya.
   */
  onAdd(owner: string, photo: ProofPhotoRef): boolean;
}

/**
 * Unggah latar foto bukti QC: membungkus `useBackgroundUploads` dengan `proofSource`. Pemilik entri = kunci pemegang
 * foto (mis. `clientId` baris Catat Serial); hook dipasang di komponen yang memegang nilainya, bukan di sel/baris.
 */
export function useProofUploads(options: ProofUploadsOptions): BackgroundUploads {
  return useBackgroundUploads({
    source: proofSource,
    onUploaded: (owner, item) => options.onAdd(owner, toProofRef(item)),
  });
}
