import { POSTEL_FILE_MIME_TYPES } from '@shared/files';
import { runBusy } from '@/app/pwa/busy';
import { fileMime } from '@/components/file-dialog/accept';
import type { FileSource, LibraryItem } from '@/components/file-dialog/types';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/api-error';
import { throwIfAborted, uploadCallOptions } from '@/modules/files/upload-context';
import { postelUploadError } from './upload';

/**
 * Sumber unggah lampiran Postel (gambar atau PDF) apa adanya: TANPA pengecilan (desain stiker perlu resolusi asli).
 * Jenis, ukuran, dan isi divalidasi server berdasarkan tanda tangan byte.
 */
export const postelSource: FileSource = {
  key: 'postel-files',
  mimeTypes: POSTEL_FILE_MIME_TYPES,
  upload(file, _name, ctx) {
    // Membaca berkas + mengirim = satu penulisan berjalan (muat ulang otomatis PWA tak boleh memotongnya).
    return runBusy(async () => {
      throwIfAborted(ctx?.signal);
      const bytes = new Uint8Array(await file.arrayBuffer());
      throwIfAborted(ctx?.signal);
      ctx?.onProgress?.('uploading', 0);
      const dto = await api(
        'postelFiles.upload',
        { mime: fileMime(file), bytes },
        uploadCallOptions(ctx),
      ).catch((failure: unknown) => {
        // Pesan field `bytes`/`mime` dari server (mis. dimensi gambar tak terbaca) ditampilkan apa adanya.
        if (failure instanceof ApiError) throw new Error(postelUploadError(failure));
        throw failure;
      });
      const item: LibraryItem = {
        id: dto.id,
        // Nama hasil server (`lampiran-<id>.<ekstensi>`): satu-satunya nama yang dipakai lampiran Postel (tanpa pengubah nama).
        name: dto.filename,
        size: dto.size,
        width: 0,
        height: 0,
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
