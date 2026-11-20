import { type ReactNode, useMemo } from 'react';
import type { ProofPhotoRef } from './lib/proof-source';
import { type ProofSession, useProofSinks, useProofUploads } from './lib/use-proof-uploads';

/**
 * Bahan tes: meniru cara halaman Catat Serial menyediakan antrean unggah foto bukti bagi dialog yang memegang foto
 * sebelum diterapkan (pemilik tanpa baris: foto selesai dibelokkan ke penerima yang dipasang dialog).
 * Hanya dipakai berkas `*.test.tsx`.
 */
export function ProofSessionHost({
  children,
  onRow,
}: {
  children: (session: ProofSession) => ReactNode;
  /** Pemilik tanpa penerima (baris sungguhan di halaman): terima foto atau tolak (`false` = dibuang). */
  onRow?: (owner: string, photo: ProofPhotoRef) => boolean;
}) {
  const sinks = useProofSinks();
  const uploads = useProofUploads({
    onAdd: (owner, photo) => sinks.deliver(owner, photo) ?? onRow?.(owner, photo) ?? false,
  });
  const session = useMemo<ProofSession>(
    () => ({ uploads, attach: sinks.attach }),
    [uploads, sinks],
  );
  return <>{children(session)}</>;
}
