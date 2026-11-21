import { IMAGE_MIME_TYPES } from '@shared/files';
import { runBusy } from '@/app/pwa/busy';
import type { FileSource, LibraryItem } from '@/components/file-dialog/types';
import { api } from '@/lib/api';
import { prepareImage } from './image';
import { throwIfAborted, uploadCallOptions } from './upload-context';

/**
 * Sumber unggah gambar umum (`files.upload`): dikecilkan di klien (`maxSide`), lalu diunggah. Hasilnya tidak membawa
 * URL gambar (`thumbUrl`/`previewUrl` kosong): tampilannya dimuat lewat `useFileUrl(id)`.
 */
export function createImageFileSource(opts: { key: string; maxSide?: number }): FileSource {
  return {
    key: opts.key,
    mimeTypes: IMAGE_MIME_TYPES,
    upload(file, name, ctx) {
      // Siapkan + kirim = satu penulisan berjalan (muat ulang otomatis PWA tak boleh memotongnya).
      return runBusy(async () => {
        throwIfAborted(ctx?.signal);
        ctx?.onProgress?.('preparing', null);
        const image = await prepareImage(file, opts.maxSide);
        throwIfAborted(ctx?.signal);
        ctx?.onProgress?.('uploading', 0);
        const dto = await api(
          'files.upload',
          { mime: image.mime, bytes: image.bytes, width: image.width, height: image.height },
          uploadCallOptions(ctx),
        );
        const item: LibraryItem = {
          id: dto.id,
          name,
          size: dto.size,
          width: dto.width,
          height: dto.height,
          uploadedBy: '',
          createdAt: '',
          usageCount: 0,
          canRename: false,
          canRemove: false,
          thumbUrl: '',
          previewUrl: '',
        };
        return item;
      });
    },
  };
}

/** Galeri item (sisi terpanjang bawaan `prepareImage`). */
export const itemFileSource: FileSource = createImageFileSource({ key: 'item-files' });
/** Logo QR: dikecilkan lebih kecil (512 px). */
export const logoFileSource: FileSource = createImageFileSource({
  key: 'logo-files',
  maxSide: 512,
});
