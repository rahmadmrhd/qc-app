// Registri perangkat Multi (legacy L4.3): identitas perangkat = MAC, bukan IP. Fungsi murni yang
// merekonsiliasi daftar perangkat dengan hasil pemindaian lease; tidak mengubah masukan.

import type { DeviceStatus, Lease } from './types';

export interface DeviceRecord {
  mac: string;
  ip: string;
  status: DeviceStatus;
  message: string;
  /** Hasil ping terakhir; terpisah dari `status` (titik hijau/merah di tabel). */
  pingable: boolean;
  model: string;
  serial: string;
  country: string;
  /** Indeks kredensial yang sedang dicoba (0 = default, i = antrean[i-1]). Sandinya TIDAK disimpan di sini. */
  credentialIndex: number;
  /** Semua kredensial sudah dicoba pada sesi IP ini; tidak dicoba ulang sampai ada pemicu. */
  credentialsExhausted: boolean;
  /** Serial sudah ada di draft (Auto Inject melewatinya; inject manual tetap boleh). */
  alreadyRegistered: boolean;
  /** Sudah sukses di-inject selama mode Multi berjalan (Auto Inject melewatinya). */
  injectedThisSession: boolean;
  /** Terakhir terlihat di lease (ms, jam engine). */
  lastSeenAt: number;
  log: string[];
}

export const MSG_WAITING = 'Menunggu';
export const MSG_DISCONNECTED = 'Terputus';
export const MSG_TAKEN_OVER = 'Terputus (IP diambil alih perangkat lain)';

export function newDevice(mac: string, ip: string, now: number): DeviceRecord {
  return {
    mac,
    ip,
    status: 'waiting',
    message: MSG_WAITING,
    pingable: false,
    model: '',
    serial: '',
    country: '',
    credentialIndex: 0,
    credentialsExhausted: false,
    alreadyRegistered: false,
    injectedThisSession: false,
    lastSeenAt: now,
    log: [],
  };
}

export interface ReconcileOptions {
  /** IP PC operator; lease dengan IP ini diabaikan (kosong = tak ada yang dikecualikan). */
  excludeIp: string;
  /** Berapa lama perangkat yang tak terlihat dipertahankan sebelum dibuang. */
  graceMs: number;
}

export interface ReconcileResult {
  devices: DeviceRecord[];
  added: string[];
  ipChanged: string[];
  removed: string[];
}

function clone(device: DeviceRecord): DeviceRecord {
  return { ...device, log: [...device.log] };
}

/** Kembali ke `waiting` dengan kredensial dari awal (sesi IP baru). */
function resetToWaiting(device: DeviceRecord): void {
  device.status = 'waiting';
  device.message = MSG_WAITING;
  device.credentialIndex = 0;
  device.credentialsExhausted = false;
}

/**
 * Merekonsiliasi `devices` dengan hasil pemindaian `leases` pada waktu `now`.
 *
 * - MAC baru: `added` (status `waiting`).
 * - MAC terlihat dengan IP baru: IP diperbarui (`ipChanged`); bila bukan `injecting`/`success` perangkat kembali `waiting`
 *   dengan kredensial direset. `success` tidak diproses ulang (hanya IP-nya), `injecting` tidak diusik.
 * - MAC `disconnected` yang terlihat lagi: `waiting`, `lastSeenAt` diperbarui.
 * - IP dipakai MAC lain dan perangkat lama tak terlihat: `disconnected` "diambil alih" (kecuali `injecting`). Dua MAC yang
 *   bertukar IP pada satu pemindaian keduanya terlihat, jadi keduanya hanya `ipChanged`.
 * - MAC hilang: `disconnected`; dibuang (`removed`) setelah `graceMs`, kecuali `injecting`.
 */
export function reconcileLeases(
  devices: readonly DeviceRecord[],
  leases: readonly Lease[],
  now: number,
  opts: ReconcileOptions,
): ReconcileResult {
  // Lease yang dipakai: tanpa MAC dan bukan IP operator; MAC kembar memakai baris terakhir.
  const seen = new Map<string, Lease>();
  for (const lease of leases) {
    if (!lease.mac) continue;
    if (opts.excludeIp !== '' && lease.ip === opts.excludeIp) continue;
    seen.set(lease.mac, lease);
  }
  const ipClaimedBy = new Map<string, string>();
  for (const lease of seen.values()) ipClaimedBy.set(lease.ip, lease.mac);

  const out: DeviceRecord[] = [];
  const known = new Set<string>();
  const added: string[] = [];
  const ipChanged: string[] = [];
  const removed: string[] = [];

  for (const existing of devices) {
    known.add(existing.mac);
    const device = clone(existing);
    const lease = seen.get(device.mac);

    if (lease) {
      device.lastSeenAt = now;
      const wasDisconnected = device.status === 'disconnected';
      const changed = lease.ip !== device.ip;
      device.ip = lease.ip;
      if (changed) ipChanged.push(device.mac);
      if (wasDisconnected) {
        resetToWaiting(device);
      } else if (changed && device.status !== 'injecting' && device.status !== 'success') {
        resetToWaiting(device);
      }
      out.push(device);
      continue;
    }

    // Tak terlihat: diambil alih MAC lain atau sekadar hilang.
    const claimer = ipClaimedBy.get(device.ip);
    if (device.status !== 'injecting' && device.status !== 'disconnected') {
      device.status = 'disconnected';
      device.message =
        claimer !== undefined && claimer !== device.mac ? MSG_TAKEN_OVER : MSG_DISCONNECTED;
    }
    if (device.status !== 'injecting' && now - device.lastSeenAt >= opts.graceMs) {
      removed.push(device.mac);
      continue;
    }
    out.push(device);
  }

  for (const lease of seen.values()) {
    if (known.has(lease.mac)) continue;
    out.push(newDevice(lease.mac, lease.ip, now));
    added.push(lease.mac);
  }

  return { devices: out, added, ipChanged, removed };
}
