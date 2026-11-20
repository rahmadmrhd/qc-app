import { useMemo, useRef } from 'react';
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

/** Penerima foto selesai milik satu dialog yang belum (atau tidak) menjadi baris; `false` = penuh, hasil dibuang. */
export type ProofSink = (photo: ProofPhotoRef) => boolean;

/**
 * Dialog yang memegang foto sebelum diterapkan (dialog scan wajib foto, Ubah baris) memakai pemilik sendiri:
 * unggahannya dikerjakan hook halaman, hasilnya dibelokkan ke penerima yang dipasang dialog lewat `attach`.
 * `deliver` mengembalikan `undefined` bila pemilik itu tak punya penerima.
 */
export interface ProofSinks {
  attach(owner: string, sink: ProofSink): () => void;
  deliver(owner: string, photo: ProofPhotoRef): boolean | undefined;
}

export function useProofSinks(): ProofSinks {
  const sinks = useRef(new Map<string, ProofSink>());
  return useMemo<ProofSinks>(
    () => ({
      attach(owner, sink) {
        sinks.current.set(owner, sink);
        return () => {
          if (sinks.current.get(owner) === sink) sinks.current.delete(owner);
        };
      },
      deliver: (owner, photo) => sinks.current.get(owner)?.(photo),
    }),
    [],
  );
}

/** Yang dibutuhkan dialog pemegang foto dari halaman: antrean unggah bersama + pemasangan penerima. */
export interface ProofSession {
  uploads: BackgroundUploads;
  attach: ProofSinks['attach'];
}
