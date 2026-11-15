// Mesin sesi mode tunggal (spek §6.2, inventaris §1): reducer murni yang menjaga re-entry inject,
// rotasi bridge (naik hanya setelah inject SUKSES; kembali ke 0 saat router hidup lagi), dan
// syarat auto-inject. Tanpa efek samping: pemanggil (UI) yang mengirim peristiwa dan menjalankan I/O.

import { nextBridgeIndex } from './inject-plan';
import { isRegistered, type PendingEntry } from './pending';
import type { Brand } from './script-template';

export interface SessionState {
  brand: Brand | null;
  firmwareCode: string | null;
  devicePingable: boolean;
  routerPingable: boolean;
  /** Serial perangkat terbaca; kosong bila belum terbaca atau perangkat tak merespons ping. */
  serial: string;
  /** Penjaga re-entry (`statusCL` lama): diklaim saat inject mulai, dilepas di semua jalur akhir. */
  injecting: boolean;
  autoInject: boolean;
  bridgeIndex: number;
  lastOutcome: 'none' | 'success' | 'failed' | 'cancelled';
}

export type SessionEvent =
  | { type: 'select'; brand: Brand; firmwareCode: string | null }
  | { type: 'ping-device'; ok: boolean; serial: string }
  | { type: 'ping-router'; ok: boolean }
  | { type: 'inject-start' }
  | { type: 'inject-done'; outcome: 'success' | 'failed' | 'cancelled' }
  | { type: 'toggle-auto'; on: boolean }
  | { type: 'reset' };

export const INITIAL_SESSION: SessionState = {
  brand: null,
  firmwareCode: null,
  devicePingable: false,
  routerPingable: false,
  serial: '',
  injecting: false,
  autoInject: false,
  bridgeIndex: 0,
  lastOutcome: 'none',
};

/** Merk dan firmware terpilih, serial terbaca, dan tidak sedang inject. */
export function canInject(state: SessionState): boolean {
  return (
    state.brand !== null &&
    state.firmwareCode !== null &&
    state.firmwareCode !== '' &&
    state.serial !== '' &&
    !state.injecting
  );
}

/** Auto-inject hanya untuk serial yang belum ada di antrean pending. */
export function shouldAutoInject(state: SessionState, pending: readonly PendingEntry[]): boolean {
  return state.autoInject && canInject(state) && !isRegistered(pending, state.serial);
}

export function reduceSession(
  state: SessionState,
  event: SessionEvent,
  ctx: { interfaceCount: number },
): SessionState {
  switch (event.type) {
    case 'select':
      return { ...state, brand: event.brand, firmwareCode: event.firmwareCode };
    case 'ping-device':
      return event.ok
        ? { ...state, devicePingable: true, serial: event.serial }
        : { ...state, devicePingable: false, serial: '' };
    case 'ping-router':
      if (!event.ok) return { ...state, routerPingable: false };
      // Router hidup kembali setelah mati: urutan bridge dimulai lagi dari awal.
      return state.routerPingable ? state : { ...state, routerPingable: true, bridgeIndex: 0 };
    case 'inject-start':
      // Penjaga re-entry: abaikan bila sedang inject atau syarat belum terpenuhi.
      return canInject(state) ? { ...state, injecting: true } : state;
    case 'inject-done':
      // Hasil tanpa inject berjalan diabaikan agar rotasi bridge tak terjadi dua kali.
      if (!state.injecting) return state;
      return {
        ...state,
        injecting: false,
        lastOutcome: event.outcome,
        ...(event.outcome === 'success'
          ? {
              bridgeIndex: nextBridgeIndex(state.bridgeIndex, ctx.interfaceCount, true),
              serial: '',
            }
          : {}),
      };
    case 'toggle-auto':
      return { ...state, autoInject: event.on };
    case 'reset':
      return INITIAL_SESSION;
  }
}
