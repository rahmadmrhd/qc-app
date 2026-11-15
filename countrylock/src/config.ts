// Parser `config.QC` (JSON murni; skema di inventaris §6). Tulisan tangan dan toleran: hanya
// `server.ip` yang wajib; node merk yang tak ada dilewati; kunci tak dikenal tetap ada di `raw`.
// Peta `sshKeys` sengaja diabaikan (keputusan spek: `{sshKey}` diisi dari host key router saat
// jabat tangan SSH); `version` tidak dipakai.

import type { Brand } from './script-template';

export interface FirmwareEntry {
  code: string;
  label: string;
  file: string;
}

export interface ModeConfig {
  /** IP perangkat target. Hanya bermakna di mode tunggal; mode Multi memakai IP hasil scan (''). */
  ip: string;
  /** Nilai placeholder `{ipServer}`. */
  ipServer: string;
  connectVia: 'Target' | 'Server';
  interfaceBridge: string;
}

export interface ServerConfig {
  ip: string;
  username: string;
  password: string;
  interfaceComp: string;
  interfaceList: string[];
  interfaceBridge: string;
}

export interface BrandConfig {
  brand: Brand;
  label: string;
  folder: string;
  username: string;
  password: string;
  web: string;
  firmware: FirmwareEntry[];
  single: ModeConfig;
  multi: ModeConfig;
}

export interface CountryLockConfig {
  server: ServerConfig;
  brands: Partial<Record<Brand, BrandConfig>>;
  /** Objek hasil `JSON.parse` utuh (kunci tak dikenal dipertahankan untuk penulisan ulang). */
  raw: unknown;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULT_INTERFACE_LIST = ['ether1', 'ether2', 'ether3', 'ether4', 'ether5'];
const DEFAULT_INTERFACE_COMP = 'ether1';
const FALLBACK_BRIDGE = 'bridge1';
const BRAND_LABELS: Record<Brand, string> = { mikrotik: 'Mikrotik', ubiquiti: 'Ubiquiti' };
const BRANDS: readonly Brand[] = ['mikrotik', 'ubiquiti'];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function obj(value: unknown): Json {
  return isObject(value) ? value : {};
}

/** String (angka diterima apa adanya); tipe lain = kosong. Tidak pernah dipangkas. */
function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function parseInterfaceList(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value.map(str)
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return items.map((s) => s.trim()).filter((s) => s !== '');
}

function parseServer(value: unknown): ServerConfig {
  const node = obj(value);
  const ip = typeof node.ip === 'string' ? node.ip.trim() : '';
  if (ip === '') throw new ConfigError('server.ip wajib diisi di config.QC');
  const list = parseInterfaceList(node.interfaceList);
  return {
    ip,
    username: str(node.username),
    password: str(node.password),
    interfaceComp: str(node.interfaceComp).trim() || DEFAULT_INTERFACE_COMP,
    interfaceList: list.length > 0 ? list : [...DEFAULT_INTERFACE_LIST],
    interfaceBridge: str(node.interfaceBridge).trim(),
  };
}

function parseFirmware(brand: Brand, value: unknown, warnings: string[]): FirmwareEntry[] {
  if (value === undefined) return [];
  if (!isObject(value)) {
    warnings.push(`${brand}.firmware bukan objek; diabaikan`);
    return [];
  }
  const out: FirmwareEntry[] = [];
  for (const [code, entry] of Object.entries(value)) {
    if (!isObject(entry)) {
      warnings.push(`${brand}.firmware.${code} bukan objek; dilewati`);
      continue;
    }
    const file = str(entry.file).trim();
    if (file === '') warnings.push(`${brand}.firmware.${code} tidak punya file skrip`);
    out.push({ code, label: str(entry.label).trim() || code, file });
  }
  return out;
}

function parseConnectVia(value: string, where: string, warnings: string[]): 'Target' | 'Server' {
  const v = value.trim().toLowerCase();
  if (v === 'server') return 'Server';
  if (v !== '' && v !== 'target')
    warnings.push(`${where}.connectVia tak dikenal; dipakai "Target"`);
  return 'Target';
}

function parseModes(
  brand: Brand,
  mode: unknown,
  server: ServerConfig,
  warnings: string[],
): { single: ModeConfig; multi: ModeConfig } {
  const node = obj(mode);
  const single = obj(node.single);
  const multi = obj(node.multi);
  // Aturan inventaris §6.2: mode Multi memakai nilainya sendiri bila tak kosong, selain itu nilai
  // mode tunggal; nilai bawaan baru dipakai setelah itu.
  const pick = (field: string, forMulti: boolean): string => {
    const own = forMulti ? str(multi[field]).trim() : '';
    return own !== '' ? own : str(single[field]).trim();
  };
  const build = (forMulti: boolean): ModeConfig => {
    const where = `${brand}.mode.${forMulti ? 'multi' : 'single'}`;
    return {
      ip: forMulti ? '' : str(single.ip).trim(),
      ipServer: pick('ipServer', forMulti) || server.ip,
      connectVia: parseConnectVia(pick('connectVia', forMulti), where, warnings),
      interfaceBridge:
        pick('interfaceBridge', forMulti) || server.interfaceBridge || FALLBACK_BRIDGE,
    };
  };
  return { single: build(false), multi: build(true) };
}

function parseBrand(
  brand: Brand,
  value: unknown,
  server: ServerConfig,
  warnings: string[],
): BrandConfig | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    warnings.push(`Node ${brand} bukan objek; dilewati`);
    return undefined;
  }
  if ('sshKeys' in value) {
    warnings.push(
      `${brand}.sshKeys diabaikan: kunci host kini diambil dari router saat jabat tangan SSH`,
    );
  }
  const folder = str(value.folder).trim();
  if (folder === '') warnings.push(`${brand}.folder kosong`);
  const { single, multi } = parseModes(brand, value.mode, server, warnings);
  return {
    brand,
    label: str(value.merk).trim() || BRAND_LABELS[brand],
    folder,
    username: str(value.username),
    password: str(value.password),
    web: str(value.web).trim(),
    firmware: parseFirmware(brand, value.firmware, warnings),
    single,
    multi,
  };
}

/** Mengurai isi `config.QC`. Melempar `ConfigError` untuk JSON rusak atau `server.ip` kosong. */
export function parseConfig(json: string): { config: CountryLockConfig; warnings: string[] } {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    throw new ConfigError('config.QC bukan JSON yang valid');
  }
  if (!isObject(root)) throw new ConfigError('config.QC harus berupa objek JSON');

  const warnings: string[] = [];
  const server = parseServer(root.server);
  const brands: Partial<Record<Brand, BrandConfig>> = {};
  for (const brand of BRANDS) {
    const parsed = parseBrand(brand, root[brand], server, warnings);
    if (parsed) brands[brand] = parsed;
  }
  return { config: { server, brands, raw: root }, warnings };
}

/** Interface yang dirotasi untuk bridge: `interfaceList` tanpa `interfaceComp`, tanpa duplikat. */
export function bridgeInterfaces(server: ServerConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of server.interfaceList) {
    const name = raw.trim();
    if (name === '' || name === server.interfaceComp.trim() || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
