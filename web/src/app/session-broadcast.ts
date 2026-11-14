import { discardBoardWrites } from '@/app/board-persist';
import { discardOutboxCopy, suspendOutboxWrites } from '@/modules/handover/lib/outbox';
import { clearSending } from '@/modules/handover/lib/outbox-status';

/**
 * Siaran keluar (logout) antar tab: tab yang keluar memberi tahu tab lain milik akun yang sama agar berhenti menulis
 * data perangkat (antrean dan papan) milik akun itu. Tanpa ini, tab lain masih bisa menulis ulang entri antrean atau
 * papan SESUDAH tab yang keluar membersihkan toko (menutup batasan banyak tab Tahap B). Tanpa `BroadcastChannel`
 * semuanya diam-diam tidak berbuat apa pun. Satu instans kanal dipakai untuk kirim dan dengar, jadi tab pengirim tidak
 * menerima pesannya sendiri.
 */
const CHANNEL_NAME = 'qc-session';

interface LogoutMessage {
  type: 'logout';
  owner: string;
}

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  try {
    if (typeof BroadcastChannel === 'undefined') return null;
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

/** Memberi tahu tab lain bahwa `owner` keluar (dipanggil `useLogout` sesudah `suspendOutboxWrites()`). */
export function announceLogout(owner: string): void {
  try {
    getChannel()?.postMessage({ type: 'logout', owner } satisfies LogoutMessage);
  } catch {
    // Siaran bersifat membantu saja; kegagalannya tak boleh menghalangi keluar.
  }
}

function isLogoutMessage(data: unknown): data is LogoutMessage {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as Record<string, unknown>;
  return m.type === 'logout' && typeof m.owner === 'string';
}

/** Mendengarkan siaran keluar dari tab lain; mengembalikan fungsi pelepas. */
export function startSessionListener(onLogout: (owner: string) => void): () => void {
  const target = getChannel();
  if (!target) return () => undefined;
  const handler = (event: MessageEvent) => {
    if (isLogoutMessage(event.data)) onLogout(event.data.owner);
  };
  target.addEventListener('message', handler);
  return () => target.removeEventListener('message', handler);
}

/**
 * Reaksi tab penerima: bila yang keluar adalah pemilik sesi tab ini, berhenti menulis data perangkat. Tidak
 * menavigasi: sesi tab ini mati lewat jalur 401 yang sudah ada. Pesan dari pemilik lain diabaikan.
 */
export function handleRemoteLogout(
  owner: string,
  deps: { currentOwner: string; stopBoardPersistence: () => void },
): void {
  if (owner !== deps.currentOwner) return;
  // Penulisan antrean ditahan, salinan memori dikosongkan (toko dibersihkan tab yang keluar), tanda "mengirim" dibuang,
  // dan penyimpan papan dihentikan sehingga tak ada tulisan baru atau tertunda yang menghidupkan data akun itu lagi.
  suspendOutboxWrites();
  discardOutboxCopy();
  clearSending();
  deps.stopBoardPersistence();
  discardBoardWrites();
}

export function resetSessionBroadcastForTests(): void {
  try {
    channel?.close();
  } catch {
    // Diabaikan.
  }
  channel = null;
}
