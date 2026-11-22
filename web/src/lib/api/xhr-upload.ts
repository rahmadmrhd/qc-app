import { ApiError } from './api-error';

/**
 * Hasil uji Electron 2026-11-20 (spek dialog unggah seragam 5.3): di protokol kustom `app://` desktop, XHR
 * `upload.onprogress` TIDAK terpicu (unggahan tetap sampai utuh). Maka desktop memakai `fetch` (bar tak-tentu);
 * XHR dengan progres hanya di peramban. Ubah ke `true` hanya setelah uji ulang membuktikan event terisi.
 */
export const XHR_PROGRESS_ON_DESKTOP = false;

export interface XhrInit {
  method: string;
  headers: Record<string, string>;
  body: Blob | string | FormData | undefined;
  signal?: AbortSignal;
  onUploadProgress?(loaded: number, total: number): void;
}

export interface XhrResult {
  status: number;
  headers: Headers;
  text: string;
}

function parseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    try {
      headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    } catch {
      // Header tak sah diabaikan.
    }
  }
  return headers;
}

function unavailable(cause?: unknown): ApiError {
  return new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-', undefined, { cause });
}

/**
 * Mengirim permintaan lewat `XMLHttpRequest` agar byte terkirim dapat dilaporkan (`fetch` tak punya progres unggah).
 * Galat jaringan, timeout, dan pembatalan dipetakan ke `UNAVAILABLE` seperti jalur `fetch`; status non-2xx
 * dikembalikan apa adanya untuk dipetakan pemanggil. Persen dapat mencapai 100% sebelum server selesai menjawab.
 */
export function xhrSend(url: string, init: XhrInit): Promise<XhrResult> {
  return new Promise<XhrResult>((resolve, reject) => {
    const { signal } = init;
    if (signal?.aborted) {
      reject(unavailable(signal.reason));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    xhr.open(init.method, url);
    xhr.responseType = 'text';
    for (const [name, value] of Object.entries(init.headers)) xhr.setRequestHeader(name, value);
    const report = init.onUploadProgress;
    if (report) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) report(event.loaded, event.total);
      };
    }
    xhr.onload = () => {
      cleanup();
      resolve({
        status: xhr.status,
        headers: parseHeaders(xhr.getAllResponseHeaders()),
        text: xhr.responseText,
      });
    };
    const fail = () => {
      cleanup();
      reject(unavailable());
    };
    xhr.onerror = fail;
    xhr.ontimeout = fail;
    xhr.onabort = fail;
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(init.body ?? null);
  });
}
