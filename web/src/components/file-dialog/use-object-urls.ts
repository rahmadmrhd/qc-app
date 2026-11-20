import { useEffect, useRef, useState } from 'react';
import type { QueuedFile } from './types';

/**
 * URL objek (Blob) untuk thumbnail berkas gambar yang menunggu diunggah, dibuat saat berkas masuk dan dilepas saat
 * berkas keluar atau komponen dilepas. Peta kosong bila peramban tak mendukung `URL.createObjectURL`.
 */
export function useObjectUrls(files: readonly QueuedFile[]): ReadonlyMap<string, string> {
  const cache = useRef(new Map<string, string>());
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
    const next = new Map<string, string>();
    for (const queued of files) {
      if (!queued.file.type.startsWith('image/')) continue;
      next.set(queued.key, cache.current.get(queued.key) ?? URL.createObjectURL(queued.file));
    }
    for (const [key, url] of cache.current) if (!next.has(key)) URL.revokeObjectURL(url);
    cache.current = next;
    setUrls(next);
  }, [files]);
  // Dilepas (juga siklus pasang-lepas StrictMode): semua URL dilepas; efek di atas membuatnya lagi bila perlu.
  useEffect(
    () => () => {
      if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
      for (const url of cache.current.values()) URL.revokeObjectURL(url);
      cache.current = new Map();
    },
    [],
  );
  return urls;
}
