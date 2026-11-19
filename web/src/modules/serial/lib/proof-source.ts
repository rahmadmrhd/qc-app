import { IMAGE_MIME_TYPES } from '@shared/files';
import { runBusy } from '@/app/pwa/busy';
import type { FileLibrarySource, LibraryItem } from '@/components/file-dialog/types';
import { api } from '@/lib/api';
import { API_BASE } from '@/lib/api/client';
import { prepareImage } from '@/modules/files/image';
import { proofKeys } from '../keys';

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
 * Menggabungkan hasil unggah ke nilai field dan memotong di batas `max`; foto yang terpotong (sudah naik ke server tetapi
 * tak muat) dikembalikan di `extras` agar dibuang, bukan menunggu sapuan draft.
 */
export function mergeProofSelection(
  value: readonly ProofPhotoRef[],
  items: readonly LibraryItem[],
  max: number,
): { next: ProofPhotoRef[]; extras: string[] } {
  return mergeProofPhotos(value, items.map(toProofRef), max);
}

/** Seperti `mergeProofSelection` untuk foto yang sudah berbentuk `ProofPhotoRef` (dialog Foto bukti). */
export function mergeProofPhotos(
  value: readonly ProofPhotoRef[],
  photos: readonly ProofPhotoRef[],
  max: number,
): { next: ProofPhotoRef[]; extras: string[] } {
  const merged = [...value, ...photos];
  return { next: merged.slice(0, max), extras: merged.slice(max).map((photo) => photo.id) };
}

const unused = () => Promise.reject(new Error('Foto bukti tidak memakai pustaka'));

/**
 * Sumber `FileDialog` untuk foto bukti QC: HANYA unggah. Dialognya dipakai dengan `showLibrary={false}`, jadi `list`,
 * `rename`, dan `remove` tidak pernah dipanggil (foto bukti tidak boleh tampil di pustaka mana pun).
 */
export const proofSource: FileLibrarySource = {
  key: proofKeys.upload[0],
  mimeTypes: IMAGE_MIME_TYPES,
  list: unused,
  rename: unused,
  remove: unused,
  upload(file) {
    // Siapkan + kirim = satu penulisan berjalan (muat ulang otomatis PWA tak boleh memotongnya).
    return runBusy(async () => {
      const image = await prepareImage(file);
      const dto = await api('serialProofs.upload', {
        mime: image.mime,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
      });
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
