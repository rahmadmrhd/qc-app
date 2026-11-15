/**
 * Siaran antar-tab untuk antrean tulis offline: satu `BroadcastChannel('qc-outbox')` per tab. Pesan `changed` = isi toko
 * IndexedDB berubah (tab lain membaca ulang salinannya); pesan `sending` = entri sedang dikirim (Task 5). Tanpa
 * `BroadcastChannel` (peramban lama, tes) semuanya diam-diam tidak berbuat apa pun. Instans yang sama tidak menerima
 * pesannya sendiri, jadi pengirim tak perlu menyaring dirinya.
 */
export type OutboxMessage =
  | { type: 'changed' }
  | { type: 'sending'; ids: string[]; until: number }
  | { type: 'sending-done'; ids: string[] };

/** Nama saluran; `sync-sw.js` menyalinnya (dijaga `outbox-parity.test.ts`). */
export const OUTBOX_CHANNEL_NAME = 'qc-outbox';
const CHANNEL_NAME = OUTBOX_CHANNEL_NAME;

let channel: BroadcastChannel | null = null;
const handlers = new Set<(message: OutboxMessage) => void>();

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  try {
    if (typeof BroadcastChannel === 'undefined') return null;
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as OutboxMessage | null;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
      for (const handler of [...handlers]) handler(data);
    };
  } catch {
    channel = null;
  }
  return channel;
}

export function postOutboxMessage(message: OutboxMessage): void {
  try {
    getChannel()?.postMessage(message);
  } catch {
    // Siaran bersifat membantu saja; kegagalannya tak boleh mengganggu penulisan.
  }
}

/** Mendaftar penangan pesan dari tab lain; mengembalikan fungsi pelepas. */
export function onOutboxMessage(handler: (message: OutboxMessage) => void): () => void {
  handlers.add(handler);
  getChannel();
  return () => {
    handlers.delete(handler);
  };
}

export function resetOutboxChannelForTests(): void {
  handlers.clear();
  try {
    channel?.close();
  } catch {
    // Diabaikan.
  }
  channel = null;
}
