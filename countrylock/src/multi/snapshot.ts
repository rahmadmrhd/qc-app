// Snapshot engine Multi untuk renderer (spek §3): DTO per perangkat dibangun field demi field (daftar putih), jadi
// field baru di `DeviceRecord` tidak pernah bocor ke renderer tanpa disengaja, dan sandi tidak ada di sini sama sekali.

import { credentialSource } from './credentials';
import type { DeviceRecord } from './registry';
import type { DeviceStatus } from './types';

export interface MultiDeviceDto {
  mac: string;
  ip: string;
  status: DeviceStatus;
  message: string;
  pingable: boolean;
  model: string;
  serial: string;
  country: string;
  credentialsExhausted: boolean;
  alreadyRegistered: boolean;
  injectedThisSession: boolean;
  log: string[];
  /** "Default" atau "Antrian #N"; hanya penanda sumber, bukan kredensialnya. */
  credentialSource: string;
}

export interface MultiCounts {
  /** Waiting + Pinging + FetchingInfo + Ready (lencana "Menunggu" aplikasi lama). */
  waiting: number;
  queued: number;
  injecting: number;
  success: number;
  failed: number;
  /** Perangkat yang tidak `disconnected` (teks "N perangkat (M aktif)"). */
  active: number;
}

export interface MultiSnapshot {
  running: boolean;
  blockedReason: string | null;
  queueStopped: boolean;
  autoInject: boolean;
  concurrency: number;
  devices: MultiDeviceDto[];
  counts: MultiCounts;
  credentialCount: number;
  message: string;
  /** Penghitung monoton peristiwa `injected` yang berhasil ditulis; naik berarti ada peristiwa baru untuk dicatat. */
  injectedSeq: number;
}

export function toDeviceDto(d: DeviceRecord): MultiDeviceDto {
  return {
    mac: d.mac,
    ip: d.ip,
    status: d.status,
    message: d.message,
    pingable: d.pingable,
    model: d.model,
    serial: d.serial,
    country: d.country,
    credentialsExhausted: d.credentialsExhausted,
    alreadyRegistered: d.alreadyRegistered,
    injectedThisSession: d.injectedThisSession,
    log: [...d.log],
    credentialSource: credentialSource(d.credentialIndex),
  };
}

export function countDevices(devices: readonly DeviceRecord[]): MultiCounts {
  const counts: MultiCounts = {
    waiting: 0,
    queued: 0,
    injecting: 0,
    success: 0,
    failed: 0,
    active: 0,
  };
  for (const d of devices) {
    switch (d.status) {
      case 'waiting':
      case 'pinging':
      case 'fetching_info':
      case 'ready':
        counts.waiting += 1;
        break;
      case 'queued':
        counts.queued += 1;
        break;
      case 'injecting':
        counts.injecting += 1;
        break;
      case 'success':
        counts.success += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
      case 'disconnected':
        break;
    }
    if (d.status !== 'disconnected') counts.active += 1;
  }
  return counts;
}
