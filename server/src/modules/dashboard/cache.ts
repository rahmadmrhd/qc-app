/**
 * Cache memori berumur pendek. Jam disuntik (`now`) agar tes dapat mengendalikannya; `maxEntries` membatasi memori
 * (entri paling lama dibuang lebih dulu, setelah entri kedaluwarsa disapu).
 */
export interface TtlCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  size(): number;
}

export function createTtlCache<T>(ttlMs: number, now: () => number, maxEntries = 500): TtlCache<T> {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      const current = now();
      entries.delete(key);
      if (entries.size >= maxEntries) {
        for (const [oldKey, entry] of entries) {
          if (entry.expiresAt <= current) entries.delete(oldKey);
        }
      }
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
      entries.set(key, { value, expiresAt: current + ttlMs });
    },
    size() {
      return entries.size;
    },
  };
}
