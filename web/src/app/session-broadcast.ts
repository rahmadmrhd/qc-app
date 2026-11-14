import { discardBoardWrites } from '@/app/board-persist';
import { loadMe } from '@/app/boot';
import { isBusy } from '@/app/pwa/busy';
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
/** Tab ini sendiri menjalankan proses keluar: pemulihan lewat muat ulang dimatikan. */
let localLogout = false;

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
  // Tab ini sendiri yang keluar: tak pernah memuat ulang karena siaran tab lain (lihat `armResume`).
  localLogout = true;
  disarmResume();
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

export interface ResumeDeps {
  /** Cek sesi lewat jalur yang sama dengan boot (`auth.me`, hanya baca). Objek = sesi sah; `null`/`'unavailable'` = tidak. */
  loadMe: () => Promise<unknown>;
  reload: () => void;
  isBusy: () => boolean;
}

const defaultResume: ResumeDeps = {
  loadMe: () => loadMe(),
  reload: () => window.location.reload(),
  isBusy,
};

/**
 * Pemulihan tab yang tertahan (keputusan pemilik 2026-11-14): sesudah menerima siaran keluar, tab ini berhenti menulis
 * data perangkat. Bila akun lalu login lagi di tab lain, tab ini tak pernah mendapat 401 dan fitur offline-nya mati
 * diam-diam. Maka saat tab KEMBALI terlihat/fokus, sesi dicek sekali (tanpa jaringan selama tab tersembunyi); sesi sah
 * (akun apa pun) = muat ulang SEKALI sehingga tab mulai bersih dengan antrean baru dari toko; sesi tidak sah atau server
 * tak terjangkau = tetap tertahan dan dicoba lagi pada fokus berikutnya. Penjaga lingkaran: tanda dipasang satu kali per
 * siaran yang diterima dan dilepas sebelum `reload()`.
 */
let resumeArmed = false;
let resumeChecking = false;
let resumeDeps: ResumeDeps = defaultResume;
let resumeStop: (() => void) | null = null;

function disarmResume(): void {
  resumeArmed = false;
  resumeStop?.();
  resumeStop = null;
}

async function checkResume(): Promise<void> {
  if (!resumeArmed || resumeChecking || localLogout) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  // Tab ini sendiri sedang menulis/keluar: jangan memotongnya.
  if (resumeDeps.isBusy()) return;
  resumeChecking = true;
  try {
    const me = await resumeDeps.loadMe();
    if (!resumeArmed || localLogout) return;
    if (typeof me === 'object' && me !== null) {
      disarmResume();
      resumeDeps.reload();
    }
  } catch {
    // Tak pernah menolak: gagal cek = tetap tertahan, coba lagi pada fokus berikutnya.
  } finally {
    resumeChecking = false;
  }
}

function armResume(deps: ResumeDeps): void {
  if (localLogout || typeof window === 'undefined') return;
  resumeDeps = deps;
  if (resumeArmed) return;
  resumeArmed = true;
  const onEvent = () => void checkResume();
  window.addEventListener('focus', onEvent);
  document.addEventListener('visibilitychange', onEvent);
  resumeStop = () => {
    window.removeEventListener('focus', onEvent);
    document.removeEventListener('visibilitychange', onEvent);
  };
}

/**
 * Reaksi tab penerima: bila yang keluar adalah pemilik sesi tab ini, berhenti menulis data perangkat. Tidak
 * menavigasi: sesi tab ini mati lewat jalur 401 yang sudah ada, atau tab dimuat ulang saat kembali fokus bila sesinya
 * ternyata sah lagi (`armResume`). Pesan dari pemilik lain diabaikan.
 */
export function handleRemoteLogout(
  owner: string,
  deps: { currentOwner: string; stopBoardPersistence: () => void; resume?: ResumeDeps },
): void {
  if (owner !== deps.currentOwner) return;
  // Penulisan antrean ditahan, salinan memori dikosongkan (toko dibersihkan tab yang keluar), tanda "mengirim" dibuang,
  // dan penyimpan papan dihentikan sehingga tak ada tulisan baru atau tertunda yang menghidupkan data akun itu lagi.
  suspendOutboxWrites();
  discardOutboxCopy();
  clearSending();
  deps.stopBoardPersistence();
  discardBoardWrites();
  armResume(deps.resume ?? defaultResume);
}

export function resetSessionBroadcastForTests(): void {
  disarmResume();
  resumeChecking = false;
  resumeDeps = defaultResume;
  localLogout = false;
  try {
    channel?.close();
  } catch {
    // Diabaikan.
  }
  channel = null;
}
