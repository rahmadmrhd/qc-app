import { IMAGE_MIME_TYPES } from '@shared/files';
import { runBusy } from '@/app/pwa/busy';
import type { FileSource, LibraryItem } from '@/components/file-dialog/types';
import { api } from '@/lib/api';
import { API_BASE } from '@/lib/api/client';
import { prepareImage } from '@/modules/files/image';
import { throwIfAborted, uploadCallOptions } from '@/modules/files/upload-context';
import { proofKeys } from '../keys';
import { discardProofPhotos } from '../queries';

/** Foto bukti `draft` yang sudah terunggah dan menempel pada satu baris/dialog (bukan gambarnya, hanya rujukan). */
export interface ProofPhotoRef {
  id: string;
  mime: string;
  size: number;
  thumbUrl: string;
}

/**
 * Pratinjau dimuat langsung lewat `<img src>` (sesi lewat cookie same-origin). Rute `serialProofs.get` selalu
 * divalidasi ulang (isi pada id yang sama berubah dari foto asli menjadi hasil bercap).
 */
export const proofThumbUrl = (id: string): string =>
  `${API_BASE}/serial-proofs/${encodeURIComponent(id)}`;

/** `LibraryItem` hasil unggah membawa `mime` tambahan agar dapat dipetakan ke `ProofPhotoRef`. */
interface ProofLibraryItem extends LibraryItem {
  mime: string;
}

export function toProofRef(item: LibraryItem): ProofPhotoRef {
  return {
    id: item.id,
    mime: (item as Partial<ProofLibraryItem>).mime ?? 'image/webp',
    size: item.size,
    thumbUrl: item.thumbUrl,
  };
}

/**
 * Sumber unggah foto bukti QC: HANYA unggah (foto bukti tidak boleh tampil di pustaka mana pun). Hasil yang tak jadi
 * dipakai dibuang di server lewat `onDiscard`.
 */
export const proofSource: FileSource = {
  key: proofKeys.upload[0],
  mimeTypes: IMAGE_MIME_TYPES,
  onDiscard: (items) => discardProofPhotos(items.map((item) => item.id)),
  upload(file, _name, ctx) {
    // Siapkan + kirim = satu penulisan berjalan (muat ulang otomatis PWA tak boleh memotongnya).
    return runBusy(async () => {
      throwIfAborted(ctx?.signal);
      ctx?.onProgress?.('preparing', null);
      const image = await prepareImage(file);
      throwIfAborted(ctx?.signal);
      ctx?.onProgress?.('uploading', 0);
      const dto = await api(
        'serialProofs.upload',
        { mime: image.mime, bytes: image.bytes, width: image.width, height: image.height },
        uploadCallOptions(ctx),
      );
      const item: ProofLibraryItem = {
        id: dto.id,
        name: dto.filename,
        size: dto.size,
        width: dto.width,
        height: dto.height,
        uploadedBy: '',
        createdAt: '',
        usageCount: 0,
        canRename: false,
        canRemove: false,
        thumbUrl: proofThumbUrl(dto.id),
        previewUrl: proofThumbUrl(dto.id),
        mime: dto.mime,
      };
      return item;
    });
  },
};
