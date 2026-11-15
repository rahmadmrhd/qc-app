import { onOutboxMessage, postOutboxMessage } from './outbox-channel';

/**
 * Penanda "Mengirim…" (hanya memori, tidak disimpan):
 *  - per butir centang (task + indeks): diisi penguras antrean DAN centang langsung di `useCheckQueue`, hanya di tab ini;
 *    dua permintaan bertumpuk pada butir yang sama dihitung, jadi butir tetap "mengirim" sampai keduanya selesai.
 *  - per entri antrean (`id`; komentar dan task baru): diisi penguras dan DISIARKAN ke tab lain lewat
 *    `BroadcastChannel('qc-outbox')` dengan masa berlaku `SENDING_TTL_MS`; tab penerima menyimpan `until` dan
 *    kedaluwarsa sendiri, sehingga pengirim yang mati tidak membuat penanda macet.
 */
export type ItemSendState = 'waiting' | 'sending';

const counts = new Map<string, number>();
/** Entri antrean yang dikirim tab ini (hitungan per id). */
const entryCounts = new Map<string, number>();
/** Entri yang dikirim tab lain: id → waktu kedaluwarsa (ms epoch). */
const remoteUntil = new Map<string, number>();
const remoteTimers = new Set<ReturnType<typeof setTimeout>>();

/** Masa berlaku penanda siaran; pengirim yang mati tak membuat penanda macet lebih lama dari ini. */
export const SENDING_TTL_MS = 45_000;
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
  entryCounts.clear();
  remoteUntil.clear();
  for (const timer of remoteTimers) clearTimeout(timer);
  remoteTimers.clear();
  notify();
}

let stopListening: (() => void) | null = null;
/** Pendengar siaran dipasang malas (dan dipasang ulang sesudah `resetOutboxChannelForTests`). */
function ensureListening(): void {
  if (stopListening) return;
  stopListening = onOutboxMessage((message) => {
    if (message.type === 'sending') {
      for (const id of message.ids) remoteUntil.set(id, message.until);
      notify();
      // Kedaluwarsa sendiri: tanpa pesan lanjutan penanda hilang saat `until` lewat.
      const timer = setTimeout(
        () => {
          remoteTimers.delete(timer);
          notify();
        },
        Math.max(0, message.until - Date.now()) + 1,
      );
      remoteTimers.add(timer);
    } else if (message.type === 'sending-done') {
      let changed = false;
      for (const id of message.ids) changed = remoteUntil.delete(id) || changed;
      if (changed) notify();
    }
  });
}

/**
 * Menandai entri antrean (komentar/task baru) sedang dikirim di tab ini dan menyiarkannya ke tab lain. Fungsi yang
 * dikembalikan idempoten.
 */
export function beginSendingEntry(id: string): () => void {
  ensureListening();
  const born = generation;
  entryCounts.set(id, (entryCounts.get(id) ?? 0) + 1);
  notify();
  postOutboxMessage({ type: 'sending', ids: [id], until: Date.now() + SENDING_TTL_MS });
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    if (born !== generation) return;
    const left = (entryCounts.get(id) ?? 0) - 1;
    if (left > 0) entryCounts.set(id, left);
    else {
      entryCounts.delete(id);
      postOutboxMessage({ type: 'sending-done', ids: [id] });
    }
    notify();
  };
}

/** Entri sedang dikirim, oleh tab ini atau (dalam masa berlaku siaran) tab lain. */
export function isEntrySending(id: string): boolean {
  ensureListening();
  if ((entryCounts.get(id) ?? 0) > 0) return true;
  const until = remoteUntil.get(id);
  return until !== undefined && until > Date.now();
}

export function isItemSending(taskId: string, index: number): boolean {
  return (counts.get(keyOf(taskId, index)) ?? 0) > 0;
}

export function subscribeSending(listener: () => void): () => void {
  ensureListening();
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
  stopListening?.();
  stopListening = null;
}
