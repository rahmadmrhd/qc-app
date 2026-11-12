// Registri penulisan yang sedang berjalan (bukan formulir kotor): memuat ulang halaman saat ini akan memotongnya
// (mis. centang checklist yang masih antre, atau permintaan tulis yang belum dijawab server). Dipakai
// `isSafeToReload` (muat ulang otomatis hanya bila aman). Tiap pemanggil memegang tokennya sendiri.
const tokens = new Set<symbol>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Menandai "ada penulisan berjalan"; mengembalikan fungsi penutup (aman dipanggil berulang). */
export function beginBusy(): () => void {
  const token = Symbol('busy');
  tokens.add(token);
  emit();
  return () => {
    if (tokens.delete(token)) emit();
  };
}

export function isBusy(): boolean {
  return tokens.size > 0;
}

export function subscribeBusy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetBusyForTests(): void {
  tokens.clear();
  emit();
}
