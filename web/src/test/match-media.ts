type Listener = () => void;

/**
 * Memalsukan `window.matchMedia` (jsdom tidak punya): `matches` mengikuti `desktop` untuk query lebar, dan `set` mengubahnya
 * serta memberi tahu pendengar. Panggil `restore()` di `afterEach`.
 */
export function mockMatchMedia(initialDesktop: boolean) {
  const listeners = new Set<Listener>();
  const media = {
    matches: initialDesktop,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  };
  Object.defineProperty(window, 'matchMedia', { value: () => media, configurable: true });
  return {
    set(desktop: boolean) {
      media.matches = desktop;
      for (const listener of listeners) listener();
    },
    restore() {
      Reflect.deleteProperty(window, 'matchMedia');
    },
  };
}
