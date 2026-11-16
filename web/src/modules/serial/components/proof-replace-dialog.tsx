import type { SerialProofPhotoDto } from '@shared/contract';
import { MAX_IMAGE_BYTES } from '@shared/files';
import { toast } from 'sonner';
import { FileDialog } from '@/components/file-dialog';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { isMobileDevice } from '../lib/device';
import { proofSource } from '../lib/proof-source';
import { discardProofPhotos, useReplaceProof } from '../queries';

/** Galat yang pasti berarti "pengganti tidak terpasang": unggahan drafnya tak berguna dan dibuang di server. */
const DISCARD_CODES: ReadonlySet<string> = new Set(['VALIDATION', 'CONFLICT', 'NOT_FOUND']);

export interface ProofReplaceDialogProps {
  /** Foto `failed` yang diganti. */
  photo: SerialProofPhotoDto;
  open: boolean;
  onOpenChange(open: boolean): void;
}

/**
 * Dialog "Unggah ulang" foto bukti yang gagal: dialog foto bukti yang sama dengan form Tambah/Cek ulang (tab Unggah +
 * Kamera, tanpa Pustaka), tetapi SATU foto. Foto terunggah sebagai draft lewat `serialProofs.upload`, lalu
 * `serialProofs.replace` menggantikan foto gagal itu (pengganti masuk antrean cap). Dialog menutup begitu foto
 * diteruskan; kegagalan penggantian tampil sebagai toast dan draf yang tak terpakai dibuang.
 */
export function ProofReplaceDialog({ photo, open, onOpenChange }: ProofReplaceDialogProps) {
  const replace = useReplaceProof();

  async function run(newPhotoId: string) {
    try {
      await replace.mutateAsync({ photoId: photo.id, newPhotoId });
      toast.success('Foto pengganti diterima, sedang diberi cap.');
    } catch (error) {
      if (error instanceof ApiError && DISCARD_CODES.has(error.code)) {
        void discardProofPhotos([newPhotoId]);
      }
      toast.error(describeError(error));
    }
  }

  return (
    <FileDialog
      open={open}
      onOpenChange={onOpenChange}
      source={proofSource}
      mode="single"
      accept={['image']}
      maxBytes={MAX_IMAGE_BYTES}
      showLibrary={false}
      title="Unggah ulang foto bukti QC"
      confirmLabel="Ganti foto"
      hideNames
      // Perangkat sentuh: tombol membuka aplikasi kamera bawaan; desktop hanya Telusuri.
      capture={isMobileDevice() ? 'environment' : undefined}
      onDiscardUploaded={(items) => void discardProofPhotos(items.map((item) => item.id))}
      onSelect={(items) => {
        const [first, ...extras] = items;
        if (extras.length > 0) void discardProofPhotos(extras.map((item) => item.id));
        if (first) void run(first.id);
      }}
    />
  );
}
