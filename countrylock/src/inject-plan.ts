// Rencana inject: memilih tujuan sambungan SSH dan merender skrip; kebijakan interval ping; rotasi
// interface bridge. Murni: skrip datang sebagai peta yang sudah dibaca pemanggil.

import type { BrandConfig, CountryLockConfig } from './config';
import { type Brand, renderScript, secretForms } from './script-template';

export interface ConnectTarget {
  host: string;
  username: string;
  password: string;
}

export interface InjectPlan {
  connect: ConnectTarget;
  script: string;
  scriptKey: string;
  /**
   * Kata sandi target dan server beserta SEMUA bentuk sisipannya di skrip (mentah dan escape),
   * tanpa string kosong. Pemanggil (IPC, Task 13) WAJIB meneruskannya ke `runInject({ secrets })`
   * agar progres/log tidak membocorkan sandi, termasuk bentuk terescape pada baris yang di-echo pty.
   */
  secrets: string[];
}

export type PlanErrorCode = 'FIRMWARE_UNKNOWN' | 'SCRIPT_MISSING' | 'BRAND_MISSING';

export class PlanError extends Error {
  readonly code: PlanErrorCode;

  constructor(code: PlanErrorCode, message: string) {
    super(message);
    this.name = 'PlanError';
    this.code = code;
  }
}

/** Kunci skrip pada peta paket: `<folder>/<file>`. */
export function scriptKey(brand: BrandConfig, file: string): string {
  return `${brand.folder}/${file}`;
}

export function planInject(input: {
  config: CountryLockConfig;
  brand: Brand;
  mode: 'single' | 'multi';
  firmwareCode: string;
  scripts: ReadonlyMap<string, string>;
  target: { ip: string; username: string; password: string };
  sshKey: string;
}): InjectPlan {
  const { config, brand, mode, firmwareCode, scripts, target, sshKey } = input;
  const brandConfig = config.brands[brand];
  if (!brandConfig) {
    throw new PlanError('BRAND_MISSING', `Config.QC tidak memuat merk ${brand}`);
  }
  const firmware = brandConfig.firmware.find((f) => f.code === firmwareCode);
  if (!firmware) {
    throw new PlanError('FIRMWARE_UNKNOWN', `Firmware "${firmwareCode}" tidak ada di config.QC`);
  }
  const key = scriptKey(brandConfig, firmware.file);
  const raw = scripts.get(key);
  if (raw === undefined) {
    throw new PlanError('SCRIPT_MISSING', `Skrip ${key} tidak ditemukan di paket skrip`);
  }

  const modeConfig = brandConfig[mode];
  // Hanya mode tunggal yang mengikuti connectVia; Multi selalu menyambung ke perangkat target.
  const viaServer = mode === 'single' && modeConfig.connectVia === 'Server';
  const connect: ConnectTarget = viaServer
    ? { host: config.server.ip, username: config.server.username, password: config.server.password }
    : { host: target.ip, username: target.username, password: target.password };

  const script = renderScript(
    raw,
    {
      ipTarget: target.ip,
      usernameTarget: target.username,
      passwordTarget: target.password,
      ipServer: modeConfig.ipServer,
      usernameServer: config.server.username,
      passwordServer: config.server.password,
      sshKey,
    },
    brand,
  );
  const secrets = [
    ...new Set([...secretForms(target.password), ...secretForms(config.server.password)]),
  ].sort((a, b) => b.length - a.length);
  return { connect, script, scriptKey: key, secrets };
}

export type PingKind = 'success' | 'unreachable' | 'timeout' | 'error';

/** Jeda sebelum ping berikutnya (inventaris §1.3): sukses 800, tak terjangkau/galat 500, timeout 200. */
export function nextPingDelayMs(kind: PingKind): number {
  switch (kind) {
    case 'success':
      return 800;
    case 'unreachable':
    case 'error':
      return 500;
    case 'timeout':
      return 200;
  }
}

/**
 * Indeks interface bridge berikutnya (inventaris §1.6): naik hanya bila inject sukses, kembali ke
 * 0 setelah melewati indeks terakhir; gagal/batal = tetap, agar percobaan ulang mengarah ke
 * perangkat yang sama.
 */
export function nextBridgeIndex(
  current: number,
  interfaceCount: number,
  injectSucceeded: boolean,
): number {
  if (!injectSucceeded) return current;
  const next = current + 1;
  return interfaceCount <= 0 || next >= interfaceCount ? 0 : next;
}
