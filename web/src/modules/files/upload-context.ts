import type { UploadContext } from '@/components/file-dialog/types';
import type { ApiCallOptions } from '@/lib/api/client';

/** Galat pembatalan unggahan (bukan galat jaringan): pemanggil yang membatalkan sudah tahu alasannya. */
export function abortError(): Error {
  return new DOMException('Unggahan dibatalkan', 'AbortError');
}

/** Melempar bila unggahan sudah dibatalkan, agar tidak ada panggilan API baru sesudahnya. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/**
 * Opsi panggilan `api()` dari konteks unggahan: persen byte terkirim sebagai tahap `uploading`; saat byte penuh
 * tahap berganti `processing` (server masih memproses). Tanpa persen (desktop memakai fetch) tahap tetap `uploading`.
 */
export function uploadCallOptions(ctx?: UploadContext): ApiCallOptions {
  const options: ApiCallOptions = {};
  if (ctx?.signal) options.signal = ctx.signal;
  const report = ctx?.onProgress;
  if (report) {
    options.onUploadProgress = (loaded, total) => {
      report('uploading', total > 0 ? Math.min(1, loaded / total) : null);
      if (total > 0 && loaded >= total) report('processing', null);
    };
  }
  return options;
}
