// Rencana "Siapkan bridge router" (spek 2026-11-19 §2, legacy L4.2): SATU sumber kebenaran untuk perintah RouterOS yang
// dijalankan proses utama (`desktop/src/main/multi/ports.ts`) DAN teks konfirmasi yang dilihat operator (`multi-panel.tsx`),
// agar dialog tak pernah menjanjikan hal yang berbeda dari perintahnya. Murni (tanpa I/O).

import { bridgeInterfaces, type ServerConfig } from '../config';

/** Nama interface/bridge RouterOS dari config.QC disisipkan ke perintah: hanya karakter aman. */
export const SAFE_ROUTER_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

export interface BridgeStep {
  label: string;
  command: string;
  /** Galat "already have such entry" dianggap berhasil. */
  idempotentAdd: boolean;
}

export interface BridgePlan {
  /** Host SSH router = `config.server.ip` (BUKAN `ipServer`, yang hanya nilai placeholder skrip). */
  host: string;
  /** Interface yang dipertahankan di bridge-nya (`server.interfaceComp`). */
  comp: string;
  bridge: string;
  /** Interface yang dimasukkan ke bridge Multi: `interfaceList` tanpa `interfaceComp` dan tanpa duplikat. */
  interfaces: string[];
  steps: BridgeStep[];
  /** Semua nama yang disisipkan ke perintah lolos `SAFE_ROUTER_NAME`. */
  valid: boolean;
}

/**
 * `multiBridge` = `brand.multi.interfaceBridge`; kosong/tak ada = `server.interfaceBridge`. Aturan nama bridge ada di
 * sini saja (dipakai perintah di proses utama dan teks dialog di web).
 */
export function buildBridgePlan(server: ServerConfig, multiBridge?: string): BridgePlan {
  const comp = server.interfaceComp.trim();
  const bridgeName = (multiBridge ?? '').trim() || server.interfaceBridge.trim();
  const interfaces = bridgeInterfaces(server);
  const names = [comp, bridgeName, ...interfaces];
  return {
    host: server.ip,
    comp,
    bridge: bridgeName,
    interfaces,
    steps: [
      {
        label: 'hapus bridge port',
        command: `/interface bridge port remove [find interface!=${comp}]`,
        idempotentAdd: false,
      },
      ...interfaces.map((iface) => ({
        label: `tambah ${iface}`,
        command: `/interface bridge port add bridge=${bridgeName} interface=${iface}`,
        idempotentAdd: true,
      })),
    ],
    valid: names.every((name) => SAFE_ROUTER_NAME.test(name)),
  };
}

/** Teks konfirmasi untuk operator: jujur soal cakupan penghapusan dan memuat perintah yang akan dijalankan. */
export function describeBridgePlan(plan: BridgePlan): string {
  const targets =
    plan.interfaces.length > 0 ? plan.interfaces.join(', ') : 'tidak ada interface lain';
  return `Ini mengubah konfigurasi router (${plan.host}): bridge port SEMUA interface selain ${plan.comp} dihapus dari SEMUA bridge di router itu (bukan hanya bridge ${plan.bridge}), lalu ${targets} ditambahkan ke bridge ${plan.bridge}. Perintah yang dijalankan: ${plan.steps
    .map((step) => step.command)
    .join('; ')}. Jalankan hanya bila memang perlu.`;
}
