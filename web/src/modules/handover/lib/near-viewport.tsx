import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * Akar gulir untuk pengamat persimpangan: kolom kanban (daftar kartu bergulir sendiri) atau `null` = viewport
 * (daftar ponsel). Tanpa akar yang benar, `rootMargin` tidak berlaku di dalam kontainer yang bergulir.
 */
const ScrollRootContext = createContext<Element | null>(null);

export function ScrollRootProvider({
  root,
  children,
}: {
  root: Element | null;
  children: ReactNode;
}) {
  return <ScrollRootContext.Provider value={root}>{children}</ScrollRootContext.Provider>;
}

/** `IntersectionObserver` tidak ada (mis. jsdom): pemanggil jatuh ke perilaku tanpa lazy/otomatis. */
export function hasIntersectionObserver(): boolean {
  return typeof IntersectionObserver === 'function';
}

/**
 * Benar begitu elemen (ref callback yang dikembalikan) mendekati viewport/akar gulir dalam `rootMargin`; tetap
 * benar sesudahnya (isi yang sudah dirender tidak dibuang agar tinggi tidak melompat). Tanpa pengamat
 * persimpangan langsung benar.
 */
export function useNearViewport(rootMargin = '400px'): [(node: Element | null) => void, boolean] {
  const root = useContext(ScrollRootContext);
  const [node, setNode] = useState<Element | null>(null);
  const [near, setNear] = useState(!hasIntersectionObserver());
  const ref = useCallback((element: Element | null) => setNode(element), []);
  useEffect(() => {
    if (near || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { root, rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, node, root, rootMargin]);
  return [ref, near];
}

/**
 * Memanggil `onNear` setiap kali sentinel terlihat dalam `rootMargin`, dan diulang bila `signal` berubah
 * (mis. jumlah item termuat): kolom yang belum penuh layar terisi sendiri tanpa menunggu gulir.
 */
export function useOnNear(
  active: boolean,
  signal: unknown,
  onNear: () => void,
  rootMargin = '300px',
): (node: Element | null) => void {
  const root = useContext(ScrollRootContext);
  const [node, setNode] = useState<Element | null>(null);
  const ref = useCallback((element: Element | null) => setNode(element), []);
  const latest = useRef(onNear);
  latest.current = onNear;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `signal` memicu pengamatan ulang (callback awal)
  useEffect(() => {
    if (!active || !node || !hasIntersectionObserver()) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      { root, rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, node, root, rootMargin, signal]);
  return ref;
}
