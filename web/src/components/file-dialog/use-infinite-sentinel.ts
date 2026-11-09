import { useEffect, useRef, useState } from 'react';

export interface InfiniteSentinelOptions {
  /** Hanya mengamati bila ada halaman berikutnya dan tidak sedang memuat. */
  enabled: boolean;
  onVisible(): void;
  /** Berubah tiap halaman baru masuk: pengamat dibuat ulang agar sentinel yang masih terlihat memicu lagi. */
  resetKey?: unknown;
  rootMargin?: string;
}

/**
 * Memanggil `onVisible` saat elemen sentinel terlihat (IntersectionObserver). `supported` false bila API tidak ada
 * (mis. jsdom, peramban lama): pemanggil harus menyediakan tombol cadangan.
 */
export function useInfiniteSentinel({
  enabled,
  onVisible,
  resetKey,
  rootMargin = '400px',
}: InfiniteSentinelOptions): { ref: (node: Element | null) => void; supported: boolean } {
  const [node, setNode] = useState<Element | null>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;
  const supported = typeof IntersectionObserver !== 'undefined';

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey sengaja memicu pengamat baru
  useEffect(() => {
    if (!supported || !enabled || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callback.current();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [supported, enabled, node, resetKey, rootMargin]);

  return { ref: setNode, supported };
}
