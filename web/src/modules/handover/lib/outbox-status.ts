/**
 * Butir checklist (task + indeks) yang permintaan `handovers.setCheck`-nya sedang berjalan di tab ini. Hanya dalam
 * memori (tidak disimpan): dipakai untuk penanda "Mengirim…" dan chip penghitung. Diisi oleh penguras antrean DAN
 * centang langsung di `useCheckQueue`; dua permintaan bertumpuk pada butir yang sama dihitung, jadi butir tetap
 * "mengirim" sampai keduanya selesai.
 */
export type ItemSendState = 'waiting' | 'sending';

const counts = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;
/** Naik tiap `clearSending`: penutup `beginSending` dari generasi lama menjadi no-op. */
let generation = 0;

const keyOf = (taskId: string, index: number): string => `${taskId}#${index}`;

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** Menandai butir sedang dikirim. Fungsi yang dikembalikan idempoten: pemanggilan kedua tidak mengurangi lagi. */
export function beginSending(taskId: string, index: number): () => void {
  const key = keyOf(taskId, index);
  const born = generation;
  counts.set(key, (counts.get(key) ?? 0) + 1);
  notify();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    // Sesudah `clearSending` tanda ini sudah dibuang; jangan mengurangi tanda baru milik sesi lain.
    if (born !== generation) return;
    const left = (counts.get(key) ?? 0) - 1;
    if (left > 0) counts.set(key, left);
    else counts.delete(key);
    notify();
  };
}

/** Mengosongkan semua tanda (keluar eksplisit): permintaan lama yang selesai belakangan tak lagi memengaruhi hitungan. */
export function clearSending(): void {
  generation += 1;
  counts.clear();
  notify();
}

export function isItemSending(taskId: string, index: number): boolean {
  return (counts.get(keyOf(taskId, index)) ?? 0) > 0;
}

export function subscribeSending(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Naik tiap perubahan (snapshot `useSyncExternalStore`). */
export function sendingVersion(): number {
  return version;
}

export function resetSendingForTests(): void {
  clearSending();
}
