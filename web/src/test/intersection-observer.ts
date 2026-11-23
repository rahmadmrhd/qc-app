import { act } from '@testing-library/react';

type Entry = {
  callback: IntersectionObserverCallback;
  target: Element;
  observer: IntersectionObserver;
};

/**
 * Pengganti `IntersectionObserver` yang dikendalikan tes: `setIntersecting(target, bool)` memicu callback tiap
 * pengamat yang sedang mengamati elemen itu. Pasang lewat `installIntersectionObserver()`; kembalikan `restore`.
 */
export function installIntersectionObserver() {
  const original = globalThis.IntersectionObserver;
  const entries = new Set<Entry>();
  class FakeObserver {
    private readonly targets = new Set<Element>();
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.targets.add(target);
      entries.add({
        callback: this.callback,
        target,
        observer: this as unknown as IntersectionObserver,
      });
    }
    unobserve(target: Element) {
      this.targets.delete(target);
      for (const entry of entries) {
        if (entry.observer === (this as unknown) && entry.target === target) entries.delete(entry);
      }
    }
    disconnect() {
      for (const entry of [...entries]) {
        if (entry.observer === (this as unknown)) entries.delete(entry);
      }
      this.targets.clear();
    }
    takeRecords() {
      return [];
    }
  }
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  return {
    setIntersecting(target: Element, isIntersecting: boolean) {
      act(() => {
        for (const entry of [...entries]) {
          if (entry.target !== target) continue;
          entry.callback([{ isIntersecting, target } as IntersectionObserverEntry], entry.observer);
        }
      });
    },
    observed: () => [...entries].map((entry) => entry.target),
    restore() {
      globalThis.IntersectionObserver = original;
    },
  };
}
